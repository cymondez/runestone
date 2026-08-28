import { Command } from 'commander';
import * as p from '@clack/prompts';
import { yellow } from 'kleur';
import {
  DisablePlan,
  DisableResult,
  applyDisable,
  describeDiff,
  planDisable
} from '../services/dns/disable';
import { DnsLockHeldError, dnsLockPath, withDnsLock } from '../services/dns/lock';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

function line(text: string): void {
  console.log(`  ${text}`);
}

function warn(text: string): void {
  console.log(`  ${yellow(text)}`);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectIndex(value: string, previous: number[]): number[] {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--assume-index expects a non-negative integer, got '${value}'`);
  }

  return [...previous, parsed];
}

/**
 * Printed for a dry run, before the confirmation, and with `--yes`. Spec 11.3:
 * `--yes` skips the interactive confirmation, it does not suppress the
 * disclosure — the user consents to concrete actions, so the actions have to be
 * on screen either way.
 */
export function printDisablePlan(plan: DisablePlan): void {
  logger.info(t('dns.disable.section.plan'));
  line(t('dns.disable.plan.path', { path: plan.daemonPath }));

  for (const entry of plan.alreadyRevoked) {
    warn(t('dns.disable.plan.alreadyRevoked', { role: entry.role, value: entry.value }));
  }

  if (!plan.changesFile) {
    line(t('dns.disable.plan.nothing'));
    line(t('dns.disable.plan.noRestart'));
    return;
  }

  line(t('dns.disable.plan.removing', { count: plan.removed.length }));
  for (const diffLine of describeDiff(plan)) {
    line(diffLine);
  }

  if (plan.dnsKeyRemoved) {
    line(t('dns.disable.plan.keyRemoved'));
  }
  if (plan.deleteDaemonFile) {
    line(t('dns.disable.plan.fileRemoved'));
  }

  // Disclosure item 7, then item 2 — what is preserved, then what it costs.
  line(t('dns.disable.plan.preserved'));
  warn(t('dns.disable.plan.restart'));
}

function printBlockers(plan: DisablePlan): void {
  for (const blocker of plan.blockers) {
    switch (blocker.kind) {
      case 'no-ownership':
        logger.error(t('dns.disable.blocked.noOwnership', { path: plan.daemonPath }));
        break;
      case 'daemon-path-mismatch':
        logger.error(
          t('dns.disable.blocked.pathMismatch', { recorded: blocker.recorded, actual: blocker.actual })
        );
        break;
      case 'daemon-unreadable':
        logger.error(t('dns.disable.blocked.unreadable', { path: plan.daemonPath, message: blocker.message }));
        break;
      case 'ownership-conflict':
        logger.error(t('dns.disable.blocked.conflict'));
        for (const identification of blocker.identifications) {
          if (identification.status === 'conflict') {
            line(
              t('dns.disable.blocked.conflictEntry', {
                role: identification.role,
                value: identification.value,
                matches: identification.matches.join(', ')
              })
            );
          }
        }
        line(t('dns.disable.blocked.recovery', { path: plan.daemonPath }));
        break;
    }
  }
}

export function printDisableResult(plan: DisablePlan, result: DisableResult): void {
  if (result.wroteDaemon) {
    line(t('dns.disable.result.wrote', { path: plan.daemonPath }));
  }
  if (result.deletedDaemonFile) {
    line(t('dns.disable.result.deleted', { path: plan.daemonPath }));
  }

  const restart = result.restart;
  if (restart) {
    const seconds = Math.round(restart.waitedMs / 1000);
    switch (restart.status) {
      case 'restarted':
        line(t('dns.disable.result.restarted', { seconds }));
        break;
      case 'manual-required':
        warn(t('dns.disable.result.restartManual'));
        break;
      case 'timed-out':
        warn(t('dns.disable.result.restartTimedOut', { seconds }));
        break;
      default:
        warn(t('dns.disable.result.restartFailed', { message: restart.error ?? '' }));
    }
  }

  if (!result.verified) {
    warn(t('dns.disable.result.verifyFailed', { path: plan.daemonPath }));
  }

  if (result.serviceError) {
    warn(t('dns.disable.result.serviceError', { message: result.serviceError }));
  } else if (result.removedService) {
    line(t('dns.disable.result.serviceRemoved'));
  }

  if (result.removedUiRoute) {
    line(t('dns.disable.result.uiRemoved'));
  }

  line(t('dns.disable.result.kept'));
  logger.success(t('dns.disable.result.done'));
}

export function createDnsDisableCommand(): Command {
  return createCommand('disable')
    .description(t('commands.dns.disable.description'))
    .option('-y, --yes', t('dns.disable.option.yes'))
    .option('--dry-run', t('dns.disable.option.dryRun'))
    .option('--assume-entry <ip>', t('dns.disable.option.assumeEntry'), collect, [])
    .option('--assume-index <n>', t('dns.disable.option.assumeIndex'), collectIndex, [])
    .action(async (options: { yes?: boolean; dryRun?: boolean; assumeEntry: string[]; assumeIndex: number[] }) => {
      try {
        const config = envLoader.load();
        const request = { assumeEntries: options.assumeEntry, assumeIndexes: options.assumeIndex };

        const plan = planDisable(config, request);

        // Blockers are printed instead of the plan, not after it. A blocked run
        // has no plan to describe, and "nothing to change" above an error reads
        // as if the array were empty when the point is that Runestone does not
        // own what is in it.
        if (plan.blockers.length > 0) {
          printBlockers(plan);
          process.exit(1);
        }

        printDisablePlan(plan);

        if (options.dryRun) {
          logger.success(t('dns.disable.dryRun.done'));
          return;
        }

        // Nothing in the file changes, so there is nothing to consent to: no
        // write and no restart. The rest of the cleanup still runs.
        if (plan.changesFile && !options.yes) {
          const confirmed = await p.confirm({
            message: t('dns.disable.confirm'),
            initialValue: false,
            active: t('common.yes'),
            inactive: t('common.no')
          });

          if (p.isCancel(confirmed) || !confirmed) {
            logger.info(t('dns.disable.cancelled'));
            return;
          }
        }

        // The lock is taken for the write, not across the prompt: a user who
        // walks away from a confirmation must not block every later run. The
        // plan is therefore rebuilt inside the lock and compared with the one
        // that was shown, so "what you were shown is what happens" is checked
        // rather than assumed.
        const outcome = withDnsLock('dns disable', () => {
          const fresh = planDisable(config, request);
          if (fresh.before !== plan.before || fresh.blockers.length > 0) {
            return undefined;
          }

          return { plan: fresh, result: applyDisable(config, fresh) };
        });

        if (!outcome) {
          logger.error(t('dns.disable.changedUnderfoot', { path: plan.daemonPath }));
          process.exit(1);
        }

        printDisableResult(outcome.plan, outcome.result);
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
        logger.error(t('dns.disable.failed', { message }));
        process.exit(1);
      }
    });
}
