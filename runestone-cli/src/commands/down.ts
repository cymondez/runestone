import { Command } from 'commander';
import { composeService } from '../services/docker-compose';
import { networkService } from '../services/docker-network';
import { volumeService } from '../services/docker-volume';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

interface DownOptions {
  removeNetwork?: boolean;
  removeVolumes?: boolean;
  purge?: boolean;
}

function ignoreMissingResource(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|no such/i.test(message);
}

export function createDownCommand(): Command {
  return createCommand('down')
    .description(t('commands.down.description'))
    .option('--remove-network', t('options.removeNetwork.description'))
    .option('--remove-volumes', t('options.removeVolumes.description'))
    .option('--purge', t('options.purge.description'))
    .action((options: DownOptions) => {
      try {
        const config = envLoader.load();
        const removeVolumes = Boolean(options.removeVolumes || options.purge);
        const removeNetwork = Boolean(options.removeNetwork || options.purge);

        composeService.down(config.COMPOSE_FILE_PATH, {
          removeVolumes,
          removeImages: Boolean(options.purge)
        });

        if (removeNetwork) {
          try {
            networkService.removeNetwork(config.NETWORK_NAME);
          } catch (error) {
            if (!ignoreMissingResource(error)) {
              throw error;
            }
          }
        }

        if (removeVolumes) {
          try {
            volumeService.removeVolume(config.SSH_VOLUME_NAME);
          } catch (error) {
            if (!ignoreMissingResource(error)) {
              throw error;
            }
          }
        }

        logger.success(options.purge ? 'Full purge complete.' : 'Teardown complete.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to tear down environment: ${message}`);
        process.exit(1);
      }
    });
}
