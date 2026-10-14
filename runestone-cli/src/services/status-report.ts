/**
 * What `runestone status` reports, as data.
 *
 * The command used to print four sections of raw facts with no conclusion:
 * whether Runestone could be used at all was left for the reader to work out,
 * and an AI agent reading it could not. This module decides that once, as a
 * `verdict`, and attaches to every problem the command that fixes it. The
 * command renders it as text or prints it as JSON, following the precedent of
 * `dns status`, whose report is likewise built here and rendered there.
 *
 * Nothing here prints. Every probe that can fail becomes a value, so the report
 * is complete even when Docker or Traefik cannot be reached.
 */

import { AgentContextSnapshot, SnapshotCertificate, SnapshotContainer, SnapshotService, buildLiveSnapshot } from './agent-context/snapshot';
import { COMPOSE_SERVICES, composeService } from './docker-compose';
import { networkService } from './docker-network';
import { volumeService } from './docker-volume';
import { isDnsEnabled, isDnsUiAuthConfigured, isDnsUiEnabled } from './dns/settings';
import { dnsUiUrl } from './dns/ui-route';
import { certificateBaseDomainForRoute } from './service-manager';
import { sshManager } from './ssh-manager';
import { t } from '../i18n';
import { SmtpEndpoints, mailpitUiUrl, smtpEndpoints, traefikDashboardUrl } from '../utils/endpoints';
import { RunestoneEnv, envLoader } from '../utils/env-loader';
import { DnsOwnershipState, toolState } from '../utils/tool-state';
import { packageVersion } from '../utils/version';

/**
 * Most severe first. `degraded` means Runestone is running and something still
 * needs attention; `ready` means nothing does.
 */
export type StatusVerdict = 'not-configured' | 'docker-unreachable' | 'stopped' | 'degraded' | 'ready';

export interface StatusProblem {
  /** What is wrong, in one sentence. */
  text: string;
  /** What fixes it: a command to run, or the one thing to do. */
  fix: string;
}

export interface StatusReport {
  /** The contract version of `status --json`. */
  schemaVersion: 1;
  generatedAt: string;
  verdict: StatusVerdict;
  cliVersion: string;
  runestoneDir: string;
  hostDomain: string;
  /** What Runestone already runs for every project. From `.env`, so always present. */
  provides: { traefikDashboard: string; mailpitUi: string; smtp: SmtpEndpoints };
  /** Null when Docker was not asked, because Runestone is not configured. */
  containers: SnapshotContainer[] | null;
  /** Null when Docker could not be reached, so the question had no answer. */
  network: { name: string; exists: boolean | null };
  volume: { name: string; exists: boolean | null };
  sshKeys: string[] | null;
  traefikApi: { url: string; reachable: boolean | null; error: string | null };
  /** Router IDs Traefik reports, from every project. Null when it could not be asked. */
  traefikRouters: string[] | null;
  dns: {
    enabled: boolean;
    /** From the ownership record: `prepared` is written but not yet in effect. */
    phase: string | null;
    preparedReason: string | null;
    serviceRunning: boolean | null;
  };
  certificates: SnapshotCertificate[];
  /** Whether the system trust store holds Runestone's root CA. */
  caTrust: string;
  covered: { wildcards: string[]; names: string[] };
  /** Routes added with `runestone service add`. */
  routes: SnapshotService[];
  problems: StatusProblem[];
}

export interface StatusReportDependencies {
  isConfigured: (config: RunestoneEnv) => boolean;
  snapshot: (config: RunestoneEnv) => Promise<AgentContextSnapshot>;
  networkExists: (name: string) => boolean;
  volumeExists: (name: string) => boolean;
  listSshKeys: (volumeName: string) => string[];
  readDnsRecord: () => DnsOwnershipState | undefined;
  now: () => Date;
  cliVersion: () => string;
}

/**
 * The container probe keeps `composeService.ps`'s own thirty-second default,
 * unlike the eight seconds the agent-context path uses: `status` is run by a
 * person, or by an agent asked to find out what is wrong, and a cold daemon is
 * worth waiting for there.
 */
