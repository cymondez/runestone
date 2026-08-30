import { Command } from 'commander';
import { composeService } from '../services/docker-compose';
import { stopTargets } from '../services/dns/lifecycle';
import { isDnsEnabled } from '../services/dns/settings';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { printStopNotice } from './dns-notices';

interface StopOptions {
  all?: boolean;
}

export function createStopCommand(): Command {
  return createCommand('stop')
    .description(t('commands.stop.description'))
    .option('--all', t('options.stopAll.description'))
    .action((options: StopOptions) => {
      try {
        const config = envLoader.load();
        const all = Boolean(options.all);
        const targets = stopTargets(config, all);

        // Spec 11.3: disclosed **before** anything stops. A warning that arrives
        // after name resolution is already broken machine-wide is a post-mortem.
        if (isDnsEnabled(config)) {
          printStopNotice(config, all);
        }

        composeService.stop(config.COMPOSE_FILE_PATH, {
          services: targets.services,
          profiles: targets.profiles
        });

        logger.success(
          targets.keepsDns ? t('stop.doneKeepingDns') : 'Containers stopped successfully.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to stop containers: ${message}`);
        process.exit(1);
      }
    });
}
