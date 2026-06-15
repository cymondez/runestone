import { Command } from 'commander';
import { createDomainCertificate, removeDomainCertificate } from '../services/cert-manager';
import { composeService } from '../services/docker-compose';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

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
