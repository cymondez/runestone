/**
 * Renders the agent-facing corpus.
 *
 * `renderAiPromptContext` keeps the name, signature and behaviour it had when
 * this module was a single 22-line file, so `src/commands/docs.ts` did not
 * change when the corpus replaced the single template. It is the compose topic
 * and nothing else.
 */

import { mailpitUiUrl, smtpEndpoints, traefikDashboardUrl } from '../endpoints';
import { RunestoneEnv } from '../env-loader';
import { readTopicAsset } from './assets';
import { ALL_TOPIC, DEFAULT_TOPIC, GUIDE_TOPIC, TOPICS, findTopic } from './manifest';
import { BlockRenderers, substitute } from './render';

export { TemplateError } from './render';
export type { BlockRenderers } from './render';
export {
  ALL_TOPIC,
  ALL_TOPIC_ORDER,
  DEFAULT_TOPIC,
  GUIDE_TOPIC,
  GUIDE_TOPIC_ORDER,
  TOPICS,
  compositeTopicOrder,
  findTopic,
  selectableTopicIds,
  topicIds
} from './manifest';
export type { TopicDefinition, TopicTier } from './manifest';

/**
 * The scalars the corpus may reference. Every one comes from `.env` and so
 * changes only when the user re-runs `setup`. That is what makes them safe to
 * substitute into a file installed in someone's repository, where a live fact
 * would be a lie within minutes (spec 6.2).
 *
 * The endpoint scalars are derived through `utils/endpoints` rather than
 * spelled out in the assets, so the corpus, `status` and `up` cannot disagree
 * about where Traefik and Mailpit are.
 */
function scalarsOf(config: RunestoneEnv): Record<string, string> {
  const smtp = smtpEndpoints(config);

  return {
    RUNESTONE_NETWORK_NAME: config.NETWORK_NAME,
    RUNESTONE_HOST_DOMAIN: config.HOST_DOMAIN,
    RUNESTONE_HTTPS_ENTRYPOINT_NAME: config.WEB_SECURE_ENTRYPOINT_NAME,
    RUNESTONE_HTTP_ENTRYPOINT_NAME: config.WEB_ENTRYPOINT_NAME,
    RUNESTONE_TRAEFIK_URL: traefikDashboardUrl(config.HOST_DOMAIN),
    RUNESTONE_MAILPIT_URL: mailpitUiUrl(config.HOST_DOMAIN),
    RUNESTONE_SMTP_FROM_HOST: smtp.fromHost,
    RUNESTONE_SMTP_FROM_NETWORK: smtp.fromRunestoneNetwork,
    RUNESTONE_SMTP_FROM_CONTAINERS: smtp.fromOtherContainers
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
    ...TOPICS.map((topic) => `- \`runestone docs --ai-context ${topic.id}\` — ${topic.summary}`),
    // The two composites are not manifest entries, so they were missing here,
    // and an agent reading only the corpus never learned that one call could
    // replace three.
    `- \`runestone docs --ai-context ${GUIDE_TOPIC}\` — ${GUIDE_SUMMARY}`,
    `- \`runestone docs --ai-context ${ALL_TOPIC}\` — ${ALL_SUMMARY}`
  ].join('\n');
}

const GUIDE_SUMMARY = 'How to connect a project: overview, compose and service in one go. What a bare `--ai-context` prints.';
const ALL_SUMMARY = 'Every topic in one go, including the live state and troubleshooting.';

/**
 * Every fact block the corpus uses, rendered as a pointer instead of a value.
 *
 * For files installed into someone's repository. The values come from the
 * certificate directory, the routes, the trust store and `.env`, and they
 * change after the file is written: a certificate created or a route added
 * afterwards made the installed copy differ from a fresh render, and
 * `skill status` then reported the file as edited by the user. Only `.env`
 * scalars are safe to write down (AGENTS.md, spec 6.2); everything else is
 * one command away.
 */
export function installedFactPointers(): BlockRenderers {
  const pointer = () =>
    '- Not written into this installed file, because it changes. Run `runestone docs --ai-context state` for the current value.';

  return { DOMAINS: pointer, USED_NAMES: pointer, RUNTIME: pointer, WARNINGS: pointer, DNS_STATE: pointer, RESOURCES: pointer };
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

export const SEQUENCE_SEPARATOR = '\n\n---\n\n';

/**
 * Several topics as one document: the guide a bare `--ai-context` prints, `all`,
 * and the MCP tools. Used by both surfaces so they stay identical.
 *
 * Each topic is written to stand alone, so each carries the footer and the fact
 * blocks it needs. Concatenated, that printed the footer once per topic and the
 * hostname lists twice, and the guide grew to about 22 KB. Here every block is
 * rendered in full the first time it appears and as a one-line pointer after
 * that, and the footer only at the end. A single topic renders as before.
 */
export function renderAiContextSequence(
  topicIds: readonly string[],
  config: RunestoneEnv,
  blocks: BlockRenderers = {}
): string {
  const all: BlockRenderers = { ...manifestBlocks(), ...blocks };
  const rendered = new Set<string>();

  return topicIds
    .map((topicId, index) => {
      const last = index === topicIds.length - 1;
      const once: BlockRenderers = {};
      for (const [name, render] of Object.entries(all)) {
        once[name] = () => {
          if (name === 'FOOTER') {
            return last ? render() : 'The full list of topics is at the end of this output.';
          }
          if (rendered.has(name)) {
            return '- As listed earlier in this output.';
          }
          rendered.add(name);
          return render();
        };
      }

      return renderAiContext(topicId, config, once);
    })
    .join(SEQUENCE_SEPARATOR);
}

/**
 * Retained for one release as the compose topic under its old name. The added
 * optional argument keeps every existing call site valid.
 */
export function renderAiPromptContext(config: RunestoneEnv, blocks: BlockRenderers = {}): string {
  return renderAiContext(DEFAULT_TOPIC, config, blocks);
}