export const defaultStatusReportDependencies: StatusReportDependencies = {
  isConfigured: (config) => envLoader.hasRequiredVars(config),
  snapshot: (config) => buildLiveSnapshot(config, { listContainers: (composePath) => composeService.ps(composePath) }),
  networkExists: (name) => networkService.exists(name),
  volumeExists: (name) => volumeService.exists(name),
  listSshKeys: (volumeName) => sshManager.listKeys(volumeName),
  readDnsRecord: () => toolState.readDnsState(),
  now: () => new Date(),
  cliVersion: () => packageVersion()
};

function messageOf(probe: { ok: false; message?: string }): string {
  return probe.message ?? 'unknown error';
}

/** The base domain a certificate for this name would be created for, if any. */
function certificateCommandFor(name: string): string | undefined {
  try {
    return `runestone certs create ${certificateBaseDomainForRoute(name)}`;
  } catch {
    return undefined;
  }
}

function provides(config: RunestoneEnv): StatusReport['provides'] {
  return {
    traefikDashboard: traefikDashboardUrl(config.HOST_DOMAIN),
    mailpitUi: mailpitUiUrl(config.HOST_DOMAIN),
    smtp: smtpEndpoints(config)
  };
}

function notConfigured(config: RunestoneEnv, deps: StatusReportDependencies): StatusReport {
  return {
    schemaVersion: 1,
    generatedAt: deps.now().toISOString(),
    verdict: 'not-configured',
    cliVersion: deps.cliVersion(),
    runestoneDir: config.PROJECT_DIR,
    hostDomain: config.HOST_DOMAIN,
    provides: provides(config),
    containers: null,
    network: { name: config.NETWORK_NAME, exists: null },
    volume: { name: config.SSH_VOLUME_NAME, exists: null },
    sshKeys: null,
    traefikApi: { url: traefikDashboardUrl(config.HOST_DOMAIN), reachable: null, error: null },
    traefikRouters: null,
    dns: { enabled: isDnsEnabled(config), phase: null, preparedReason: null, serviceRunning: null },
    certificates: [],
    caTrust: 'unknown',
    covered: { wildcards: [], names: [] },
    routes: [],
    problems: [{ text: t('status.problem.notConfigured'), fix: 'runestone setup' }]
  };
}

