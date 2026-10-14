import { Command } from 'commander';
import { dim, green, red, yellow } from 'kleur';
import { StatusReport, buildStatusReport } from '../services/status-report';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { displayWidth } from '../utils/text';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

interface StatusOptions {
  json?: boolean;
}

type State = 'running' | 'stopped' | 'exists' | 'missing' | 'unknown';

/** One word per state, used everywhere in the report: `running` is never used to mean "exists". */
function stateWord(state: State): string {
  const word = t(`status.state.${state}` as never);
  if (state === 'running' || state === 'exists') {
    return green(word);
  }
  if (state === 'unknown') {
    return dim(word);
  }
  return red(word);
}

function existence(value: boolean | null): State {
  return value === null ? 'unknown' : value ? 'exists' : 'missing';
}

/** Rows of cells, aligned with a width that counts CJK characters as two columns. */
function printRows(rows: string[][]): void {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => displayWidth(stripColour(row[column]))))) ?? [];
  for (const row of rows) {
    console.log(`  ${row.map((cell, i) => (i === row.length - 1 ? cell : padCell(cell, widths[i]))).join('  ')}`.trimEnd());
  }
}

function stripColour(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Pads a possibly coloured cell to a width in terminal cells. */
function padCell(cell: string, width: number): string {
  return cell + ' '.repeat(Math.max(0, width - displayWidth(stripColour(cell))));
}

/**
 * The first line answers the question the command is run for: can Runestone be
 * used right now. It goes to stdout whatever the verdict, so a caller reading
 * stdout alone, as an agent usually does, always gets it.
 */
function verdictLine(report: StatusReport): string {
  switch (report.verdict) {
    case 'ready':
      return `${green('[ok]')} ${t('status.verdict.ready', { url: report.provides.traefikDashboard })}`;
    case 'degraded':
      return `${yellow('[warn]')} ${t('status.verdict.degraded', { count: String(report.problems.length) })}`;
    case 'stopped':
      return `${red('[error]')} ${t('status.verdict.stopped')}`;
    case 'docker-unreachable':
      return `${red('[error]')} ${t('status.verdict.dockerUnreachable')}`;
    default:
      return `${red('[error]')} ${t('status.verdict.notConfigured')}`;
  }
}

function render(report: StatusReport): void {
  console.log(verdictLine(report));

  if (report.verdict !== 'not-configured') {
    logger.info(t('status.section.containers'));
    if (report.containers === null) {
      printRows([[t('status.containers.unknown'), stateWord('unknown')]]);
    } else if (report.containers.length === 0) {
      console.log(`  ${t('status.containers.none')}`);
    } else {
      printRows(report.containers.map((container) => [
        container.name,
        stateWord(container.state === 'running' ? 'running' : 'stopped'),
        dim(container.status)
      ]));
    }

    logger.info(t('status.section.networkVolume'));
    printRows([
      [report.network.name, stateWord(existence(report.network.exists))],
      [report.volume.name, stateWord(existence(report.volume.exists))]
    ]);

    logger.info(t('status.section.provides'));
    printRows([
      [t('status.provides.traefik'), report.provides.traefikDashboard],
      [t('status.provides.mailpit'), report.provides.mailpitUi],
      [t('status.provides.smtpHost'), report.provides.smtp.fromHost],
      [t('status.provides.smtpNetwork', { network: report.network.name }), report.provides.smtp.fromRunestoneNetwork],
      [t('status.provides.smtpOther'), `${report.provides.smtp.fromOtherContainers}  ${dim(t('status.provides.smtpOtherNote'))}`]
    ]);

    logger.info(t('status.section.dns'));
    console.log(`  ${report.dns.enabled ? t('status.dns.on') : t('status.dns.off')}`);

    logger.info(t('status.section.routes'));
    const covered = [...report.covered.wildcards, ...report.covered.names];
    console.log(`  ${covered.length > 0 ? t('status.routes.covered', { names: covered.join(', ') }) : t('status.routes.noCertificates')}`);
    console.log(`  ${report.routes.length > 0
      ? t('status.routes.added', { names: report.routes.map((route) => `${route.name} (${route.route})`).join(', ') })
      : t('status.routes.noneAdded')}`);
    console.log(`  ${report.traefikRouters === null
      ? t('status.routes.traefikUnknown')
      : t('status.routes.traefik', { count: String(report.traefikRouters.length) })}`);

    logger.info(t('status.section.sshKeys'));
    if (report.sshKeys === null) {
      console.log(`  ${stateWord('unknown')}`);
    } else if (report.sshKeys.length === 0) {
      console.log(`  ${t('status.sshKeys.none')}`);
    } else {
      report.sshKeys.forEach((key) => console.log(`  ${key}`));
    }
  }

  if (report.problems.length > 0) {
    logger.info(t('status.section.problems'));
    for (const problem of report.problems) {
      console.log(`  - ${problem.text}`);
      console.log(`    ${dim(`${t('status.fix')}:`)} ${problem.fix}`);
    }
  }
}

export function createStatusCommand(): Command {
  return createCommand('status')
    .description(t('commands.status.description'))
    .option('--json', t('options.json.description'))
    .action(async (options: StatusOptions) => {
      try {
        const report = await buildStatusReport(envLoader.load());
        if (options.json) {
          // Plain JSON on stdout, nothing else: no colour, no logger prefix.
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          return;
        }

        render(report);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to get status: ${message}`);
        process.exitCode = 1;
      }
    });
}
