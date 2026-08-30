import { Command } from 'commander';
import * as p from '@clack/prompts';
import {
  CertificateListItem,
  certificateArtifacts,
  createDomainCertificate,
  listDomainCertificates,
  removeDomainCertificate
} from '../services/cert-manager';
import { RunestoneEnv, envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { installRootCa } from '../services/root-ca-installer';
import { runInDynamicConfigBatch } from '../services/dynamic-config-manager';
import { findCoveringCertificate } from '../services/service-manager';
import { readTraefikSnapshot, TraefikNamedResource, TraefikSnapshot } from '../services/traefik-api';
import { syncDnsMappings } from '../services/dns/lifecycle';
import { printMappingSync } from './dns-notices';

interface RemoveOptions {
  force?: boolean;
}

/**
 * Spec 10.4: a certificate change regenerates the dnsmasq mappings, and only
 * when the set of certificate-covered domains actually changed.
 *
 * It never fails the certificate command that triggered it. The certificate is
 * already written; refusing to report that because the dns container could not
 * be reached would be reporting the wrong failure.
 */
function refreshDnsMappings(config: RunestoneEnv): void {
  try {
    printMappingSync(syncDnsMappings(config));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(t('dns.certs.error', { message }));
  }
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

function traefikApiBaseUrl(hostDomain: string): string {
  return `https://traefik.${hostDomain}`;
}

function extractHostRuleDomains(rule: string | undefined): string[] {
  if (!rule) {
    return [];
  }

  const domains = new Set<string>();
  const hostCalls = rule.matchAll(/Host\(([^)]*)\)/gi);
  for (const hostCall of hostCalls) {
    const args = hostCall[1] ?? '';
    const quotedValues = args.matchAll(/([`'"])(.*?)\1/g);
    for (const quotedValue of quotedValues) {
      const domain = quotedValue[2]?.trim().toLowerCase();
      if (domain) {
        domains.add(domain);
      }
    }
  }

  return Array.from(domains);
}

function isCertificateForDomain(certificate: CertificateListItem, projectDir: string, domain: string): boolean {
  const artifacts = certificateArtifacts(projectDir, domain);
  const sans = certificate.sans.map((san) => san.trim().toLowerCase());
  return certificate.certFile === artifacts.certFile ||
    certificate.keyFile === artifacts.keyFile ||
    sans.includes(artifacts.domain.toLowerCase()) ||
    sans.includes(artifacts.wildcardHost.toLowerCase());
}

function routesNeedingCertificateAfterRemoval(
  routers: TraefikNamedResource[],
  certificates: CertificateListItem[],
  projectDir: string,
  domain: string
): string[] {
  const target = certificates.find((certificate) => isCertificateForDomain(certificate, projectDir, domain));
  if (!target) {
    return [];
  }

  const remaining = certificates.filter((certificate) => certificate !== target);
  return Array.from(new Set(
    routers
      .flatMap((router) => extractHostRuleDomains(router.rule))
      .filter((route) => findCoveringCertificate(route, [target]) && !findCoveringCertificate(route, remaining))
  )).sort((left, right) => left.localeCompare(right));
}

function formatInUseRoutes(routes: string[]): string {
  const visible = routes.slice(0, 3).map((route) => `       -  ${route}`);
  if (routes.length > visible.length) {
    visible.push('          ...');
  }

  return visible.join('\n');
}

async function confirmCertificateRemovalIfInUse(
  hostDomain: string,
  projectDir: string,
  domain: string,
  force?: boolean
): Promise<boolean> {
  if (force) {
    return true;
  }

  const certificates = listDomainCertificates(projectDir);
  if (!certificates.some((certificate) => isCertificateForDomain(certificate, projectDir, domain))) {
    return true;
  }

  let snapshot: TraefikSnapshot;
  try {
    snapshot = await readTraefikSnapshot(traefikApiBaseUrl(hostDomain));
  } catch {
    logger.warn(t('certs.remove.checkSkipped'));
    return true;
  }

  const routes = routesNeedingCertificateAfterRemoval(snapshot.routers, certificates, projectDir, domain);
  if (routes.length === 0) {
    return true;
  }

  const result = await p.confirm({
    message: t('certs.remove.inUse.prompt', {
      domain: certificateArtifacts(projectDir, domain).domain,
      routes: formatInUseRoutes(routes)
    }),
    initialValue: false,
    active: t('common.yes'),
    inactive: t('common.no')
  });
  if (p.isCancel(result)) {
    p.cancel(t('certs.remove.cancelled'));
    process.exit(0);
  }

  return Boolean(result);
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
        const result = await runInDynamicConfigBatch(
          { composeFilePath: config.COMPOSE_FILE_PATH },
          () => createDomainCertificate(config.PROJECT_DIR, domain, { composeFilePath: config.COMPOSE_FILE_PATH })
        );

        logger.success(`Certificate configuration ready for '${result.artifacts.domain}'`);
        console.log(`  Certificate: ${result.artifacts.certFile}`);
        console.log(`  Key: ${result.artifacts.keyFile}`);
        console.log(`  Traefik TLS config: ${result.artifacts.dynamicConfigFile}`);
        refreshDnsMappings(config);
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
    .option('--force', t('options.force.description'))
    .action(async (domain: string, options: RemoveOptions) => {
      try {
        const config = envLoader.load();
        const shouldRemove = await confirmCertificateRemovalIfInUse(
          config.HOST_DOMAIN,
          config.PROJECT_DIR,
          domain,
          options.force
        );
        if (!shouldRemove) {
          logger.warn(t('certs.remove.cancelled'));
          return;
        }

        const result = await runInDynamicConfigBatch(
          { composeFilePath: config.COMPOSE_FILE_PATH },
          () => removeDomainCertificate(config.PROJECT_DIR, domain, { composeFilePath: config.COMPOSE_FILE_PATH })
        );
        const changed = result.certificateChanged || result.dynamicConfigChanged;

        if (changed) {
          logger.success(`Certificate configuration removed for '${result.artifacts.domain}'`);
          refreshDnsMappings(config);
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
