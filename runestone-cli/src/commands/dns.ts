import { Command } from 'commander';
import { createDnsDisableCommand } from './dns-disable';
import { createDnsEnableCommand } from './dns-enable';
import { green, red, yellow } from 'kleur';
import { DnsStatusReport, buildDnsStatusReport, preparedReasonOf } from '../services/dns/status';
import { UpstreamOrigin } from '../services/dns/upstream';
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

function value(text: string): string {
  return text === '' ? t('dns.status.notSet') : text;
}

function originLabel(origin: UpstreamOrigin): string {
  switch (origin) {
    case 'env':
      return t('dns.status.origin.env');
    case 'daemon':
      return t('dns.status.origin.daemon');
    case 'host':
      return t('dns.status.origin.host');
    default:
      return t('dns.status.origin.default');
  }
}

function printOwnership(report: DnsStatusReport): void {
  logger.info(t('dns.status.section.ownership'));

  const record = report.record;
  if (!record) {
    line(t('dns.status.ownership.none'));
    return;
  }

  switch (preparedReasonOf(record)) {
    case undefined:
      line(t('dns.status.ownership.applied'));
      break;
    case 'no-restart':
      warn(t('dns.status.ownership.preparedNoRestart'));
      break;
    case 'rollback-failed':
      warn(t('dns.status.ownership.preparedRollback'));
      break;
    default:
      warn(t('dns.status.ownership.preparedUnknown'));
  }

  line(t('dns.status.ownership.context', { context: value(record.contextName) }));

  if (report.recordPathMismatch) {
    warn(t('dns.status.ownership.pathMismatch', { recorded: record.daemonPath }));
  }

  const identifications = report.identifications ?? [];
  identifications.forEach((identification, position) => {
    const shared = { role: identification.role, value: identification.value };

    if (identification.status === 'conflict') {
      warn(t('dns.status.entry.conflict', { ...shared, matches: identification.matches.join(', ') }));
      return;
    }

    if (identification.status === 'removed') {
      warn(t('dns.status.entry.removed', shared));
      if (identification.valueAtRecordedIndex !== undefined) {
        warn(
          t('dns.status.entry.occupant', {
            index: identification.recordedIndex,
            occupant: identification.valueAtRecordedIndex
          })
        );
      }
      return;
    }

    if (identification.index === position) {
      line(t('dns.status.entry.matched', { ...shared, index: identification.index }));
      return;
    }

    warn(
      t('dns.status.entry.displaced', {
        ...shared,
        index: identification.index ?? -1,
        expected: position
      })
    );
  });

  if (report.atFront === false) {
    warn(t('dns.status.notAtFront'));
    line(report.autoReorder ? t('dns.status.autoReorder.on') : t('dns.status.autoReorder.off'));
  }

  if (report.unownedTargetDuplicates > 0) {
    warn(t('dns.status.duplicates', { count: report.unownedTargetDuplicates }));
  }
}

export function printDnsStatus(report: DnsStatusReport): void {
  logger.info(t('dns.status.section.feature'));
  line(report.enabled ? green(t('dns.status.feature.enabled')) : t('dns.status.feature.disabled'));
  line(t('dns.status.targetIp', { value: value(report.targetIp) }));
  line(t('dns.status.bindIp', { value: value(report.bindIp) }));

  logger.info(t('dns.status.section.service'));
  if (report.serviceError) {
    line(`${red('!')} ${t('dns.status.service.error', { message: report.serviceError })}`);
  } else if (!report.service) {
    line(t('dns.status.service.absent'));
  } else {
    const running = report.service.state === 'running';
    line(
      `${running ? green('running') : red(report.service.state)} ${t('dns.status.service.state', {
        name: report.service.name,
        state: report.service.state,
        status: report.service.status
      })}`
    );
  }

  logger.info(t('dns.status.section.daemon'));
  if (report.daemon.path === '') {
    // Host `elsewhere`: there is no path, and printing an empty one — or the
    // platform default this used to guess — is the silent wrong answer.
    warn(t('dns.status.daemon.unknownPath'));
  } else {
    line(t('dns.status.daemon.path', { path: report.daemon.path }));
  }
  if (!report.daemon.exists) {
    line(t('dns.status.daemon.missing'));
  } else if (report.daemon.error) {
    warn(t('dns.status.daemon.invalid', { message: report.daemon.error }));
  } else if ((report.daemon.entries ?? []).length === 0) {
    line(t('dns.status.daemon.arrayEmpty'));
  } else {
    line(t('dns.status.daemon.array', { entries: (report.daemon.entries ?? []).join(', ') }));
  }
  if (report.daemon.requiresPrivilege) {
    line(t('dns.status.daemon.privilege'));
  }
  const firstStep = report.restart.steps[0];
  if (firstStep) {
    line(
      t('dns.status.restart.command', { command: [firstStep.command, ...firstStep.args].join(' ') })
    );
  }
  if (report.restart.allowManualFallback) {
    line(t('dns.status.restart.manual'));
  }

  if (report.overrides.length > 0) {
    logger.info(t('dns.status.section.override'));
    for (const override of report.overrides) {
      warn(t('dns.status.override.active', { variable: override.variable, value: override.value }));
    }
    warn(t('dns.status.override.warning'));
  }

  printOwnership(report);

  logger.info(t('dns.status.section.upstream'));
  for (const entry of report.upstreams.origins) {
    line(t('dns.status.upstream.entry', { value: entry.value, origin: originLabel(entry.origin) }));
  }
  line(t('dns.status.upstream.note'));

  logger.info(t('dns.status.section.fallback'));
  line(
    report.fallback === undefined
      ? t('dns.status.fallback.off')
      : t('dns.status.fallback.on', { value: report.fallback })
  );

  logger.info(t('dns.status.section.ui'));
  if (!report.ui.enabled) {
    line(t('dns.status.ui.disabled'));
  } else {
    line(t('dns.status.ui.url', { url: report.ui.url }));
    if (report.ui.authConfigured) {
      line(t('dns.status.ui.auth'));
    } else {
      warn(t('dns.status.ui.noAuth'));
    }
  }
}

/**
 * Read-only by construction: it builds a report out of reads and prints it. No
 * branch of it writes a file, starts a container or changes any state, which is
 * what makes it safe to run while diagnosing a half-applied change.
 */
export function createDnsStatusCommand(): Command {
  return createCommand('status')
    .description(t('commands.dns.status.description'))
    .action(() => {
      try {
        printDnsStatus(buildDnsStatusReport(envLoader.load()));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(t('dns.status.failed', { message }));
        process.exit(1);
      }
    });
}

export function createDnsCommand(): Command {
  return createCommand('dns')
    .description(t('commands.dns.description'))
    .addCommand(createDnsStatusCommand())
    .addCommand(createDnsEnableCommand())
    .addCommand(createDnsDisableCommand());
}
