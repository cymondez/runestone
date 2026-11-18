import { Command } from 'commander';
import * as p from '@clack/prompts';
import { openUrl } from '../services/browser-opener';
import { contextBlocks } from '../services/agent-context/render';
import { buildLiveSnapshot, buildOfflineSnapshot } from '../services/agent-context/snapshot';
import { envLoader } from '../utils/env-loader';
import {
  ALL_TOPIC,
  GUIDE_TOPIC,
  TOPICS,
  compositeTopicOrder,
  findTopic,
  renderAiContext,
  renderAiContextSequence,
  selectableTopicIds
} from '../utils/tool-docs';
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

/**
 * A bare `--ai-context` is the guide: the choice between the two integration
 * paths, then both paths. It used to be the compose topic alone, and an agent
 * with a host dev server was told to create a compose.yml.
 */
function resolveTopic(value: boolean | string): string | undefined {
  const id = typeof value === 'string' ? value.trim() : GUIDE_TOPIC;
  if (compositeTopicOrder(id)) {
    return id;
  }

  return findTopic(id) ? id : undefined;
}

/**
 * One line per topic, for `--help`.
 *
 * Derived from the manifest rather than written out, so a new topic appears
 * here without anyone remembering to add it — the reason this listing exists
 * at all is that the option description said "optionally name a topic" and
 * never said which, so the only way to find out was to guess wrong.
 *
 * The labels are localized because this is operator-facing text, unlike the
 * corpus itself, which is English by decision 1.
 */
function topicHelp(): string {
  const rows = [`  ${GUIDE_TOPIC.padEnd(14)}${t('docs.topic.guide')} (${t('docs.topic.default')})`];
  rows.push(...TOPICS.map((topic) => {
    const marks = topic.tier === 'online' ? [t('docs.topic.online')] : [];

    return `  ${topic.id.padEnd(14)}${t(`docs.topic.${topic.id}` as never)}${marks.length ? ` (${marks.join(', ')})` : ''}`;
  }));

  rows.push(`  ${ALL_TOPIC.padEnd(14)}${t('docs.topic.all')} (${t('docs.topic.online')})`);

  return [`${t('docs.topic.heading')}:`, ...rows].join('\n');
}

export function createDocsCommand(): Command {
  const command = createCommand('docs')
    .description(t('commands.docs.description'))
    .option('--ai-context [topic]', t('options.aiContext.description'))
    .option('--offline', t('options.offline.description'))
    .addHelpText('after', `\n${topicHelp()}`)
    .action(async (options: DocsOptions) => {
      if (!options.aiContext) {
        // The prompt below opens a terminal on stdin, and an agent's shell is
        // not one: it crashed with ERR_TTY_INIT_FAILED and never mentioned
        // --ai-context. With nobody to ask, say where to go instead.
        if (!process.stdin.isTTY) {
          process.stdout.write(`${t('docs.nonInteractive', { url: README_URL })}\n`);
          return;
        }

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
        logger.error(t('docs.aiContext.unknownTopic', { topics: selectableTopicIds().join(', ') }));
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
      // A composite is online when any of its topics is: `all` includes the
      // state topic and probes, the guide does not. findTopic returns
      // undefined for a composite, which would otherwise silently downgrade
      // `all` to offline and render the state topic as "not checked".
      const parts = compositeTopicOrder(topic);
      const isOnline = parts
        ? parts.some((id) => findTopic(id)?.tier === 'online')
        : findTopic(topic)?.tier === 'online';
      const wantsLive = isOnline && !options.offline;
      const snapshot = wantsLive ? await buildLiveSnapshot(config) : buildOfflineSnapshot(config);

      // `process.exitCode` rather than `process.exit()` so buffered stdout
      // flushes — the output is meant to be piped.
      const blocks = contextBlocks(snapshot);
      // A composite's own order, not the manifest's: overview explains how to
      // choose between the two paths, so it comes first.
      const body = parts
        ? renderAiContextSequence(parts, config, blocks)
        : renderAiContext(topic, config, blocks);

      process.stdout.write(body);
    });

  return command;
}
