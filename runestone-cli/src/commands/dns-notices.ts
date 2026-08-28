import { yellow } from 'kleur';
import {
  DnsHealthCheck,
  DnsHealthReport,
  MappingSyncResult,
  UpDnsResult
} from '../services/dns/lifecycle';
import { RunestoneEnv } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';

/**
 * What the lifecycle commands say about DNS (spec 11.3).
 *
 * The disclosures live here rather than inside each command because the same
 * facts are owed at several different moments, and spec 11.3 is explicit that
 * stating them once and assuming the user remembers is not acceptable. One
 * wording, printed from every moment that owes it.
 */

function line(text: string): void {
  console.log(`  ${text}`);
}

function warn(text: string): void {
  console.log(`  ${yellow(text)}`);
}

function positionList(result: UpDnsResult): string {
  return result.plan.identifications
    .filter((identification) => identification.status === 'matched')
    .map((identification) => `${identification.value} @ ${identification.index}`)
    .join(', ');
}

/**
 * The `up` row of spec 10.4 and the warning half of 9.6.
 *
 * Every branch that wrote something says **when it takes effect**, because `up`
 * never restarts Docker: a routine command that terminates every container on
 * the machine is not a routine command.
 */
export function printUpDns(config: RunestoneEnv, result: UpDnsResult): void {
  const plan = result.plan;

  if (plan.status === 'disabled') {
    return;
  }

  logger.info(t('dns.up.section'));

  switch (plan.status) {
    case 'no-record':
      warn(t('dns.up.noRecord', { path: plan.daemonPath }));
      return;
    case 'path-mismatch':
      warn(t('dns.up.pathMismatch', { recorded: plan.record?.daemonPath ?? '', actual: plan.daemonPath }));
      return;
    case 'daemon-unreadable':
      warn(t('dns.up.daemonUnreadable', { path: plan.daemonPath, message: plan.message ?? '' }));
      return;
    case 'conflict':
      warn(t('dns.up.conflict', { path: plan.daemonPath }));
      return;
    default:
      break;
  }

  if (plan.probeError) {
    warn(t('dns.up.probeFailed', { message: plan.probeError }));
  }

  if (plan.status === 'rotate' && result.wroteDaemon) {
    line(
      t('dns.up.rotated', {
        previous: plan.recordedTargetIp ?? '',
        current: plan.detectedTargetIp ?? '',
        path: plan.daemonPath
      })
    );
    warn(t('dns.up.takesEffect'));
  }

  if (plan.status === 'reorder' && result.wroteDaemon) {
    line(t('dns.up.reordered', { path: plan.daemonPath }));
    warn(t('dns.up.takesEffect'));
  }

  // Spec 9.6 with `DNS_AUTO_REORDER` off: warn, state the actual positions, and
  // change nothing.
  if (plan.status === 'not-at-front') {
    warn(t('dns.up.notAtFront', { path: plan.daemonPath, positions: positionList(result) }));
    line(t('dns.up.notAtFrontHint'));
  }

  if (result.recreatedService) {
    line(t('dns.up.serviceRecreated'));
  }

  if (result.restartedService) {
    line(t('dns.up.mappingsRefreshed', { count: result.mappings?.domains.length ?? 0 }));
  }

  if (result.mappings && !result.mappings.running) {
    warn(t('dns.up.serviceNotRunning'));
  }

  if (result.error) {
    warn(t('dns.up.serviceError', { message: result.error }));
  }

  if (plan.status === 'ok' || plan.status === 'reorder' || plan.status === 'rotate') {
    line(
      t('dns.up.ready', {
        targetIp: plan.detectedTargetIp ?? plan.recordedTargetIp ?? config.DNS_HOST_IP,
        url: `https://dns.${config.HOST_DOMAIN}`
      })
    );
  }
}

/**
 * Spec 11.3 item 5 for `stop`, items 3 and 5 for `stop --all`.
 *
 * `--all` is disclosed **before** the containers go down, not after: a warning
 * that arrives once name resolution is already broken machine-wide is a
 * post-mortem, not a disclosure.
 */
