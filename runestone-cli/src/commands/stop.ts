import { Command } from 'commander';
import { composeService } from '../services/docker-compose';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

export function createStopCommand(): Command {
  return createCommand('stop')
    .description(t('commands.stop.description'))
    .action(() => {
      try {
        const config = envLoader.load();
        composeService.stop(config.COMPOSE_FILE_PATH);
        logger.success('Containers stopped successfully.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to stop containers: ${message}`);
        process.exit(1);
      }
    });
}
