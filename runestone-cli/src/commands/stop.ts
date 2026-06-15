import { Command } from 'commander';
import { composeService } from '../services/docker-compose';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';

interface StopOptions {
  env?: string;
  project?: string;
}

export function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop containers without deleting them')
    .option('-e, --env <path>', 'Path to .env file')
    .option('--project <path>', 'Runestone path or compose.yml path')
    .action((options: StopOptions) => {
      try {
        const config = envLoader.load(options.env, options.project);
        composeService.stop(config.COMPOSE_FILE_PATH);
        logger.success('Containers stopped successfully.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to stop containers: ${message}`);
        process.exit(1);
      }
    });
}
