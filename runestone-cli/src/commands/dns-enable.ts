import { Command } from 'commander';
import * as p from '@clack/prompts';
import { green, yellow } from 'kleur';
import {
  CompleteResult,
  EnablePlan,
  EnableResult,
  Preflight,
  applyEnable,
  completeEnable,
  planEnable
} from '../services/dns/enable';
import { DnsLockHeldError, dnsLockPath, withDnsLock } from '../services/dns/lock';
import { DESKTOP_SAFE_RESTART_VERSION } from '../services/dns/environment';
import { readDnsArray } from '../services/dns/daemon-config';
import { daemonFallbackValue, isAutoReorderEnabled, isDnsUiAuthConfigured } from '../services/dns/settings';
import { dnsUiUrl } from '../services/dns/ui-route';
import { RunestoneEnv, envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

function line(text: string): void {
  console.log(`  ${text}`);
}

function warn(text: string): void {
  console.log(`  ${yellow(text)}`);
}

/**
 * Shared with setup, which runs preflight on its own to tell the user whether
 * this machine can do DNS at all — reads only, and long before anything is
 * written.
 */
export function printPreflight(checks: Preflight): void {
  logger.info(t('dns.enable.section.preflight'));

  if (!checks.ok) {
    for (const failure of checks.failures) {
      switch (failure.kind) {
        case 'setup-incomplete':
          logger.error(t('dns.enable.failed.setup'));
          break;
        case 'docker-unavailable':
          logger.error(t('dns.enable.failed.docker', { message: failure.message }));
          break;
        case 'windows-containers':
          logger.error(t('dns.enable.failed.windows', { osType: failure.osType }));
          break;
        case 'docker-desktop-elsewhere':
          logger.error(t('dns.enable.failed.desktopElsewhere', { operatingSystem: failure.operatingSystem }));
          break;
        case 'remote-context':
          logger.error(t('dns.enable.failed.remote', { name: failure.name, endpoint: failure.endpoint }));
          break;
        case 'target-ip':
          logger.error(t('dns.enable.failed.targetIp', { message: failure.message }));
          break;
        case 'daemon-unreadable':
          logger.error(t('dns.enable.failed.daemon', { path: checks.daemonPath, message: failure.message }));
          break;
      }
    }
    return;
  }

  line(green(t('dns.enable.preflight.ok')));
  line(t('dns.enable.preflight.targetIp', { value: checks.targetIp ?? '' }));
  line(t('dns.enable.preflight.bindIp', { value: checks.bindIp ?? '' }));
  if (checks.context) {
    line(t('dns.enable.preflight.context', { name: checks.context.name }));
  }
  line(t('dns.enable.preflight.daemon', { path: checks.daemonPath }));
  if (!checks.daemonExists) {
    line(t('dns.enable.preflight.daemonNew'));
  }
}

/**
 * Spec 11.3: the user consents to concrete actions, not to abstract warnings, so
 * every item carries the value actually in effect. `--yes` skips the prompt, it
 * does not skip this.
 */
export function printEnableDisclosure(config: RunestoneEnv, plan: EnablePlan): void {
  const checks = plan.preflight;
  const fallback = daemonFallbackValue(config);

  logger.info(t('dns.enable.section.disclosure'));
  line(t('dns.enable.disclose.1', { path: checks.daemonPath, targetIp: checks.targetIp ?? '' }));
  warn(t('dns.enable.disclose.2'));
  warn(t('dns.enable.disclose.3'));
  line(t('dns.enable.disclose.4', { bindIp: checks.bindIp ?? '' }));
  line(t('dns.enable.disclose.5'));
  line(t('dns.enable.disclose.6'));
  line(t('dns.enable.disclose.7', { count: plan.entries.length }));

  const url = dnsUiUrl(config);
  if (isDnsUiAuthConfigured(config)) {
    line(t('dns.enable.disclose.8auth', { url }));
  } else {
    warn(t('dns.enable.disclose.8', { url }));
  }

  line(isAutoReorderEnabled(config) ? t('dns.enable.disclose.9') : t('dns.enable.disclose.9off'));

  line(t('dns.enable.disclose.10', { upstreams: checks.upstreams.upstreams.join(', ') }));
  if (checks.upstreamIsFallback) {
    line(t('dns.enable.disclose.10fallback'));
  }

  // Both directions, always. Describing only one of them is what spec 9.7 calls
  // unacceptable, in either direction.
  line(fallback === undefined ? t('dns.enable.disclose.11off') : t('dns.enable.disclose.11on', { value: fallback }));

  if (plan.duplicates.length > 0) {
    warn(t('dns.enable.disclose.duplicate', { values: plan.duplicates.join(', ') }));
  }
}

export function printEnableDiff(plan: EnablePlan): void {
  logger.info(t('dns.enable.section.diff'));

  const before = readDnsArray(plan.before).values.map(String);
  const after = readDnsArray(plan.after).values.map(String);
  const added = new Set(plan.entries.map((entry) => entry.value));
  const remaining = [...before];

  for (const value of after) {
    const position = remaining.indexOf(value);
    if (position === -1 && added.has(value)) {
      line(`+ ${value}`);
      continue;
    }

    if (position !== -1) {
      remaining.splice(position, 1);
    }
    line(`  ${value}`);
  }
}

function printResult(config: RunestoneEnv, plan: EnablePlan, result: EnableResult): void {
  if (result.failure === 'service-start') {
    logger.error(t('dns.enable.result.serviceFailed', { message: result.failureMessage ?? '' }));
    return;
  }

  if (result.failure === 'verification') {
    logger.error(
      t('dns.enable.result.verifyFailed', {
        domain: plan.verifyDomain,
        message: result.failureMessage ?? ''
      })
    );
    line(t('dns.enable.result.verifyHint', { domain: config.HOST_DOMAIN }));
    if (result.rollbackError) {
      warn(t('dns.enable.result.rollbackFailed', { message: result.rollbackError, path: plan.preflight.daemonPath }));
    }
    return;
  }

  if (result.failure === 'daemon-write') {
    logger.error(
      t('dns.enable.result.daemonFailed', {
        path: plan.preflight.daemonPath,
        message: result.failureMessage ?? ''
      })
    );
    if (result.rollbackError) {
      warn(t('dns.enable.result.rollbackFailed', { message: result.rollbackError, path: plan.preflight.daemonPath }));
    }
    return;
  }

  if (result.verification?.ok) {
    line(t('dns.enable.result.verified', { domain: plan.verifyDomain, value: plan.preflight.targetIp ?? '' }));
  }

  if (plan.mode === 'reconcile' && !plan.changesFile) {
    line(t('dns.enable.nothingToDo'));
  } else if (plan.mode === 'reconcile' && plan.changesFile) {
    line(t('dns.enable.reordered'));
  }

  if (!plan.atFront && !plan.changesFile) {
    warn(t('dns.enable.notAtFront'));
  }

  line(t('dns.enable.result.ui', { url: dnsUiUrl(config) }));
  logger.success(t('dns.enable.result.prepared'));
  line(t('dns.enable.result.restartHint'));
}

export function printCompleteResult(plan: EnablePlan, result: CompleteResult): void {
  const targetIp = plan.preflight.targetIp ?? '';

  if (result.restart.status === 'manual-required') {
    warn(t('dns.enable.restart.manualRequired'));
    line(t('dns.enable.restart.manualWhy'));
    line(t('dns.enable.restart.manualDesktop'));
    line(t('dns.enable.restart.manualOther'));
    line(t('dns.enable.restart.manualThen'));
    return;
  }

  switch (result.failure) {
    case 'restart':
      logger.error(t('dns.enable.restart.failed', { message: result.failureMessage ?? '' }));
      break;
    case 'resolv-conf':
      logger.error(
        t('dns.enable.restart.resolvConf', {
          value: targetIp,
          actual: (result.nameservers ?? []).join(', ') || '(none)'
        })
      );
      break;
    case 'resolution':
      logger.error(
        t('dns.enable.restart.resolution', {
          domain: plan.verifyDomain,
          value: targetIp,
          message: result.failureMessage ?? ''
        })
      );
      break;
    default:
      if (result.restart.restored?.length) {
        line(t('dns.restart.restored', {
          count: result.restart.restored.length,
          names: result.restart.restored.join(', ')
        }));
      }
      if (result.restart.lost?.length) {
        warn(t('dns.restart.lost', { names: result.restart.lost.join(', ') }));
      }

      logger.success(t('dns.enable.restart.applied', { value: targetIp, domain: plan.verifyDomain }));
      return;
  }

  if (result.rollbackError) {
    warn(
      t('dns.enable.restart.rollbackFailed', {
        message: result.rollbackError,
        path: plan.preflight.daemonPath
      })
    );
  }
}

export function createDnsEnableCommand(): Command {
  return createCommand('enable')
    .description(t('commands.dns.enable.description'))
    .option('-y, --yes', t('dns.enable.option.yes'))
    .option('--dry-run', t('dns.enable.option.dryRun'))
    .option('--upstream <ips>', t('dns.enable.option.upstream'))
    .option('--no-restart', t('dns.enable.option.noRestart'))
    .option('--restore-containers', t('dns.enable.option.restoreContainers'))
    .action(async (options: {
      yes?: boolean;
      dryRun?: boolean;
      upstream?: string;
      restart?: boolean;
      restoreContainers?: boolean;
    }) => {
      try {
        const loaded = envLoader.load();
        const config: RunestoneEnv = options.upstream
          ? ({ ...loaded, DNS_UPSTREAM: options.upstream } as RunestoneEnv)
          : loaded;

        const plan = planEnable(config);

        printPreflight(plan.preflight);
        if (!plan.preflight.ok) {
          process.exit(1);
        }

        if (plan.conflicts.length > 0) {
          logger.error(t('dns.enable.failed.conflict'));
          process.exit(1);
        }

        printEnableDisclosure(config, plan);
        printEnableDiff(plan);

        if (options.dryRun) {
          logger.success(t('dns.enable.dryRun.done'));
          return;
        }

        if (!options.yes) {
          const confirmed = await p.confirm({
            message: t('dns.enable.confirm', { path: plan.preflight.daemonPath }),
            initialValue: false,
            active: t('common.yes'),
            inactive: t('common.no')
          });

          if (p.isCancel(confirmed) || !confirmed) {
            logger.info(t('dns.enable.cancelled'));
            return;
          }
        }

        logger.info(t('dns.enable.progress.files'));
        const result = withDnsLock('dns enable', () => applyEnable(config, plan));
        printResult(config, plan, result);

        if (result.failure) {
          process.exit(1);
          return;
        }

        // Spec 10.1 step 5: with --no-restart, stop here. The daemon
        // configuration is written and takes effect when the user restarts
        // Docker themselves, which is what makes the write safe to rehearse.
        if (options.restart === false || !result.record) {
          return;
        }

        // Docker Desktop older than the version that fixed its restart leaves
        // `unless-stopped` containers down for good, so no restart is attempted
        // there. Say why, recommend the update, and name the two other ways out
        // — rather than deciding for someone whose containers are at stake.
        const outdatedDesktop =
          plan.preflight.host === 'docker-desktop' && !plan.preflight.desktopRestartIsSafe;

        if (outdatedDesktop) {
          logger.info(t('dns.enable.desktop.outdated', {
            version: plan.preflight.desktopVersion?.version ?? t('dns.enable.desktop.unknownVersion'),
            minimum: DESKTOP_SAFE_RESTART_VERSION
          }));
          line(t('dns.enable.desktop.update'));
          line(t('dns.enable.desktop.manual'));
          line(t('dns.enable.desktop.restore'));
        }

        // On a platform with no automatic restart there is nothing to consent to
        // and nothing to announce: `completeEnable` will report that applying the
        // change is the user's to do, and how.
        const attemptsRestart = plan.preflight.restartPlan.steps.length > 0;

        // A second, separate confirmation: this one is the destructive step
        // (spec 11.3), and consenting to the write is not consenting to
        // terminating every container on the machine.
        if (attemptsRestart && !options.yes) {
          const confirmed = await p.confirm({
            message: t('dns.enable.confirmRestart'),
            initialValue: false,
            active: t('common.yes'),
            inactive: t('common.no')
          });

          if (p.isCancel(confirmed) || !confirmed) {
            logger.info(t('dns.enable.result.restartHint'));
            return;
          }
        }

        if (attemptsRestart) {
          logger.info(t('dns.enable.restart.progress'));
        }

        const completed = withDnsLock('dns enable', () =>
          completeEnable(config, plan, result.record as never, {}, {
            restoreContainers: Boolean(options.restoreContainers)
          })
        );
        printCompleteResult(plan, completed);

        if (completed.failure) {
          process.exit(1);
        }
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
        logger.error(t('dns.enable.failed', { message }));
        process.exit(1);
      }
    });
}