export async function buildStatusReport(
  config: RunestoneEnv,
  overrides: Partial<StatusReportDependencies> = {}
): Promise<StatusReport> {
  const deps = { ...defaultStatusReportDependencies, ...overrides };
  if (!deps.isConfigured(config)) {
    return notConfigured(config, deps);
  }

  const snapshot = await deps.snapshot(config);
  const dockerReachable = snapshot.containers.ok;
  const containers = snapshot.containers.ok ? snapshot.containers.value : null;
  const runestone = containers?.find((container) => container.service === COMPOSE_SERVICES.runestone);
  const runestoneRunning = runestone?.state === 'running';
  const dnsContainer = containers?.find((container) => container.service === COMPOSE_SERVICES.dns);
  const dnsEnabled = isDnsEnabled(config);
  const record = deps.readDnsRecord();
  const traefikUrl = traefikDashboardUrl(config.HOST_DOMAIN);

  // Asked only when Docker answered: with the daemon down these would all come
  // back "missing", which is a different and wrong answer.
  const networkExists = dockerReachable ? deps.networkExists(config.NETWORK_NAME) : null;
  const volumeExists = dockerReachable ? deps.volumeExists(config.SSH_VOLUME_NAME) : null;
  const sshKeys = dockerReachable ? deps.listSshKeys(config.SSH_VOLUME_NAME) : null;

  const problems: StatusProblem[] = [];

  if (!snapshot.containers.ok) {
    problems.push({
      text: t('status.problem.dockerUnreachable', { message: messageOf(snapshot.containers) }),
      fix: t('status.fix.startDocker')
    });
  } else if (!runestoneRunning) {
    problems.push({ text: t('status.problem.stopped'), fix: 'runestone up' });
  }

  if (networkExists === false) {
    problems.push({ text: t('status.problem.networkMissing', { network: config.NETWORK_NAME }), fix: 'runestone up' });
  }

  if (runestoneRunning && !snapshot.traefik.ok) {
    problems.push({
      text: t('status.problem.traefikUnreachable', { url: traefikUrl, message: messageOf(snapshot.traefik) }),
      fix: t('status.fix.traefikUnreachable', { url: traefikUrl })
    });
  }

  if (dnsEnabled && dockerReachable && dnsContainer?.state !== 'running') {
    problems.push({ text: t('status.problem.dnsServiceDown'), fix: 'runestone up' });
  }

  if (dnsEnabled && record?.phase === 'prepared') {
    problems.push(
      record.preparedReason === 'no-restart'
        ? { text: t('status.problem.dnsPendingRestart'), fix: t('status.fix.dnsPendingRestart') }
        : { text: t('status.problem.dnsUnfinished'), fix: 'runestone dns status' }
    );
  }

  // `dns status` already discloses this; `status` said nothing, so its verdict
  // read "ready" on a machine whose DNS rules anyone on the network could edit.
  // The route only exists when both DNS and its UI are on (ui-route.ts).
  if (dnsEnabled && isDnsUiEnabled(config) && !isDnsUiAuthConfigured(config)) {
    problems.push({
      text: t('status.problem.dnsUiNoAuth', { url: dnsUiUrl(config) }),
      fix: t('status.fix.dnsUiNoAuth', { envPath: config.ENV_PATH })
    });
  }

  // Every hostname warns until the root CA is trusted, and only the user can
  // fix it: installing needs elevation.
  if (snapshot.caTrust === 'not-trusted') {
    problems.push({ text: t('status.problem.caNotTrusted'), fix: t('status.fix.caNotTrusted') });
  }

  if (snapshot.certificates.length === 0) {
    problems.push({
      text: t('status.problem.noCertificates'),
      fix: `runestone certs create ${config.HOST_DOMAIN}`
    });
  }

  for (const certificate of snapshot.certificates.filter((item) => !item.valid)) {
    const names = certificate.sans.join(', ') || t('status.unknownNames');
    const base = certificate.sans.find((san) => san.startsWith('*.'))?.slice(2) ?? certificate.sans[0];
    problems.push({
      text: t('status.problem.invalidCertificate', { names }),
      fix: base ? `runestone certs create ${base}` : 'runestone certs list'
    });
  }

  for (const route of snapshot.services.filter((service) => !service.dynamicConfigExists)) {
    problems.push({
      text: t('status.problem.routeMissingConfig', { name: route.name, route: route.route }),
      fix: `runestone service repair ${route.name}`
    });
  }

  for (const route of snapshot.services.filter((service) => !service.certificateCovered)) {
    problems.push({
      text: t('status.problem.routeUncovered', { route: route.route }),
      fix: certificateCommandFor(route.route) ?? 'runestone certs list'
    });
  }

  const verdict: StatusVerdict = !dockerReachable
    ? 'docker-unreachable'
    : !runestoneRunning
      ? 'stopped'
      : problems.length > 0
        ? 'degraded'
        : 'ready';

  return {
    schemaVersion: 1,
    generatedAt: deps.now().toISOString(),
    verdict,
    cliVersion: deps.cliVersion(),
    runestoneDir: config.PROJECT_DIR,
    hostDomain: config.HOST_DOMAIN,
    provides: provides(config),
    containers,
    network: { name: config.NETWORK_NAME, exists: networkExists },
    volume: { name: config.SSH_VOLUME_NAME, exists: volumeExists },
    sshKeys,
    traefikApi: {
      url: traefikUrl,
      reachable: snapshot.traefik.ok ? true : snapshot.traefik.reason === 'unavailable' ? false : null,
      error: snapshot.traefik.ok ? null : snapshot.traefik.message ?? null
    },
    traefikRouters: snapshot.traefik.ok ? snapshot.traefik.value.routers.map((router) => router.name) : null,
    dns: {
      enabled: dnsEnabled,
      phase: record?.phase ?? null,
      preparedReason: record?.phase === 'prepared' ? record.preparedReason ?? 'unknown' : null,
      serviceRunning: dnsContainer ? dnsContainer.state === 'running' : containers ? false : null
    },
    certificates: snapshot.certificates,
    caTrust: snapshot.caTrust,
    covered: { wildcards: snapshot.domains.wildcards, names: snapshot.domains.covered },
    routes: snapshot.services,
    problems
  };
}
