import { Command } from 'commander';
import * as p from '@clack/prompts';
import { checkEnvironment, formatDoctorCheck, installDoctorCheck } from '../services/environment-doctor';
import { createCommand } from '../utils/command';
import { checkDnsHealth } from '../services/dns/lifecycle';
import { isDnsEnabled } from '../services/dns/settings';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { dnsHealthLines } from './dns-notices';

/**
 * Spec 10.4: `doctor` reports the DNS state and **never auto-corrects it**.
 *
 * Correcting a daemon `dns` array from a diagnostic command is exactly the
 * guessing spec 9.3 forbids — the array holds entries that are not Runestone's,
 * and a diagnostic is the last place that should be deciding which. Every line
 * here names the command that would fix what it found.
 */
function reportDnsHealth(): boolean {
  const config = envLoader.load();
  if (!isDnsEnabled(config)) {
    return true;
  }

  let passed = true;
  p.log.info(t('dns.doctor.section'));
  for (const line of dnsHealthLines(checkDnsHealth(config))) {
    if (line.status === 'pass') {
      p.log.success(line.text);
    } else if (line.status === 'fail') {
      // A failed DNS check is a real failure: with DNS enabled, the machine's
      // Docker daemon points at something. `doctor` may not report a failure and
      // then sign off as passed.
      passed = false;
      p.log.error(line.text);
    } else if (line.status === 'skip') {
      p.log.info(line.text);
    } else {
      p.log.warn(line.text);
    }
  }
  p.log.info(t('dns.doctor.reportOnly'));

  return passed;
}

export function createDoctorCommand(): Command {
  return createCommand('doctor')
    .description(t('commands.doctor.description'))
    .action(async () => {
      try {
        p.intro('runestone doctor');
        const report = checkEnvironment();
        for (const check of report.checks) {
          const line = formatDoctorCheck(check);
          if (check.status === 'pass') {
            p.log.success(line);
          } else if (check.status === 'skip') {
            p.log.info(line);
          } else {
            p.log.error(line);
            if (check.installHint) {
              p.log.info(check.installHint);
            }
          }
        }

        const installable = report.checks.filter((check) => check.status === 'fail' && check.canInstall);
        for (const check of installable) {
          const shouldInstall = await p.confirm({
            message: `Install ${check.required} now?`,
            active: t('common.yes'),
            inactive: t('common.no'),
            initialValue: true
          });
          if (p.isCancel(shouldInstall)) {
            p.cancel(t('doctor.cancelled'));
            process.exit(0);
          }
          if (!shouldInstall) {
            continue;
          }

          const spinner = p.spinner();
          spinner.start(`Installing ${check.required}`);
          installDoctorCheck(check);
          spinner.stop(`Installed ${check.required}`);
        }

        let dnsPassed = true;
        try {
          dnsPassed = reportDnsHealth();
        } catch (dnsError) {
          const dnsMessage = dnsError instanceof Error ? dnsError.message : String(dnsError);
          p.log.warn(t('dns.doctor.unavailable', { message: dnsMessage }));
        }

        const nextReport = installable.length > 0 ? checkEnvironment() : report;
        if (nextReport.passed && dnsPassed) {
          p.outro(t('doctor.ready'));
          return;
        }

        // Two different failures with two different remedies: nothing is missing
        // from the host when it is DNS that is wrong, so telling the user to
        // install something would send them the wrong way.
        p.outro(nextReport.passed ? t('dns.doctor.outroFailed') : t('doctor.failed'));
        process.exit(1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Doctor failed: ${message}`);
        process.exit(1);
      }
    });
}
