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
import {
  assertNoTraefikHostConflict,
  assertNoTraefikNameConflict,
  certificateBaseDomainForRoute,
  findCoveringCertificate,
  normalizeRouteDomain,
  validateServiceName
} from '../service-manager';
import { listDomainCertificates } from '../cert-manager';
import { RunestoneEnv } from '../../utils/env-loader';
import { TOPICS, renderAiContext, topicIds } from '../../utils/tool-docs';
import { TraefikSnapshot } from '../traefik-api';

export interface NameVerdict {
  value: string;
  available: boolean;
  reason?: string;
}

export interface RouteVerdict extends NameVerdict {
  normalized?: string;
  coveringCertificate?: string | null;
  /** The command that would create the missing certificate, if one is missing. */
  certificateCommand?: string;
}

export interface CheckNameResult {
  serviceName?: NameVerdict;
  route?: RouteVerdict;
  /** Set when Traefik could not be reached, so a verdict is not a guarantee. */
  caveat?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
const GUIDE_TOPICS: readonly string[] = ['overview', 'compose', 'service'];
const TROUBLESHOOT_TOPICS: readonly string[] = ['troubleshoot'];

function renderTopics(ids: readonly string[], config: RunestoneEnv, snapshot: AgentContextSnapshot): string {
  const blocks = contextBlocks(snapshot);
  return ids.map((id) => renderAiContext(id, config, blocks)).join('\n\n---\n\n');
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

/**
 * Whether a service name and a route are free, and why not when they are not.
 *
 * This is the tool that prevents a wrong edit, and it is composed entirely of
 * the validators the CLI already enforces — so it cannot drift from what
 * `service add` will actually accept. Every exception becomes a verdict with a
 * reason; nothing throws.
 */
export function checkName(
  input: { serviceName?: string; route?: string },
  config: RunestoneEnv,
  snapshot: AgentContextSnapshot
): CheckNameResult {
  const result: CheckNameResult = {};
  const traefik: TraefikSnapshot | undefined = snapshot.traefik.ok
    ? { routers: snapshot.traefik.value.routers.map((r) => ({ name: r.name, rule: r.rule ?? undefined })), services: snapshot.traefik.value.services }
    : undefined;

  if (!snapshot.traefik.ok) {
    // Saying nothing here is the dangerous option: an agent reads silence as
    // "free" and picks a name another project already registered.
    result.caveat =
      snapshot.traefik.reason === 'unavailable'
        ? 'Traefik could not be reached, so names registered by other projects were not checked. Treat an available verdict as unverified.'
        : 'Traefik was not queried, so names registered by other projects were not checked.';
  }

  if (input.serviceName !== undefined) {
    result.serviceName = { value: input.serviceName, available: true };
    try {
      const name = validateServiceName(input.serviceName);
      if (snapshot.usedNames.serviceNames.includes(name)) {
        result.serviceName = { value: name, available: false, reason: `a routed service named '${name}' already exists` };
      } else {
        // Traefik is the only source that knows what *other* projects have
        // registered, and a router ID is global rather than scoped per project.
        if (traefik) {
          assertNoTraefikNameConflict(name, traefik);
        }
        result.serviceName = { value: name, available: true };
      }
    } catch (error) {
      result.serviceName = { value: input.serviceName, available: false, reason: messageOf(error) };
    }
  }

  if (input.route !== undefined) {
    try {
      const route = normalizeRouteDomain(input.route, config.HOST_DOMAIN);
      const verdict: RouteVerdict = { value: input.route, normalized: route, available: true };

      if (snapshot.usedNames.routes.includes(route)) {
        verdict.available = false;
        verdict.reason = `a routed service already uses '${route}'`;
      } else if (traefik) {
        try {
          assertNoTraefikHostConflict(route, traefik);
        } catch (error) {
          verdict.available = false;
          verdict.reason = messageOf(error);
        }
      }

      const covering = findCoveringCertificate(route, listDomainCertificates(config.PROJECT_DIR));
      verdict.coveringCertificate = covering ? covering.sans.join(', ') : null;
      if (!covering) {
        try {
          verdict.certificateCommand = `runestone certs create ${certificateBaseDomainForRoute(route)}`;
        } catch {
          // Too few labels to derive a base domain; the route rule below will
          // have already explained why, so nothing useful can be added here.
        }
      }

      result.route = verdict;
    } catch (error) {
      result.route = { value: input.route, available: false, reason: messageOf(error) };
    }
  }

  return result;
}
