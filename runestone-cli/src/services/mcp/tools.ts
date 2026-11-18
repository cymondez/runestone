/**
 * The four read-only tools, as plain functions over the snapshot.
 *
 * No SDK types appear here. That is deliberate: the transport is a thin shell
 * and the answers are ordinary values, so these are testable without a client
 * and would survive the transport being replaced.
 *
 * **Read-only is a design constraint, not a phase.** `AGENTS.md` makes the
 * interactive prompt a contract for `service add` and its siblings — errors the
 * user can fix must return to the same prompt — and an MCP call has no prompt
 * to return to. Worse, the interactive path is physically impossible here:
 * `@clack/prompts` writes to stdout, which is the protocol stream. And the
 * client's tool approval is per-tool and often per-session, so it is not
 * per-call informed consent and cannot render Runestone's disclosure as a
 * blocking gate.
 *
 * Little is lost by it: `checkName` does the part that is actually hard, and
 * the guide hands back the exact command for the human to run in their
 * own terminal, where the prompt rules and the disclosure both still apply.
 */

import { contextBlocks } from '../agent-context/render';
import { AgentContextSnapshot } from '../agent-context/snapshot';
import { RunestoneEnv } from '../../utils/env-loader';
import { GUIDE_TOPIC_ORDER, TOPICS, renderAiContextSequence, topicIds } from '../../utils/tool-docs';
export { checkName } from '../agent-context/check-name';
export type { CheckNameResult, NameVerdict, RouteVerdict } from '../agent-context/check-name';

/**
 * The topics each tool answers with.
 *
 * There is no `topic` parameter, and its removal was a correction rather than
 * a simplification (spec 11.2). The CLI splits by topic because an invocation
 * is a process and prompt context is scarce. On MCP neither holds: the
 * connection stays open, so a second call is nearly free, and tool selection
 * already exists — the model picks a tool from `tools/list` by its
 * description. An inner enum made it choose twice, and the inner choice had to
 * be made before it had seen anything that would inform it.
 *
 * `overview` leads the guide because its whole job is to say "choose between
 * these two paths"; splitting it off demanded a guess before supplying the
 * basis for the guess.
 */
const GUIDE_TOPICS: readonly string[] = GUIDE_TOPIC_ORDER;
const TROUBLESHOOT_TOPICS: readonly string[] = ['troubleshoot'];

function renderTopics(ids: readonly string[], config: RunestoneEnv, snapshot: AgentContextSnapshot): string {
  return renderAiContextSequence(ids, config, contextBlocks(snapshot));
}

/** How to connect this project: both paths, how to choose, and the guardrails. */
export function renderIntegrationGuide(config: RunestoneEnv, snapshot: AgentContextSnapshot): string {
  return renderTopics(GUIDE_TOPICS, config, snapshot);
}

/** Symptom to cause, for after something has already failed. */
export function renderTroubleshooting(config: RunestoneEnv, snapshot: AgentContextSnapshot): string {
  return renderTopics(TROUBLESHOOT_TOPICS, config, snapshot);
}

/** Exported so a test can assert every topic reaches exactly one tool. */
export const TOOL_TOPIC_COVERAGE: readonly string[] = [...GUIDE_TOPICS, ...TROUBLESHOOT_TOPICS, 'state'];
