import { Command } from 'commander';
import { composeService } from '../services/docker-compose';
import { networkService } from '../services/docker-network';
import { volumeService } from '../services/docker-volume';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';

interface DownOptions {
  env?: string;
  project?: string;
  removeNetwork?: boolean;
  removeVolumes?: boolean;
  purge?: boolean;
}

function ignoreMissingResource(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|no such/i.test(message);
}

export function createDownCommand(): Command {
  return new Command('down')
    .description('Full teardown of the runestone environment')
    .option('-e, --env <path>', 'Path to .env file')
    .option('--project <path>', 'Runestone path or compose.yml path')
    .option('--remove-network', 'Remove the Docker network after teardown')
    .option('--remove-volumes', 'Remove volumes in addition to compose down')
    .option('--purge', 'Remove containers, volumes, networks, and images')
    .action((options: DownOptions) => {
      try {
        const config = envLoader.load(options.env, options.project);
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
