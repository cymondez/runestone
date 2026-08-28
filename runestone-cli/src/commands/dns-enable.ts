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
import { dnsSetupFacts } from '../services/dns/lifecycle';
import { DEFAULT_UPSTREAM, invalidAddresses, parseUpstreamList } from '../services/dns/upstream';
import { displayWidth, padToWidth } from '../utils/text';
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

interface DiscloseRow {
  /** Already translated: the left column is what makes the block scannable. */
  label: string;
  text: string;
  /** Yellow, and marked with `!`. Kept to the three facts that can bite. */
  warn?: boolean;
  /** Continuation lines, aligned under the text column, sharing the label. */
  extra?: string[];
}

/**
 * Label column, then text, then continuations aligned under it.
 *
 * The column is measured in terminal cells rather than characters, because a
 * two-character Chinese label is four cells wide and padding by length would
 * leave the CJK locales ragged where English looked fine.
 */
function printDiscloseRows(rows: DiscloseRow[]): void {
  const column = Math.max(...rows.map((row) => displayWidth(row.label)));
  const indent = ' '.repeat(2 + column + 2);

  for (const row of rows) {
    const head = `${row.warn ? '! ' : '  '}${padToWidth(row.label, column)}  ${row.text}`;
    console.log(`  ${row.warn ? yellow(head) : head}`);
    for (const extra of row.extra ?? []) {
      console.log(`  ${indent}${extra}`);
    }
  }
}

/**
 * Spec 11.3: the user consents to concrete actions, not to abstract warnings, so
 * every item carries the value actually in effect. `--yes` skips the prompt, it
 * does not skip this.
 *
 * **All eleven facts of 11.3 are here, grouped under labels rather than printed
 * as eleven numbered paragraphs.** Numbered, they sat at one visual level —
 * three of them yellow but no shorter than the rest — and eight of the eleven
 * ran past 80 columns, so the terminal wrapped them where it chose and the
 * indent was lost on every continuation: thirteen printed lines were
 * twenty-one lines on screen. The reasoning behind each line moved to the user
 * documentation, which the last line points at.
 */
export function printEnableDisclosure(config: RunestoneEnv, plan: EnablePlan): void {
  const checks = plan.preflight;
  const fallback = daemonFallbackValue(config);
  const url = dnsUiUrl(config);
  const authenticated = isDnsUiAuthConfigured(config);
  const daemonPath = checks.daemonPath;
  const targetIp = checks.targetIp ?? '';

  const rows: DiscloseRow[] = [
    {
      label: t('dns.enable.disclose.label.write'),
      // The path is the object of consent, so it gets the row to itself and the
      // entries follow underneath. Together they ran to 88 columns on a real
      // Windows path, and neither half can be shortened: both are values.
      text: daemonPath,
      extra: [
        fallback === undefined
          ? t('dns.enable.disclose.write', { targetIp })
          : t('dns.enable.disclose.writeFallback', { targetIp, fallback })
      ]
    },
    {
      label: t('dns.enable.disclose.label.port'),
      text: t('dns.enable.disclose.port', { bindIp: checks.bindIp ?? '' })
    },
    {
      label: t('dns.enable.disclose.label.restart'),
      text: t('dns.enable.disclose.restart'),
      warn: true
    },
    {
      label: t('dns.enable.disclose.label.depend'),
      text: t('dns.enable.disclose.depend'),
      warn: true,
      // Item 5 shares this label because it is the same dependency from the
      // other end: which command leaves the service running, and which one
      // takes the whole machine's DNS down with it.
      extra: [t('dns.enable.disclose.dependStop')]
    },
    {
      label: t('dns.enable.disclose.label.undo'),
      text: t('dns.enable.disclose.undo', { count: plan.entries.length })
    },
    {
      label: t('dns.enable.disclose.label.removal'),
      text: t('dns.enable.disclose.removal')
    },
    {
      label: t('dns.enable.disclose.label.upstream'),
      text: t('dns.enable.disclose.upstream', { upstreams: checks.upstreams.upstreams.join(', ') }),
      extra: checks.upstreamIsFallback ? [t('dns.enable.disclose.upstreamDefault')] : []
    },
    {
      label: t('dns.enable.disclose.label.fallback'),
      // Both directions, always. Describing only one of them is what spec 9.7
      // calls unacceptable, in either direction — so the counterpart is the
      // continuation line, not a paragraph the reader has to finish.
      text:
        fallback === undefined
          ? t('dns.enable.disclose.fallbackOff')
          : t('dns.enable.disclose.fallbackOn', { value: fallback }),
      extra: [
        fallback === undefined
          ? t('dns.enable.disclose.fallbackOffOther')
          : t('dns.enable.disclose.fallbackOnOther')
      ]
    },
    {
      label: t('dns.enable.disclose.label.reorder'),
      text: isAutoReorderEnabled(config)
        ? t('dns.enable.disclose.reorderOn')
        : t('dns.enable.disclose.reorderOff')
    },
    {
      label: t('dns.enable.disclose.label.ui'),
      text: authenticated ? t('dns.enable.disclose.uiAuth', { url }) : t('dns.enable.disclose.uiOpen', { url }),
      warn: !authenticated,
      extra: authenticated ? [] : [t('dns.enable.disclose.uiSet')]
    }
  ];

  if (plan.duplicates.length > 0) {
    rows.push({
      label: t('dns.enable.disclose.label.existing'),
      text: t('dns.enable.disclose.existing', { values: plan.duplicates.join(', ') })
    });
  }

  logger.info(t('dns.enable.section.disclosure'));
  printDiscloseRows(rows);
  line(t('dns.enable.disclose.docs'));
}

