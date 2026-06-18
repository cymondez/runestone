import { Command } from 'commander';
import * as p from '@clack/prompts';
import { checkEnvironment, formatDoctorCheck, installDoctorCheck } from '../services/environment-doctor';
import { createCommand } from '../utils/command';
import { logger } from '../utils/logger';
import { t } from '../i18n';

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

        const nextReport = installable.length > 0 ? checkEnvironment() : report;
        if (nextReport.passed) {
          p.outro(t('doctor.ready'));
          return;
        }

        p.outro(t('doctor.failed'));
        process.exit(1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Doctor failed: ${message}`);
        process.exit(1);
      }
    });
}
