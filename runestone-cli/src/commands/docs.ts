import { Command } from 'commander';
import * as p from '@clack/prompts';
import { openUrl } from '../services/browser-opener';
import { envLoader } from '../utils/env-loader';
import { renderAiPromptContext } from '../utils/tool-docs';
import { logger } from '../utils/logger';
import { t, formatMessage, resolveLocale } from '../i18n';
import { createCommand } from '../utils/command';

interface DocsOptions {
  aiContext?: boolean;
}

const README_URL = 'https://github.com/cymondez/runestone#readme';

export function createDocsCommand(): Command {
  const command = createCommand('docs')
    .description(t('commands.docs.description'))
    .option('--ai-context', t('options.aiContext.description'))
    .action(async (options: DocsOptions) => {
      if (!options.aiContext) {
        const locale = resolveLocale();
        const shouldOpen = await p.confirm({
          message: formatMessage(locale, 'docs.openReadme.prompt'),
          initialValue: true
        });

        if (p.isCancel(shouldOpen)) {
          p.cancel(formatMessage(locale, 'docs.cancelled'));
          process.exit(0);
        }

        if (shouldOpen) {
          try {
            openUrl(README_URL);
            logger.success(formatMessage(locale, 'docs.openReadme.opened', { url: README_URL }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(message);
            process.exitCode = 1;
          }
        }

        return;
      }

      const config = envLoader.load();
      if (!envLoader.hasRequiredVars(config)) {
        logger.error(t('docs.aiContext.notConfigured'));
        process.exitCode = 1;
        return;
      }

      process.stdout.write(renderAiPromptContext(config));
    });

  return command;
}
