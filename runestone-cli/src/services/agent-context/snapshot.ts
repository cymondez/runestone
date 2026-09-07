/**
 * The machine facts an agent needs in order to connect a project to Runestone.
 *
 * This module lives under `src/services/` because it composes other services.
 * **It does not spawn a process and must not start.** That is worth stating
 * because `tests/integration/design-acceptance.test.ts` permits `child_process`
 * under `src/services/` and nowhere else, which reads as an invitation here and
 * is the opposite of the intent: the offline tier is asserted to spawn nothing,
 * and the online tier reaches Docker only through the injected dependencies
 * below.
 *
 * Every field is JSON-shaped from the outset — no `Date`, no `undefined`, no
 * class instance, no display glyph — so that a future `--json` is a second
 * renderer over this value rather than a rewrite. A test asserts the round trip.
 */

import { CertificateListItem, listDomainCertificates } from '../cert-manager';
import { DockerContainer, composeService } from '../docker-compose';
import { isDnsEnabled } from '../dns/settings';
import { ServiceListItem, findCoveringCertificate, listServices } from '../service-manager';
import { TraefikSnapshot, readTraefikSnapshot, traefikApiBaseUrl } from '../traefik-api';
import { RunestoneEnv } from '../../utils/env-loader';
import { Probe, probe, probeAsync, skipped } from './probe';

export type ProbeMode = 'offline' | 'live';

export interface SnapshotEnvironment {
  hostDomain: string;
  prefix: string;
  networkName: string;
  httpEntrypoint: { name: string; port: string };
  httpsEntrypoint: { name: string; port: string };
  runestoneDir: string;
  composeFilePath: string;
  runestoneVersion: string;
}

export interface SnapshotCertificate {
  /**
   * Every name this certificate covers, as read from the certificate's own
   * SANs. Deliberately not derived from the filename: the two can disagree,
   * and the SANs are what a TLS client actually checks.
   */
  sans: string[];
  /** Mapped from `CertificateListItem.status`, which is a display glyph. */
  valid: boolean;
  issuer: string;
  validUntil: string;
  expiresIn: string;
  error?: string;
}

export interface SnapshotService {
  name: string;
  route: string;
  url: string;
  group: string | null;
  dynamicConfigExists: boolean;
  /** Whether a valid certificate covers `route`. False means a TLS warning. */
  certificateCovered: boolean;
}

export interface SnapshotContainer {
  name: string;
  service: string;
  state: string;
  status: string;
}

export interface SnapshotTraefik {
  routers: Array<{ name: string; provider: string; rule: string | null }>;
  services: Array<{ name: string; provider: string }>;
}

export interface AgentContextSnapshot {
  /** The contract version a future `--json` would publish. */
  schemaVersion: 1;
  generatedAt: string;
  probeMode: ProbeMode;
  configured: boolean;
  environment: SnapshotEnvironment;
  domains: {
    hostDomain: string;
    /** Concrete names covered by a valid certificate. */
    covered: string[];
    /** Wildcard patterns, kept apart because they cover one level only. */
    wildcards: string[];
  };
  certificates: SnapshotCertificate[];
  services: SnapshotService[];
  /** What an agent must not collide with. */
  usedNames: { serviceNames: string[]; routes: string[] };
  dns: { enabled: boolean };
  containers: Probe<SnapshotContainer[]>;
  traefik: Probe<SnapshotTraefik>;
  /** Rendered into prose. Never written to stderr. */
  warnings: string[];
}

/**
 * Injected so that the cost tier is explicit at the call site and so that tests
 * need no certificate material and no Docker. The shape follows
 * `DnsStatusDependencies`, which is the pattern in this repository that makes a
 * state report assertable without a machine.
 */
export interface AgentContextDependencies {
  listCertificates: (runestoneDir: string) => CertificateListItem[];
  listServices: (config: RunestoneEnv) => ServiceListItem[];
  now: () => Date;
  /** Online. Spawns `docker compose ps`. */
  listContainers: (composePath: string) => DockerContainer[];
  /** Online. Issues an HTTPS request to Traefik's API. */
  readTraefik: (baseUrl: string) => Promise<TraefikSnapshot>;
}

