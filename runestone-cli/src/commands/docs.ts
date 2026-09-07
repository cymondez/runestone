import { Command } from 'commander';
import * as p from '@clack/prompts';
import { openUrl } from '../services/browser-opener';
import { contextBlocks } from '../services/agent-context/render';
import { buildLiveSnapshot, buildOfflineSnapshot } from '../services/agent-context/snapshot';
import { envLoader } from '../utils/env-loader';
import { DEFAULT_TOPIC, findTopic, renderAiContext, topicIds } from '../utils/tool-docs';
import { logger } from '../utils/logger';
import { t, formatMessage, resolveLocale } from '../i18n';
import { createCommand } from '../utils/command';

interface DocsOptions {
  /**
   * `true` when the flag is given with no value, which is what it has always
   * meant and must keep meaning: a bare `--ai-context` is the compose topic.
   * The README ships example prompts containing that exact invocation.
   */
  aiContext?: boolean | string;
  offline?: boolean;
}

const README_URL = 'https://github.com/cymondez/runestone#readme';

function resolveTopic(value: boolean | string): string | undefined {
  const id = typeof value === 'string' ? value.trim() : DEFAULT_TOPIC;
  return findTopic(id) ? id : undefined;
}

export function createDocsCommand(): Command {
  const command = createCommand('docs')
    .description(t('commands.docs.description'))
    .option('--ai-context [topic]', t('options.aiContext.description'))
    .option('--offline', t('options.offline.description'))
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

      const topic = resolveTopic(options.aiContext);
      if (!topic) {
        // Nothing on stdout. Exit 1 with an empty stdout is the contract that
        // says "this output is unusable, do not paste it into a prompt".
        logger.error(t('docs.aiContext.unknownTopic', { topics: topicIds().join(', ') }));
        process.exitCode = 1;
        return;
      }

      const config = envLoader.load();
      if (!envLoader.hasRequiredVars(config)) {
        logger.error(t('docs.aiContext.notConfigured'));
        process.exitCode = 1;
        return;
      }

      // The tier is a property of the topic, not of the invocation. Only the
      // topic whose whole purpose is live facts pays for Docker and Traefik;
      // the rest stay offline so that the path an agent calls on every task
      // never waits on a cold daemon. `--offline` forces file-only, which is
      // what makes the online topic deterministic for a test or an air-gapped
      // machine.
      const wantsLive = findTopic(topic)?.tier === 'online' && !options.offline;
      const snapshot = wantsLive ? await buildLiveSnapshot(config) : buildOfflineSnapshot(config);

      // `process.exitCode` rather than `process.exit()` so buffered stdout
      // flushes — the output is meant to be piped.
      process.stdout.write(renderAiContext(topic, config, contextBlocks(snapshot)));
    });

  return command;
}
