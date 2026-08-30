import { Command } from 'commander';
import { DNS_PROFILE, composeService } from '../services/docker-compose';
import { applyUpDns, planUpDns } from '../services/dns/lifecycle';
import { isDnsEnabled } from '../services/dns/settings';
import { printUpDns } from './dns-notices';
import { networkService } from '../services/docker-network';
import { sshManager } from '../services/ssh-manager';
import { volumeService } from '../services/docker-volume';
import { dockerChecker } from '../utils/docker-checker';
import { envLoader, RunestoneEnv } from '../utils/env-loader';
import { ensureProjectFiles } from '../utils/project-files';
import { logger } from '../utils/logger';
import { runSetup } from './setup';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

interface UpOptions {
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
  let config = envLoader.load();
  if (!envLoader.hasRequiredVars(config)) {
    logger.warn('Runestone is not configured yet. Starting setup.');
    config = await runSetup();
  }

  ensureProjectFiles(config);
  return config;
}

export function createUpCommand(): Command {
  return createCommand('up')
    .description(t('commands.up.description'))
    .option('--force-recreate', t('options.forceRecreate.description'))
    .option('--no-deps', t('options.noDeps.description'))
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

        // Spec 10.4: with DNS enabled the dns service comes up alongside the
        // rest. Without the profile it is invisible to Compose, which is what
        // keeps it out of the way of everyone who has not enabled it.
        const dnsEnabled = isDnsEnabled(config);

        logger.info('Starting Docker Compose services');
        composeService.up(config.COMPOSE_FILE_PATH, {
          wait: true,
          forceRecreate: Boolean(options.forceRecreate),
          noDeps: options.deps === false,
          profiles: dnsEnabled ? [DNS_PROFILE] : []
        });

        if (process.env.RUNESTONE_SKIP_SSH_KEYS === '1') {
          logger.warn('Skipping SSH key injection because RUNESTONE_SKIP_SSH_KEYS=1.');
        } else {
          logger.info('Injecting SSH keys');
          sshManager.addKeys(undefined, config.SSH_VOLUME_NAME);
        }

        if (dnsEnabled) {
          // Reconciling reads Docker and may write the daemon configuration, but
          // it never restarts Docker (spec 9.6), and it never fails `up`: an
          // environment that started is an environment that started, and a DNS
          // problem is reported rather than turned into a failed startup.
          try {
            const plan = planUpDns(config);
            printUpDns(config, applyUpDns(config, plan));
          } catch (dnsError) {
            const dnsMessage = dnsError instanceof Error ? dnsError.message : String(dnsError);
            logger.warn(t('dns.up.failed', { message: dnsMessage }));
          }
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