export function printStopNotice(config: RunestoneEnv, all: boolean): void {
  if (all) {
    warn(t('dns.stop.all.item3'));
    warn(t('dns.stop.all.item5'));
    line(t('dns.stop.all.hint', { targetIp: config.DNS_HOST_IP }));
    return;
  }

  line(t('dns.stop.keepsDns'));
}

/** The `down` row of the spec 11.3 timing table. */
export function printDownNotice(config: RunestoneEnv, daemonPath: string): void {
  logger.info(t('dns.down.section'));
  line(t('dns.down.revokes', { path: daemonPath }));
  warn(t('dns.down.restarts'));
  line(t('dns.down.preserved'));
  void config;
}

/** The `certs create` / `certs remove` row of spec 10.4. */
export function printMappingSync(result: MappingSyncResult): void {
  if (!result.enabled || !result.state) {
    return;
  }

  if (result.restarted) {
    line(t('dns.certs.refreshed', { count: result.state.domains.length, targetIp: result.state.targetIp }));
    return;
  }

  if (!result.state.running) {
    line(t('dns.certs.notRunning'));
    return;
  }

  if (result.state.error) {
    warn(t('dns.certs.error', { message: result.state.error }));
  }
}

export interface DnsHealthLine {
  status: DnsHealthCheck['status'];
  text: string;
}

/**
 * Spec 10.4 for `doctor`: report only. Each line names the command that would
 * fix what it found; none of them fixes anything.
 */
export function dnsHealthLines(report: DnsHealthReport): DnsHealthLine[] {
  if (!report.enabled) {
    return [];
  }

  return report.checks.map((check) => {
    const detail = check.detail as Record<string, string | number>;

    switch (check.id) {
      case 'ownership':
        if (check.status === 'fail') {
          return {
            status: check.status,
            text: detail.recorded
              ? t('dns.doctor.ownership.failMismatch', detail)
              : t('dns.doctor.ownership.fail', detail)
          };
        }
        return {
          status: check.status,
          text: check.status === 'pass' ? t('dns.doctor.ownership.pass', detail) : t('dns.doctor.ownership.warn', detail)
        };
      case 'position':
        if (check.status === 'fail') {
          return {
            status: check.status,
            text: detail.message !== undefined
              ? t('dns.doctor.position.failUnreadable', detail)
              : t('dns.doctor.position.fail', detail)
          };
        }
        return {
          status: check.status,
          text: check.status === 'pass' ? t('dns.doctor.position.pass', detail) : t('dns.doctor.position.warn', detail)
        };
      case 'service':
        return {
          status: check.status,
          text: check.status === 'pass' ? t('dns.doctor.service.pass', detail) : t('dns.doctor.service.fail', detail)
        };
      case 'targetIp':
        if (check.status === 'skip') {
          return { status: check.status, text: t('dns.doctor.targetIp.skip', detail) };
        }
        return {
          status: check.status,
          text: check.status === 'pass' ? t('dns.doctor.targetIp.pass', detail) : t('dns.doctor.targetIp.warn', detail)
        };
      case 'desktopRestart':
        if (check.status === 'skip') {
          return { status: check.status, text: t('dns.doctor.desktopRestart.skip', detail) };
        }
        return {
          status: check.status,
          text:
            check.status === 'pass'
              ? t('dns.doctor.desktopRestart.pass', detail)
              : t('dns.doctor.desktopRestart.warn', detail)
        };
      case 'mappings':
      default:
        if (check.status === 'skip') {
          return {
            status: check.status,
            text: detail.reason === 'not-running'
              ? t('dns.doctor.mappings.skipNotRunning')
              : t('dns.doctor.mappings.skip', detail)
          };
        }
        return {
          status: check.status,
          text: check.status === 'pass' ? t('dns.doctor.mappings.pass', detail) : t('dns.doctor.mappings.warn', detail)
        };
    }
  });
}
