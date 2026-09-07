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
 * The footer every topic ends with, derived from the manifest so it cannot
 * advertise a topic that does not exist. This is how a bare
 * `runestone docs --ai-context` teaches an agent that the other topics are
 * there: discovery without changing what the default invocation means, which
 * compatibility pins to the compose topic (spec 7.2).
 *
 * It lives here rather than beside the fact blocks because it needs only the
 * manifest, and because the fact blocks live in a module that imports this one
 * — putting it there would close an import cycle.
 */
function renderFooter(): string {
  return [
    'More Runestone context, each a separate command:',
    ...TOPICS.map((topic) => `- \`runestone docs --ai-context ${topic.id}\` — ${topic.summary}`)
  ].join('\n');
}

/** Blocks that need no machine state, so every render can supply them. */
export function manifestBlocks(): BlockRenderers {
  return { FOOTER: renderFooter };
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

/**
 * Retained for one release as the compose topic under its old name. The added
 * optional argument keeps every existing call site valid.
 */
export function renderAiPromptContext(config: RunestoneEnv, blocks: BlockRenderers = {}): string {
  return renderAiContext(DEFAULT_TOPIC, config, blocks);
}