/**
 * Eight seconds, not the thirty `composeService.ps` defaults to. An agent may
 * call this on every task, and a caller that blocks for half a minute on a
 * stopped daemon is worse than one that reports the fact and moves on — the
 * renderer turns a failed probe into a sentence naming the command that fixes
 * it, so timing out is an answer rather than an error.
 */
export const CONTAINER_PROBE_TIMEOUT_MS = 8000;

export const defaultAgentContextDependencies: AgentContextDependencies = {
  listCertificates: (runestoneDir) => listDomainCertificates(runestoneDir),
  listServices: (config) => listServices(config),
  now: () => new Date(),
  listContainers: (composePath) => composeService.ps(composePath, CONTAINER_PROBE_TIMEOUT_MS),
  readTraefik: (baseUrl) => readTraefikSnapshot(baseUrl)
};

function environmentOf(config: RunestoneEnv): SnapshotEnvironment {
  return {
    hostDomain: config.HOST_DOMAIN,
    prefix: config.PREFIX,
    networkName: config.NETWORK_NAME,
    httpEntrypoint: { name: config.WEB_ENTRYPOINT_NAME, port: config.WEB_ENTRYPOINT_PORT },
    httpsEntrypoint: { name: config.WEB_SECURE_ENTRYPOINT_NAME, port: config.WEB_SECURE_ENTRYPOINT_PORT },
    runestoneDir: config.PROJECT_DIR,
    composeFilePath: config.COMPOSE_FILE_PATH,
    runestoneVersion: config.RUNESTONE_VERSION
  };
}

function certificatesOf(items: CertificateListItem[]): SnapshotCertificate[] {
  return items.map((item) => ({
    sans: [...item.sans],
    valid: item.status === '✓',
    issuer: item.issuer,
    validUntil: item.validUntil,
    expiresIn: item.expiry,
    ...(item.error ? { error: item.error } : {})
  }));
}

/**
 * Only valid certificates contribute coverage. An expired or unreadable one is
 * still reported, in `certificates`, but it must never let a hostname look
 * usable — that would send an agent to a domain the browser refuses.
 */
function domainsOf(config: RunestoneEnv, certificates: SnapshotCertificate[]) {
  const names = certificates.filter((certificate) => certificate.valid).flatMap((certificate) => certificate.sans);
  const unique = (values: string[]) => [...new Set(values)].sort();

  return {
    hostDomain: config.HOST_DOMAIN,
    covered: unique(names.filter((name) => !name.startsWith('*.'))),
    wildcards: unique(names.filter((name) => name.startsWith('*.')))
  };
}

function servicesOf(services: ServiceListItem[], certificates: CertificateListItem[]): SnapshotService[] {
  return services.map((service) => ({
    name: service.name,
    route: service.route,
    url: service.url,
    group: service.group,
    dynamicConfigExists: service.dynamicConfigExists,
    certificateCovered: Boolean(findCoveringCertificate(service.route, certificates))
  }));
}

function warningsOf(certificates: SnapshotCertificate[], services: SnapshotService[]): string[] {
  const warnings: string[] = [];

  if (certificates.length === 0) {
    warnings.push('No certificates have been created yet, so no hostname is covered.');
  }

  const invalid = certificates.filter((certificate) => !certificate.valid);
  if (invalid.length > 0) {
    warnings.push(`${invalid.length} certificate(s) are expired or unreadable and cover nothing.`);
  }

  const orphaned = services.filter((service) => !service.dynamicConfigExists);
  if (orphaned.length > 0) {
    warnings.push(
      `${orphaned.length} routed service(s) are registered but have no dynamic configuration file: ` +
        `${orphaned.map((service) => service.name).join(', ')}. Run 'runestone service repair <name>'.`
    );
  }

  const uncovered = services.filter((service) => !service.certificateCovered);
  if (uncovered.length > 0) {
    warnings.push(
      `${uncovered.length} routed service(s) have no certificate covering their route, so the browser will warn: ` +
        `${uncovered.map((service) => service.route).join(', ')}.`
    );
  }

  // An empty service list is normal on a fresh machine and is not a warning.
  return warnings;
}

/**
 * Build the offline snapshot. Reads `.env`, the certificate directory and the
 * tool state, and nothing else.
 *
 * `containers` and `traefik` come back as `skipped`, which is a different
 * answer from an empty list: it means nobody asked, not that nothing is there.
 */
