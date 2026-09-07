/**
 * Renders the agent-facing corpus.
 *
 * `renderAiPromptContext` keeps the name, signature and behaviour it had when
 * this module was a single 22-line file, so `src/commands/docs.ts` did not
 * change when the corpus replaced the single template. It is the compose topic
 * and nothing else.
 */

import { RunestoneEnv } from '../env-loader';
import { readTopicAsset } from './assets';
import { DEFAULT_TOPIC, TOPICS, findTopic } from './manifest';
import { BlockRenderers, substitute } from './render';

export { TemplateError } from './render';
export type { BlockRenderers } from './render';
export { DEFAULT_TOPIC, TOPICS, findTopic, topicIds } from './manifest';
export type { TopicDefinition, TopicTier } from './manifest';

/**
 * The four scalars the corpus may reference. They are the ones the previous
 * template used, under the new delimiter; every one comes from `.env` and so
 * changes only when the user re-runs `setup`. That is what makes them safe to
 * substitute into a file installed in someone's repository, where a live fact
 * would be a lie within minutes (spec 6.2).
 */
function scalarsOf(config: RunestoneEnv): Record<string, string> {
  return {
    RUNESTONE_NETWORK_NAME: config.NETWORK_NAME,
    RUNESTONE_HOST_DOMAIN: config.HOST_DOMAIN,
    RUNESTONE_HTTPS_ENTRYPOINT_NAME: config.WEB_SECURE_ENTRYPOINT_NAME,
    RUNESTONE_HTTP_ENTRYPOINT_NAME: config.WEB_ENTRYPOINT_NAME
  };
}

/**
 * The topic index, derived from the manifest so it cannot drift from the list
 * of topics that actually exist. Registered here because it needs no machine
 * state at all — unlike the blocks that carry facts, which arrive with the
 * snapshot module.
 */
function renderTopicIndex(): string {
  return TOPICS.map((topic) => `- \`runestone docs --ai-context ${topic.id}\` — ${topic.summary}`).join('\n');
}

export function manifestBlocks(): BlockRenderers {
  return { TOPIC_INDEX: renderTopicIndex };
}

export class UnknownTopicError extends Error {}

export function renderAiContext(
  topicId: string,
  config: RunestoneEnv,
  blocks: BlockRenderers = {}
): string {
  if (!findTopic(topicId)) {
    throw new UnknownTopicError(topicId);
  }

  return substitute(readTopicAsset(topicId), scalarsOf(config), { ...manifestBlocks(), ...blocks });
}

export function renderAiPromptContext(config: RunestoneEnv): string {
  return renderAiContext(DEFAULT_TOPIC, config);
}