export function printEnableDiff(plan: EnablePlan): void {
  logger.info(t('dns.enable.section.diff'));

  const before = readDnsArray(plan.before).values.map(String);
  const after = readDnsArray(plan.after).values.map(String);
  const added = new Set(plan.entries.map((entry) => entry.value));

  // **Removals first, and never silently.** A plan can take an entry away as
  // well as add one — `--no-fallback` does exactly that, and turning the 9.7
  // entry off is a change to the user's daemon file they are owed sight of.
  // Showing only additions made that invisible.
  const unmatched = [...after];
  for (const value of before) {
    const position = unmatched.indexOf(value);
    if (position === -1) {
      line(`- ${value}`);
    } else {
      unmatched.splice(position, 1);
    }
  }

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

  if (result.alreadyInEffect && !result.failure) {
    line(t('dns.enable.restart.alreadyInEffect'));
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

const CANCELLED = Symbol('runestone:cancelled');

/**
 * The settings `dns enable` asks for before it plans anything.
 *
 * These are the same two questions `runestone setup` asks, deliberately using
 * the same message keys: two wordings for one question is how a disclosure ends
 * up saying different things depending on which command you reached it through.
 *
 * The flags are the non-interactive form, not the only form. A flag already
 * given is not asked about again, and `--yes` skips both — that is what makes it
 * usable from a script.
 */
async function askDnsSettings(
  config: RunestoneEnv,
  options: { upstream?: string; fallback?: string | false }
): Promise<Partial<RunestoneEnv> | typeof CANCELLED> {
  const overrides: Partial<RunestoneEnv> = {};

  // Computed without starting a container, so asking costs nothing: the same
  // reads setup uses for its own version of this question.
  const facts = dnsSetupFacts(config);
  let upstreams = facts.upstreams.upstreams.join(',');

  if (options.upstream === undefined) {
    logger.info(t('setup.dns.upstream.title'));
    line(t('setup.dns.upstream.description'));
    line(t('setup.dns.upstream.computed', { values: upstreams }));
    for (const entry of facts.upstreams.origins) {
      line(t(`setup.dns.upstream.origin.${entry.origin}`, { value: entry.value }));
    }

    const action = await p.select({
      message: t('setup.dns.upstream.prompt'),
      initialValue: 'keep',
      options: [
        { value: 'keep', label: t('setup.dns.upstream.keep') },
        { value: 'replace', label: t('setup.dns.upstream.replace') },
        { value: 'append', label: t('setup.dns.upstream.append') }
      ]
    });

    if (p.isCancel(action)) {
      return CANCELLED;
    }

    if (action !== 'keep') {
      const entered = await p.text({
        message: t(`setup.dns.upstream.${action as 'replace' | 'append'}.prompt`),
        initialValue: action === 'append' ? '' : upstreams,
        validate: (value) => {
          if (parseUpstreamList(value).length === 0) {
            return t('setup.dns.upstream.required');
          }
          const invalid = invalidAddresses(value);
          return invalid.length > 0 ? t('setup.dns.upstream.invalid', { values: invalid.join(', ') }) : undefined;
        }
      });

      if (p.isCancel(entered)) {
        return CANCELLED;
      }

      upstreams =
        action === 'append'
          ? [...parseUpstreamList(upstreams), ...parseUpstreamList(entered)].join(',')
          : parseUpstreamList(entered).join(',');
    }

    overrides.DNS_UPSTREAM = upstreams;
  }

  if (options.fallback === undefined) {
    const suggested = parseUpstreamList(options.upstream ?? upstreams)[0] ?? DEFAULT_UPSTREAM;
    const current = config.DNS_DAEMON_FALLBACK.trim();

    logger.info(t('setup.dns.fallback.title'));
    line(t('setup.dns.fallback.description', { value: current || suggested }));
    // Both directions and nothing else. The five lines this replaced repeated
    // what the disclosure says a few lines later; the trade-off itself has to
    // stay, because this is where the choice is made. The advice table and the
    // reasoning live in the user documentation the hint points at.
    line(t('dns.enable.fallback.buys'));
    line(t('dns.enable.fallback.costs'));
    line(t('dns.enable.fallback.hint'));
    line(t('dns.enable.disclose.docs'));

    const wanted = await p.confirm({
      message: t('setup.dns.fallback.prompt'),
      initialValue: current !== '',
      active: t('common.yes'),
      inactive: t('common.no')
    });

    if (p.isCancel(wanted)) {
      return CANCELLED;
    }

    if (!wanted) {
      overrides.DNS_DAEMON_FALLBACK = '';
    } else {
      const entered = await p.text({
        message: t('dns.enable.fallback.which'),
        initialValue: current || suggested,
        validate: (value) => {
          const invalid = invalidAddresses(value);
          if (parseUpstreamList(value).length !== 1) {
            return t('dns.enable.fallback.one');
          }
          return invalid.length > 0 ? t('setup.dns.upstream.invalid', { values: invalid.join(', ') }) : undefined;
        }
      });

      if (p.isCancel(entered)) {
        return CANCELLED;
      }

      overrides.DNS_DAEMON_FALLBACK = entered.trim();
    }
  }

  return overrides;
}

export function createDnsEnableCommand(): Command {
  return createCommand('enable')
    .description(t('commands.dns.enable.description'))
    .option('-y, --yes', t('dns.enable.option.yes'))
    .option('--dry-run', t('dns.enable.option.dryRun'))
    .option('--upstream <ips>', t('dns.enable.option.upstream'))
    .option('--fallback <ip>', t('dns.enable.option.fallback'))
    .option('--no-fallback', t('dns.enable.option.noFallback'))
    .option('--no-restart', t('dns.enable.option.noRestart'))
    .option('--restore-containers', t('dns.enable.option.restoreContainers'))
    .action(async (options: {
      yes?: boolean;
      dryRun?: boolean;
      upstream?: string;
      restart?: boolean;
      restoreContainers?: boolean;
      fallback?: string | false;
    }) => {
      try {
        const loaded = envLoader.load();

        // Both overrides are for this run and are then written to `.env`, so the
        // value in effect is always the value you can read back. `--no-fallback`
        // arrives as `false`, which is how the 9.7 entry is asked to go away —
        // distinct from not mentioning it at all, which changes nothing.
        const overrides: Partial<RunestoneEnv> = {};
        if (options.upstream) {
          overrides.DNS_UPSTREAM = options.upstream;
        }
        if (typeof options.fallback === 'string') {
          overrides.DNS_DAEMON_FALLBACK = options.fallback;
        } else if (options.fallback === false) {
          overrides.DNS_DAEMON_FALLBACK = '';
        }

        // Nothing here can be asked without a terminal: @clack calls
        // `setRawMode` on stdin, and off a TTY that fails with
        // `uv_tty_init returned EBADF` — measured, not assumed. Consent under
        // spec 11.3 cannot be skipped, so the answer is to say what to pass
        // rather than either crash or proceed unasked.
        if (!options.yes && !options.dryRun && !process.stdin.isTTY) {
          logger.error(t('dns.enable.needsTty'));
          process.exit(1);
          return;
        }

        // Asked only when this run is going to change something and the user has
        // not already said. `--dry-run` stays scriptable, and `--yes` is the way
        // to mean "use what is configured, ask me nothing".
        if (!options.yes && !options.dryRun) {
          const answers = await askDnsSettings({ ...loaded, ...overrides } as RunestoneEnv, options);
          if (answers === CANCELLED) {
            logger.info(t('dns.enable.cancelled'));
            return;
          }

          Object.assign(overrides, answers);
        }

        const config: RunestoneEnv =
          Object.keys(overrides).length > 0 ? ({ ...loaded, ...overrides } as RunestoneEnv) : loaded;

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