export function buildOfflineSnapshot(
  config: RunestoneEnv,
  deps: Partial<AgentContextDependencies> = {}
): AgentContextSnapshot {
  const { listCertificates, listServices: readServices, now } = { ...defaultAgentContextDependencies, ...deps };

  // A missing certificate directory is an ordinary state, not a failure, so
  // the probe collapses to an empty list rather than surfacing as a warning
  // about the read itself.
  const rawCertificates = probe(() => listCertificates(config.PROJECT_DIR));
  const certificateItems = rawCertificates.ok ? rawCertificates.value : [];
  const rawServices = probe(() => readServices(config));
  const serviceItems = rawServices.ok ? rawServices.value : [];

  const certificates = certificatesOf(certificateItems);
  const services = servicesOf(serviceItems, certificateItems);
  const warnings = warningsOf(certificates, services);

  if (!rawCertificates.ok) {
    warnings.unshift(`The certificate list could not be read: ${rawCertificates.message ?? 'unknown error'}.`);
  }
  if (!rawServices.ok) {
    warnings.unshift(`The routed service list could not be read: ${rawServices.message ?? 'unknown error'}.`);
  }

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    probeMode: 'offline',
    configured: true,
    environment: environmentOf(config),
    domains: domainsOf(config, certificates),
    certificates,
    services,
    usedNames: {
      serviceNames: services.map((service) => service.name).sort(),
      routes: services.map((service) => service.route).sort()
    },
    dns: { enabled: isDnsEnabled(config) },
    containers: skipped(),
    traefik: skipped(),
    warnings
  };
}

function containersOf(containers: DockerContainer[]): SnapshotContainer[] {
  return containers.map((container) => ({
    name: container.Name,
    service: container.Service,
    state: container.State,
    status: container.Status
  }));
}

/**
 * `TraefikNamedResource.rule` is optional, and an absent key vanishes through
 * `JSON.stringify`. Normalising it to null keeps the shape stable for the
 * schema a future `--json` publishes.
 */
function traefikOf(snapshot: TraefikSnapshot): SnapshotTraefik {
  return {
    routers: snapshot.routers.map((router) => ({
      name: router.name,
      provider: router.name.includes('@') ? router.name.split('@')[1] : '',
      rule: router.rule ?? null
    })),
    services: snapshot.services.map((service) => ({
      name: service.name,
      provider: service.name.includes('@') ? service.name.split('@')[1] : ''
    }))
  };
}

/**
 * The offline snapshot plus the two facts that cannot be read from a file:
 * whether Runestone is running, and what names other projects have already
 * registered with Traefik.
 *
 * The second one is the reason this tier exists. A router or service ID is
 * global to Traefik, so a name that looks free in this project's own service
 * list may already be taken by a project the agent cannot see. Only Traefik
 * knows.
 *
 * Neither probe can fail the call. Both degrade to a value the renderer turns
 * into prose, because `docs --ai-context` asserts an empty stderr and an agent
 * piping stdout must still get a usable answer when Docker is stopped.
 */
export async function buildLiveSnapshot(
  config: RunestoneEnv,
  deps: Partial<AgentContextDependencies> = {}
): Promise<AgentContextSnapshot> {
  const merged = { ...defaultAgentContextDependencies, ...deps };
  const offline = buildOfflineSnapshot(config, merged);

  const containers = probe(() => containersOf(merged.listContainers(config.COMPOSE_FILE_PATH)));
  const traefik = await probeAsync(async () => traefikOf(await merged.readTraefik(traefikApiBaseUrl(config.HOST_DOMAIN))));

  const warnings = [...offline.warnings];
  if (!containers.ok && containers.reason === 'unavailable') {
    warnings.push(`Docker could not be reached: ${containers.message ?? 'unknown error'}.`);
  }
  if (!traefik.ok && traefik.reason === 'unavailable') {
    warnings.push(
      `Traefik could not be reached: ${traefik.message ?? 'unknown error'}. ` +
        'Names registered by other projects could not be checked.'
    );
  }

  return { ...offline, probeMode: 'live', containers, traefik, warnings };
}
