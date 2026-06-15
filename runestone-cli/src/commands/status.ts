import { Command } from 'commander';
import { green, red } from 'kleur';
import { composeService } from '../services/docker-compose';
import { networkService } from '../services/docker-network';
import { sshManager } from '../services/ssh-manager';
import { volumeService } from '../services/docker-volume';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';

interface StatusOptions {
  env?: string;
  project?: string;
}

function indicator(active: boolean): string {
  return active ? green('running') : red('stopped');
}

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show environment status')
    .option('-e, --env <path>', 'Path to .env file')
    .option('--project <path>', 'Runestone path or compose.yml path')
    .action((options: StatusOptions) => {
      try {
        const config = envLoader.load(options.env, options.project);
        logger.info('Docker containers');
        try {
          const containers = composeService.ps(config.COMPOSE_FILE_PATH);
          if (containers.length === 0) {
            console.log('  No containers found.');
          } else {
            for (const container of containers) {
              console.log(`  ${indicator(container.State === 'running')} ${container.Name} ${container.Status}`);
            }
          }
        } catch (error) {
          console.log(`  ${red('Error:')} ${error instanceof Error ? error.message : String(error)}`);
        }

        logger.info('SSH keys');
        const keys = sshManager.listKeys(config.SSH_VOLUME_NAME);
        if (keys.length === 0) {
          console.log('  No injected SSH keys found.');
        } else {
          keys.forEach((key) => console.log(`  ${green('+')} ${key}`));
        }

        logger.info('Docker network');
        console.log(`  ${indicator(networkService.exists(config.NETWORK_NAME))} ${config.NETWORK_NAME}`);

        logger.info('Docker volume');
        console.log(`  ${indicator(volumeService.exists(config.SSH_VOLUME_NAME))} ${config.SSH_VOLUME_NAME}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to get status: ${message}`);
        process.exit(1);
      }
    });
}
