import { Command } from 'commander';
import { composeService } from '../services/docker-compose';
import { networkService } from '../services/docker-network';
import { sshManager } from '../services/ssh-manager';
import { volumeService } from '../services/docker-volume';
import { dockerChecker } from '../utils/docker-checker';
import { envLoader, RunestoneEnv } from '../utils/env-loader';
import { ensureProjectFiles } from '../utils/project-files';
import { logger } from '../utils/logger';
import { runSetup } from './setup';

interface UpOptions {
  env?: string;
  forceRecreate?: boolean;
  deps?: boolean;
}

function ensureDocker(): void {
  if (!dockerChecker.isInstalled()) {
    throw new Error('Docker is not installed or not in PATH');
  }

  if (!dockerChecker.composePluginInstalled()) {
    throw new Error('Docker Compose plugin is not installed');
  }
}

async function loadOrSetup(options: UpOptions): Promise<RunestoneEnv> {
  let config = envLoader.load(options.env);
  if (!envLoader.hasRequiredVars(config)) {
    logger.warn('Runestone is not configured yet. Starting setup.');
    config = await runSetup(options.env ? { envPath: config.ENV_PATH } : {});
  }

  ensureProjectFiles(config);
  return config;
}

export function createUpCommand(): Command {
  return new Command('up')
    .description('Start the runestone environment')
    .option('-e, --env <path>', 'Path to .env file')
    .option('--force-recreate', 'Force recreate containers')
    .option('--no-deps', 'Do not start linked services')
    .action(async (options: UpOptions) => {
      try {
        const config = await loadOrSetup(options);
        ensureDocker();

        if (!networkService.exists(config.NETWORK_NAME)) {
          logger.info(`Creating Docker network '${config.NETWORK_NAME}'`);
          networkService.createNetwork(config.NETWORK_NAME);
        }

        if (!volumeService.exists(config.SSH_VOLUME_NAME)) {
          logger.info(`Creating Docker volume '${config.SSH_VOLUME_NAME}'`);
          volumeService.createVolume(config.SSH_VOLUME_NAME);
        }

        logger.info('Starting Docker Compose services');
        composeService.up(config.COMPOSE_FILE_PATH, {
          wait: true,
          forceRecreate: Boolean(options.forceRecreate),
          noDeps: options.deps === false
        });

        if (process.env.RUNESTONE_SKIP_SSH_KEYS === '1') {
          logger.warn('Skipping SSH key injection because RUNESTONE_SKIP_SSH_KEYS=1.');
        } else {
          logger.info('Injecting SSH keys');
          sshManager.addKeys(undefined, config.SSH_VOLUME_NAME);
        }

        logger.success(`runestone is ready at https://traefik.${config.HOST_DOMAIN}`);
        logger.info(`Mailpit: http://mailpit.${config.HOST_DOMAIN}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to start environment: ${message}`);
        process.exit(1);
      }
    });
}
