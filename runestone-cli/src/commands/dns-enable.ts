import { Command } from 'commander';
import * as p from '@clack/prompts';
import { green, yellow } from 'kleur';
import { EnablePlan, EnableResult, applyEnable, planEnable } from '../services/dns/enable';
import { DnsLockHeldError, dnsLockPath, withDnsLock } from '../services/dns/lock';
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

function printPreflight(plan: EnablePlan): void {
  const checks = plan.preflight;
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

export function createDnsEnableCommand(): Command {
  return createCommand('enable')
    .description(t('commands.dns.enable.description'))
    .option('-y, --yes', t('dns.enable.option.yes'))
    .option('--dry-run', t('dns.enable.option.dryRun'))
    .option('--upstream <ips>', t('dns.enable.option.upstream'))
    // `--no-restart` is deliberately absent until the restart itself exists.
    // This command always stops at `phase=prepared`, so a flag naming the only
    // behaviour there is would claim a choice the user does not have.
    .action(async (options: { yes?: boolean; dryRun?: boolean; upstream?: string }) => {
      try {
        const loaded = envLoader.load();
        const config: RunestoneEnv = options.upstream
          ? ({ ...loaded, DNS_UPSTREAM: options.upstream } as RunestoneEnv)
          : loaded;

        const plan = planEnable(config);

        printPreflight(plan);
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
