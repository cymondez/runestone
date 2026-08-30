import { Command } from 'commander';
import * as p from '@clack/prompts';
import { composeService } from '../services/docker-compose';
import { networkService } from '../services/docker-network';
import { volumeService } from '../services/docker-volume';
import { applyDisable, planDisable } from '../services/dns/disable';
import { DnsLockHeldError, dnsLockPath, withDnsLock } from '../services/dns/lock';
import { isDnsEnabled } from '../services/dns/settings';
import { envLoader, RunestoneEnv } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { printDisableBlockers, printDisablePlan, printDisableResult } from './dns-disable';
import { printDownNotice } from './dns-notices';

interface DownOptions {
  removeNetwork?: boolean;
  removeVolumes?: boolean;
  purge?: boolean;
  yes?: boolean;
}

function ignoreMissingResource(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|no such/i.test(message);
}

/**
 * Spec 10.4: with DNS enabled, the daemon configuration is revoked **before**
 * anything is torn down, and a failure aborts the teardown entirely.
 *
 * The order is the point. Removing the dns container first would leave the
 * machine's Docker daemon pointing at a container that no longer exists, and
 * every container on the machine would lose name resolution with nothing left to
 * explain why.
 *
 * Returns false when `down` must stop.
 */
async function revokeDnsBeforeTeardown(config: RunestoneEnv, options: DownOptions): Promise<boolean> {
  if (!isDnsEnabled(config)) {
    return true;
  }

  const plan = planDisable(config);

  if (plan.blockers.length > 0) {
    printDisableBlockers(plan);
    logger.error(t('dns.down.blocked'));
    return false;
  }

  printDownNotice(config, plan.daemonPath);
  printDisablePlan(plan);

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: t('dns.down.confirm'),
      initialValue: false,
      active: t('common.yes'),
      inactive: t('common.no')
    });

    if (p.isCancel(confirmed) || !confirmed) {
      logger.info(t('dns.down.cancelled'));
      return false;
    }
  }

  const result = withDnsLock('runestone down', () => applyDisable(config, plan));
  printDisableResult(plan, result);

  // A restart that did not happen means the entries are still live in a daemon
  // that has not re-read the file. Tearing down now would remove the container
  // they point at.
  if (result.restart && result.restart.status !== 'restarted') {
    logger.error(t('dns.down.restartIncomplete'));
    return false;
  }

  if (!result.verified) {
    logger.error(t('dns.down.notVerified', { path: plan.daemonPath }));
    return false;
  }

  return true;
}

export function createDownCommand(): Command {
  return createCommand('down')
    .description(t('commands.down.description'))
    .option('--remove-network', t('options.removeNetwork.description'))
    .option('--remove-volumes', t('options.removeVolumes.description'))
    .option('--purge', t('options.purge.description'))
    .option('-y, --yes', t('options.yes.description'))
    .action(async (options: DownOptions) => {
      try {
        const config = envLoader.load();

        if (!(await revokeDnsBeforeTeardown(config, options))) {
          process.exit(1);
          return;
        }

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
        if (error instanceof DnsLockHeldError) {
          logger.error(
            t('dns.disable.locked', {
              pid: error.holder.pid,
              startedAt: error.holder.startedAt,
              path: dnsLockPath()
            })
          );
          process.exit(1);
        }

        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to tear down environment: ${message}`);
        process.exit(1);
      }
    });
}
