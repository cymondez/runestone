/**
 * Snapshot to prose. Pure: every function here is snapshot in, string out.
 *
 * These are the `{{BLOCK:...}}` expansions the corpus asks for. They are here
 * rather than in the renderer because the renderer must not know what a
 * certificate is, and they are prose rather than tables because the reader is a
 * model that will act on them — a fact stated in a sentence survives being
 * quoted out of context, a fact in a table column does not.
 *
 * A probe that came back unavailable must always produce a sentence saying so
 * and naming the command that would fix it. Silence would let an agent read
 * "no collisions found" out of "I could not check for collisions".
 */

import { BlockRenderers, TOPICS } from '../../utils/tool-docs';
import { AgentContextSnapshot } from './snapshot';

function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

/**
 * Which hostnames can be used without the browser complaining. Wildcards are
 * listed separately and with their limit spelled out, because covering one
 * level only is the detail that gets an agent's hostname choice wrong.
 */
export function renderDomains(snapshot: AgentContextSnapshot): string {
  const { covered, wildcards, hostDomain } = snapshot.domains;
  const lines: string[] = [`Host domain suffix: ${hostDomain}`];

  if (wildcards.length > 0) {
    lines.push(
      `Wildcard coverage: ${wildcards.join(', ')}. A wildcard covers exactly one label, ` +
        `so \`*.${hostDomain}\` covers \`api.${hostDomain}\` but not \`a.b.${hostDomain}\`.`
    );
  }

  if (covered.length > 0) {
    lines.push(`Individually covered names: ${covered.join(', ')}`);
  }

  if (wildcards.length === 0 && covered.length === 0) {
    lines.push(
      'No certificate covers any hostname yet. A route still works without one, ' +
        'but the browser shows a TLS warning. Create one with ' +
        `\`runestone certs create ${hostDomain}\`.`
    );
  }

  const invalid = snapshot.certificates.filter((certificate) => !certificate.valid);
  if (invalid.length > 0) {
    lines.push(
      `Ignore these — they are expired or unreadable and cover nothing: ` +
        `${invalid.flatMap((certificate) => certificate.sans).join(', ') || '(names unreadable)'}`
    );
  }

  return bullets(lines);
}

/** The names an agent must not collide with. Collisions are global to Traefik. */
export function renderUsedNames(snapshot: AgentContextSnapshot): string {
  const lines: string[] = [];

  if (snapshot.services.length === 0) {
    lines.push('No routed services are registered, so no service name or route is taken by one.');
  } else {
    lines.push(`Service names in use: ${snapshot.usedNames.serviceNames.join(', ')}`);
    lines.push(`Routes in use: ${snapshot.usedNames.routes.join(', ')}`);
  }

  if (snapshot.traefik.ok) {
    const routers = snapshot.traefik.value.routers.map((router) => router.name);
    lines.push(
      routers.length > 0
        ? `Traefik router IDs already registered, including by other projects: ${routers.join(', ')}`
        : 'Traefik reports no registered routers.'
    );
  } else if (snapshot.traefik.reason === 'unavailable') {
    lines.push(
      'Traefik could not be reached, so names registered by *other* projects are unknown. ' +
        'Treat a name as unverified rather than free. `runestone status` shows whether Runestone is running.'
    );
  } else {
    const live = liveFactsTopic();
    lines.push(
      live
        ? `Names registered by other projects were not checked. Run \`runestone docs --ai-context ${live}\` to include them.`
        : 'Names registered by other projects were not checked. Verify against `runestone service list` and the Traefik dashboard before committing to a name.'
    );
  }

  return bullets(lines);
}

/** Whether the environment is up. Only meaningful when it was probed. */
export function renderRuntime(snapshot: AgentContextSnapshot): string {
  if (!snapshot.containers.ok) {
    return snapshot.containers.reason === 'unavailable'
      ? bullets([
          'Docker could not be reached, so it is unknown whether Runestone is running. ' +
            'Ask the user to run `runestone up` if routes do not resolve.'
        ])
      : bullets(['Container state was not checked.']);
  }

  const containers = snapshot.containers.value;
  if (containers.length === 0) {
    return bullets(['Runestone is not running. Routes will not resolve until the user runs `runestone up`.']);
  }

  return bullets(containers.map((container) => `${container.service}: ${container.state} (${container.status})`));
}

/** Anything the agent should know before trusting the rest. */
export function renderWarnings(snapshot: AgentContextSnapshot): string {
  if (snapshot.warnings.length === 0) {
    return 'Nothing to flag.';
  }

  return bullets(snapshot.warnings);
}

export function renderDnsState(snapshot: AgentContextSnapshot): string {
  return snapshot.dns.enabled
    ? bullets([
        'Container DNS is enabled, so a Runestone domain resolves correctly from inside other containers too.'
      ])
    : bullets([
        'Container DNS is off. A Runestone domain resolves to 127.0.0.1, which inside a container is that ' +
          'container itself — so a URL that works in the browser can fail from another container. ' +
          'Enabling it restarts the Docker daemon and stops every container on the machine, so do not run ' +
          '`runestone dns enable` yourself; tell the user it exists.'
      ]);
}

/**
 * The topic carrying live facts, if this release defines one. Derived rather
 * than named, so guidance can never point at a topic the manifest does not
 * define — an agent following a command that errors is worse off than an agent
 * simply told the facts were not checked.
 */
function liveFactsTopic(): string | undefined {
  return TOPICS.find((topic) => topic.tier === 'online')?.id;
}

/**
 * Wires the snapshot to the block names the corpus uses. Lives here rather
 * than in the renderer because the renderer must not know what a certificate
 * is; it substitutes text and nothing else.
 */
export function contextBlocks(snapshot: AgentContextSnapshot): BlockRenderers {
  return {
    DOMAINS: () => renderDomains(snapshot),
    USED_NAMES: () => renderUsedNames(snapshot),
    RUNTIME: () => renderRuntime(snapshot),
    WARNINGS: () => renderWarnings(snapshot),
    DNS_STATE: () => renderDnsState(snapshot)
  };
}
