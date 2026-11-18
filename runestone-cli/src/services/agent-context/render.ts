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

/**
 * Every hostname named by a `Host(...)` matcher in a router rule. `HostRegexp`
 * matchers, such as Runestone's own catch-all, name no single hostname and are
 * left out.
 */
export function routedHostnames(routers: Array<{ rule: string | null }>): string[] {
  const names = new Set<string>();
  for (const router of routers) {
    for (const host of (router.rule ?? '').matchAll(/\bHost\(([^)]*)\)/g)) {
      for (const quoted of host[1].matchAll(/`([^`]+)`/g)) {
        names.add(quoted[1].toLowerCase());
      }
    }
  }

  return [...names].sort();
}

/** The names an agent must not collide with. Collisions are global to Traefik. */
export function renderUsedNames(snapshot: AgentContextSnapshot): string {
  const lines: string[] = [];

  if (snapshot.services.length === 0) {
    lines.push('No routes have been added with `runestone service add`, so none of their names or hostnames is taken.');
  } else {
    lines.push(`Names of routes added with \`service add\`: ${snapshot.usedNames.serviceNames.join(', ')}`);
    lines.push(`Hostnames of routes added with \`service add\`: ${snapshot.usedNames.routes.join(', ')}`);
  }

  if (snapshot.traefik.ok) {
    const routers = snapshot.traefik.value.routers.map((router) => router.name);
    lines.push(
      routers.length > 0
        ? `Traefik router IDs already registered, including by other projects: ${routers.join(', ')}`
        : 'Traefik reports no registered routers.'
    );
    if (routers.length > 0) {
      lines.push(
        'Each ID ends in `@` and the provider that registered it: `@docker` for Compose labels, `@file` for `service add` ' +
          'and Runestone itself, `@internal` for Traefik. A label or `service add` uses the part before the `@`, and that ' +
          'part is what must not be taken.'
      );
    }
    // The router IDs alone did not say which hostnames other projects use, and
    // a Traefik service ID collides just as a router ID does. Both were already
    // in the snapshot; they were only not printed.
    const services = snapshot.traefik.value.services.map((service) => service.name);
    if (services.length > 0) {
      lines.push(`Traefik service IDs already registered, including by other projects: ${services.join(', ')}`);
    }
    const hostnames = routedHostnames(snapshot.traefik.value.routers);
    lines.push(
      hostnames.length > 0
        ? `Hostnames already routed, including by other projects: ${hostnames.join(', ')}`
        : 'No hostname is routed by any project yet.'
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

  // A service attached to the shared network also resolves every name on it.
  // Measured on 2026-10-14: when a name exists on both of a container's
  // networks, Docker answered with the network whose name sorts first, so a
  // sibling's name can reach another project's container.
  const network = snapshot.environment.networkName;
  if (snapshot.networkMembers.ok) {
    const names = namesOnNetwork(snapshot.networkMembers.value);
    lines.push(
      names.length > 0
        ? `Names already on the shared \`${network}\` network, which a service you attach to it also resolves: ` +
            `${names.join(', ')}. If that service calls a sibling by one of these names, Docker may answer with the ` +
            'container listed here instead of the sibling; the compose topic says how to avoid it.'
        : `Nothing is attached to the shared \`${network}\` network yet.`
    );
  } else if (snapshot.networkMembers.reason === 'unavailable') {
    lines.push(
      `The containers on the shared \`${network}\` network could not be listed ` +
        `(${snapshot.networkMembers.message ?? 'unknown error'}), so names that may collide there are unknown.`
    );
  }

  return bullets(lines);
}

/** Every name a member answers to on the network: its container name and its Compose service name. */
function namesOnNetwork(members: Array<{ container: string; service: string | null }>): string[] {
  const names = new Set<string>();
  for (const member of members) {
    names.add(member.container);
    if (member.service) {
      names.add(member.service);
    }
  }

  return [...names].filter(Boolean).sort();
}

/** Whether the environment is up. Only meaningful when it was probed. */
export function renderRuntime(snapshot: AgentContextSnapshot): string {
  if (!snapshot.containers.ok) {
    return snapshot.containers.reason === 'unavailable'
      ? bullets([
          'Docker could not be reached, so it is unknown whether Runestone is running. ' +
            'Ask the user to run `runestone up` if routes do not resolve.'
        ])
      : bullets([
          'Container state was not checked here: this text is rendered without querying Docker. ' +
            '`runestone status` says whether Runestone is running.'
        ]);
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
/**
 * Shared resources the user declared, so an agent uses them instead of adding
 * its own database or cache. Each gives the address from the host and from a
 * container, because which one applies is where agents go wrong.
 */
export function renderResources(snapshot: AgentContextSnapshot): string {
  if (snapshot.resources.length === 0) {
    return bullets([
      'None declared. If this project needs a database, a cache or another backing service, ask the user whether ' +
        'one already runs on this machine before adding its own; `runestone resource add` is how the user records one.'
    ]);
  }

  const lines = snapshot.resources.map(
    (resource) =>
      `${resource.name} (${resource.kind}): from a process on the host \`${resource.hostAccess}\`; ` +
      `from a container \`${resource.containerAccess}\`.${resource.notes ? ` ${resource.notes}` : ''}`
  );
  if (snapshot.resources.some((resource) => resource.containerAccess.startsWith('host.docker.internal:'))) {
    lines.push(
      'A container reaches `host.docker.internal` only with `extra_hosts: ["host.docker.internal:host-gateway"]` on its service.'
    );
  }
  lines.push('Declared by the user, not verified by Runestone. Credentials are not stored here; ask the user for them.');

  return bullets(lines);
}

export function contextBlocks(snapshot: AgentContextSnapshot): BlockRenderers {
  return {
    RESOURCES: () => renderResources(snapshot),
    DOMAINS: () => renderDomains(snapshot),
    USED_NAMES: () => renderUsedNames(snapshot),
    RUNTIME: () => renderRuntime(snapshot),
    WARNINGS: () => renderWarnings(snapshot),
    DNS_STATE: () => renderDnsState(snapshot)
  };
}
