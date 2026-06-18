import { Command } from 'commander';
import { CertificateListItem, createDomainCertificate, listDomainCertificates, removeDomainCertificate } from '../services/cert-manager';
import { composeService } from '../services/docker-compose';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { installRootCa } from '../services/root-ca-installer';

function shouldRestartOnWindows(changed: boolean): boolean {
  return changed && process.platform === 'win32';
}

function restartIfRunningOnWindows(composePath: string, changed: boolean): void {
  if (!shouldRestartOnWindows(changed)) {
    return;
  }

  const running = composeService.ps(composePath).some((container) => container.State === 'running');
  if (!running) {
    logger.warn('Certificate files changed, but no runestone container is running to restart.');
    return;
  }

  logger.info('Restarting runestone container so Docker Desktop picks up certificate/config changes');
  composeService.restart(composePath);
}

function formatCertificateTable(items: CertificateListItem[], options: { header: boolean }): string {
  const rows = items.map((item) => [
    item.status,
    item.sans.length > 0 ? item.sans.join(', ') : '-',
    item.issuer || '-',
    item.validUntil || '-',
    item.expiry || '-'
  ]);

  const allRows = options.header ? [['Status', 'SANs', 'Issuer', 'Valid Until', 'Expiry'], ...rows] : rows;
  const widths = allRows.reduce<number[]>(
    (next, row) => row.map((cell, index) => Math.max(next[index] ?? 0, cell.length)),
    []
  );

  return allRows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd())
    .join('\n');
}

export function createCertsCommand(): Command {
  const command = createCommand('certs')
    .alias('cert')
    .description(t('commands.certs.description'));

  command
    .addCommand(createCommand('create')
    .alias('c')
    .description(t('commands.certs.create.description'))
    .argument('<domain>', t('arguments.domain.create'))
    .action(async (domain: string) => {
      try {
        const config = envLoader.load();
        const result = await createDomainCertificate(config.PROJECT_DIR, domain);
        restartIfRunningOnWindows(
          config.COMPOSE_FILE_PATH,
          result.certificateChanged || result.dynamicConfigChanged
        );

        logger.success(`Certificate configuration ready for '${result.artifacts.domain}'`);
        console.log(`  Certificate: ${result.artifacts.certFile}`);
        console.log(`  Key: ${result.artifacts.keyFile}`);
        console.log(`  Traefik TLS config: ${result.artifacts.dynamicConfigFile}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create certificate: ${message}`);
        process.exit(1);
      }
    }));

  command
    .addCommand(createCommand('install')
    .alias('i')
    .description(t('commands.certs.install.description'))
    .action(async () => {
      try {
        const config = envLoader.load();
        const result = await installRootCa(config.PROJECT_DIR);
        logger.success('Root CA installed with mkcert');
        console.log(`  Certificate: ${result.rootCaPath}`);
        for (const warning of result.aliasResult.warnings) {
          logger.warn(warning);
        }

        if (!result.nss) {
          logger.info('Windows uses the system trust store through mkcert; no NSS database install is required.');
          return;
        }

        logger.success(`Root CA imported into ${result.nss.imported.length} NSS database(s)`);
        for (const db of result.nss.imported) {
          console.log(`  Imported: ${db.dir}`);
        }
        for (const db of result.nss.skipped) {
          console.log(`  Already installed: ${db.dir}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to install root CA: ${message}`);
        process.exit(1);
      }
    }));

  command
    .addCommand(createCommand('list')
    .alias('ls')
    .description(t('commands.certs.list.description'))
    .option('--no-header', t('options.noHeader.description'))
    .action((options: { header: boolean }) => {
      try {
        const config = envLoader.load();
        const table = formatCertificateTable(listDomainCertificates(config.PROJECT_DIR), { header: options.header });
        if (table) {
          console.log(table);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to list certificates: ${message}`);
        process.exit(1);
      }
    }));

  command
    .addCommand(createCommand('remove')
    .alias('rm')
    .alias('del')
    .description(t('commands.certs.remove.description'))
    .argument('<domain>', t('arguments.domain.remove'))
    .action((domain: string) => {
      try {
        const config = envLoader.load();
        const result = removeDomainCertificate(config.PROJECT_DIR, domain);
        const changed = result.certificateChanged || result.dynamicConfigChanged;
        restartIfRunningOnWindows(config.COMPOSE_FILE_PATH, changed);

        if (changed) {
          logger.success(`Certificate configuration removed for '${result.artifacts.domain}'`);
        } else {
          logger.warn(`No certificate configuration found for '${result.artifacts.domain}'`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to remove certificate: ${message}`);
        process.exit(1);
      }
    }));

  return command;
}
