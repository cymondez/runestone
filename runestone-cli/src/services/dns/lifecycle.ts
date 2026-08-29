import * as fs from 'fs';
import * as path from 'path';
import { RunestoneEnv, envLoader } from '../../utils/env-loader';
import { DnsOwnershipState, toolState } from '../../utils/tool-state';
import { COMPOSE_SERVICES, DNS_PROFILE, DockerContainer, composeService } from '../docker-compose';
import { execService } from '../docker-exec';
import {
  Identification,
  OwnedEntry,
  insertOwnedEntries,
  readDnsArray,
  reconcileOwnedEntries,
  removeOwnedEntries
} from './daemon-config';
import { readDaemonConfig, writeDaemonConfig } from './daemon-file';
import {
  DaemonEnvironment,
  detectDaemonEnvironment,
  resolveDaemonConfigTarget,
  sameDaemonPath
} from './daemon-target';
import {
  DESKTOP_SAFE_RESTART_VERSION,
  TargetIpResult,
  desktopRestartIsSafe,
  readDesktopVersion,
  resolveTargetIp
} from './environment';
import { isAutoReorderEnabled, isDnsEnabled, ownedEntryInputs } from './settings';
import { dnsContainerName } from './ui-route';
import { UpstreamResolution, defaultHostResolvers, determineUpstreams } from './upstream';

/**
 * What the commands users already run have to do about DNS (spec 10.4).
 *
 * This is the first place where an existing command path touches DNS code, so
 * every function here has the same shape — **decide first, act second** — and
 * when DNS is off the decision is always to do nothing. For a user who never ran
 * `dns enable`, `up`, `stop`, `down`, `certs` and `doctor` must behave exactly as
 * they did before.
 *
 * The second rule this file exists to hold: **nothing here restarts Docker.**
 * `up` is a routine command and a Docker restart terminates every container on
 * the machine, so the reordering and rotation paths write the file and say when
 * it takes effect (spec 9.6). Restarting the *dns service* is a different thing
 * entirely — one container, ours — and that is allowed.
 */

export interface LifecycleDependencies {
  /**
   * Which machine this is (spec 6.2). Injectable because resolving it probes
   * `docker info`: a test that cannot state its own machine ends up asserting
   * whatever machine the suite happens to run on.
   */
  environment: () => DaemonEnvironment;
  readDaemon: (daemonPath: string) => { text: string; existed: boolean };
  writeDaemon: (daemonPath: string, text: string) => void;
  readRecord: () => DnsOwnershipState | undefined;
  writeRecord: (state: DnsOwnershipState) => void;
  writeEnv: (envPath: string, values: Record<string, string>) => void;
  listContainers: (composePath: string) => DockerContainer[];
  /** `managed.conf` as the running container actually has it. */
  readManagedConf: (containerName: string) => string;
  restartDnsService: (composePath: string) => void;
  /** `up -d dns`: an environment change needs the container recreated, not restarted. */
  recreateDnsService: (composePath: string) => void;
  targetIp: (image: string) => TargetIpResult;
  /** Docker Desktop's own version, for the restart-safety check. */
  desktopVersion: () => ReturnType<typeof readDesktopVersion>;
  readDir: (dir: string) => string[];
  now: () => string;
}

export const defaultLifecycleDependencies: LifecycleDependencies = {
  environment: () => detectDaemonEnvironment(),
  readDaemon: readDaemonConfig,
  writeDaemon: writeDaemonConfig,
  readRecord: () => toolState.readDnsState(),
  writeRecord: (state) => toolState.writeDnsState(state),
  writeEnv: (envPath, values) => envLoader.write(envPath, values),
  listContainers: (composePath) => composeService.ps(composePath),
  readManagedConf: (containerName) => execService.exec(containerName, ['cat', '/etc/dnsmasq.d/managed.conf']),
  restartDnsService: (composePath) => composeService.restart(composePath, [COMPOSE_SERVICES.dns]),
  recreateDnsService: (composePath) =>
    composeService.up(composePath, { profiles: [DNS_PROFILE], services: [COMPOSE_SERVICES.dns] }),
  targetIp: (image) => resolveTargetIp(image),
  desktopVersion: () => readDesktopVersion(),
  readDir: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []),
  now: () => new Date().toISOString()
};

export function dnsImage(config: Pick<RunestoneEnv, 'RUNESTONE_IMAGE' | 'RUNESTONE_TAG'>): string {
  return `${config.RUNESTONE_IMAGE}:${config.RUNESTONE_TAG}`;
}

/**
 * The entrypoint's own domain rule, character for character (spec 8.3). It is
 * duplicated rather than shared because the two live in different languages on
 * different sides of a container boundary; the image verification test is what
 * keeps them honest.
 */
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The certificate-covered domains, derived exactly as the entrypoint derives
 * them: filenames only, `rootCA.crt` excluded, anything that is not a domain
 * skipped. Certificate contents are never read.
 */
export function certificateDomains(
  projectDir: string,
  readDir: LifecycleDependencies['readDir'] = defaultLifecycleDependencies.readDir
): string[] {
  return readDir(path.join(projectDir, 'certs'))
    .filter((name) => name.endsWith('.crt'))
    .map((name) => path.basename(name, '.crt'))
    .filter((name) => name !== 'rootCA')
    .map((name) => name.toLowerCase())
    .filter((domain) => DOMAIN.test(domain))
    .sort((left, right) => left.localeCompare(right));
}

export function buildManagedMappings(domains: string[], targetIp: string): string[] {
  return domains.map((domain) => `address=/${domain}/${targetIp}`);
}

/** Only the `address=` lines matter; the generated header and blank lines do not. */
export function parseManagedMappings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('address=/'));
}

export interface MappingState {
  domains: string[];
  targetIp: string;
  desired: string[];
  /** Undefined when the container is not running or could not be read. */
  actual?: string[];
  running: boolean;
  containerName: string;
  changed: boolean;
  error?: string;
}

function dnsContainerState(
  config: RunestoneEnv,
  deps: LifecycleDependencies
): { running: boolean; error?: string } {
  try {
    const container = deps
      .listContainers(config.COMPOSE_FILE_PATH)
      .find((candidate) => candidate.Service === COMPOSE_SERVICES.dns);
    return { running: container?.State === 'running' };
  } catch (thrown) {
    return { running: false, error: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

/**
 * Whether the running container's mappings still match the certificates on disk.
 *
 * The question is asked of the container rather than of a remembered domain set,
 * because the container is the only place the answer actually lives: an image
 * pull, a crash restart or a host reboot all regenerate it with no CLI involved
 * (spec 8.3), and a remembered set would drift from all three.
 */
export function readMappingState(
  config: RunestoneEnv,
  targetIp: string,
  dependencies: Partial<LifecycleDependencies> = {}
): MappingState {
  const deps = { ...defaultLifecycleDependencies, ...dependencies };
  const domains = certificateDomains(config.PROJECT_DIR, deps.readDir);
  const desired = buildManagedMappings(domains, targetIp);
  const containerName = dnsContainerName(config);
  const state = dnsContainerState(config, deps);

  if (!state.running) {
    return { domains, targetIp, desired, running: false, containerName, changed: false, error: state.error };
  }

  try {
    const actual = parseManagedMappings(deps.readManagedConf(containerName));
    return {
      domains,
      targetIp,
      desired,
      actual,
      running: true,
      containerName,
      changed: actual.join('\n') !== desired.join('\n')
    };
  } catch (thrown) {
    return {
      domains,
      targetIp,
      desired,
      running: true,
      containerName,
      changed: false,
      error: thrown instanceof Error ? thrown.message : String(thrown)
    };
  }
}

export interface MappingSyncResult {
  enabled: boolean;
  state?: MappingState;
  restarted: boolean;
}

/**
 * Spec 10.4: a certificate change regenerates the mappings, and only when the
 * set actually changed. A service-scoped restart is what regenerates them, and
 * it touches one container — never Docker itself.
 */
export function syncDnsMappings(
  config: RunestoneEnv,
  dependencies: Partial<LifecycleDependencies> = {}
): MappingSyncResult {
  if (!isDnsEnabled(config)) {
    return { enabled: false, restarted: false };
  }

  const deps = { ...defaultLifecycleDependencies, ...dependencies };
  const state = readMappingState(config, config.DNS_HOST_IP.trim(), deps);

  if (!state.changed) {
    return { enabled: true, state, restarted: false };
  }

  deps.restartDnsService(config.COMPOSE_FILE_PATH);
  return { enabled: true, state, restarted: true };
}

export type UpDnsStatus =
  | 'disabled'
  | 'no-record'
  | 'path-mismatch'
  | 'daemon-unreadable'
  | 'conflict'
  | 'rotate'
  | 'reorder'
  | 'not-at-front'
  | 'ok';

export interface UpDnsPlan {
  status: UpDnsStatus;
  daemonPath: string;
  record?: DnsOwnershipState;
  before: string;
  after: string;
  changesFile: boolean;
  entries: OwnedEntry[];
  identifications: Identification[];
  conflicts: Identification[];
  atFront: boolean;
  recordedTargetIp?: string;
  detectedTargetIp?: string;
  /** Set when the Target IP could not be detected; never fatal for `up`. */
  probeError?: string;
  envUpdates: Record<string, string>;
  message?: string;
}

/**
 * Spec 10.4 for `up`: reconcile Target IP rotation, then position, and never
 * restart Docker. Reads only — the writing is `applyUpDns`.
 */
export function planUpDns(
  config: RunestoneEnv,
  dependencies: Partial<LifecycleDependencies> = {}
): UpDnsPlan {
  const deps = { ...defaultLifecycleDependencies, ...dependencies };
  const target = resolveDaemonConfigTarget(deps.environment());

  const base: UpDnsPlan = {
    status: 'ok',
    daemonPath: target.path,
    before: '{}',
    after: '{}',
    changesFile: false,
    entries: [],
    identifications: [],
    conflicts: [],
    atFront: true,
    envUpdates: {}
  };

  if (!isDnsEnabled(config)) {
    return { ...base, status: 'disabled' };
  }

  const record = deps.readRecord();
  if (!record || record.insertedEntries.length === 0) {
    return { ...base, status: 'no-record' };
  }

  if (!sameDaemonPath(record.daemonPath, target.path)) {
    return { ...base, status: 'path-mismatch', record, daemonPath: target.path };
  }

  let before: string;
  try {
    before = deps.readDaemon(target.path).text;
  } catch (thrown) {
    return {
      ...base,
      status: 'daemon-unreadable',
      record,
      message: thrown instanceof Error ? thrown.message : String(thrown)
    };
  }

  const probe = deps.targetIp(dnsImage(config));
  const detected = probe.ip;
  const withFile: UpDnsPlan = {
    ...base,
    record,
    before,
    after: before,
    entries: record.insertedEntries,
    recordedTargetIp: record.targetIp,
    detectedTargetIp: detected,
    probeError: probe.error
  };

  // Spec 9.4. Rotation is remove-then-insert in one transaction, so the array is
  // never left holding both addresses.
  if (detected && detected !== record.targetIp) {
    const removal = removeOwnedEntries(before, record.insertedEntries, {
      createdDnsKey: record.createdDnsKey
    });

    if (removal.conflicts.length > 0) {
      return {
        ...withFile,
        status: 'conflict',
        identifications: removal.identifications,
        conflicts: removal.conflicts
      };
    }

    const desired = ownedEntryInputs({ ...config, DNS_HOST_IP: detected });
    const inserted = insertOwnedEntries(removal.text, desired);

    return {
      ...withFile,
      status: 'rotate',
      after: inserted.text,
      changesFile: inserted.text !== before,
      entries: inserted.entries,
      identifications: removal.identifications,
      envUpdates: { DNS_HOST_IP: detected }
    };
  }

  const reconciled = reconcileOwnedEntries(before, record.insertedEntries, {
    autoReorder: isAutoReorderEnabled(config)
  });

  if (reconciled.conflicts.length > 0) {
    return {
      ...withFile,
      status: 'conflict',
      identifications: reconciled.identifications,
      conflicts: reconciled.conflicts,
      atFront: reconciled.atFront
    };
  }

  if (reconciled.changed) {
    return {
      ...withFile,
      status: 'reorder',
      after: reconciled.text,
      changesFile: true,
      entries: reconciled.entries,
      identifications: reconciled.identifications,
      atFront: reconciled.atFront
    };
  }

  return {
    ...withFile,
    status: reconciled.atFront ? 'ok' : 'not-at-front',
    identifications: reconciled.identifications,
    atFront: reconciled.atFront
  };
}

export interface UpDnsResult {
  plan: UpDnsPlan;
  wroteDaemon: boolean;
  wroteEnv: boolean;
  recreatedService: boolean;
  mappings?: MappingState;
  restartedService: boolean;
  error?: string;
}

/**
 * Applies what `planUpDns` decided.
 *
 * A daemon write here is deliberately **not** followed by a Docker restart: the
 * change is real, it is recorded, and it takes effect the next time Docker is
 * restarted by someone who meant to. The record therefore goes back to
 * `prepared`, because that is exactly what it now is — a written change Docker
 * has not read.
 */
export function applyUpDns(
  config: RunestoneEnv,
  plan: UpDnsPlan,
  dependencies: Partial<LifecycleDependencies> = {}
): UpDnsResult {
  const deps = { ...defaultLifecycleDependencies, ...dependencies };
  const result: UpDnsResult = {
    plan,
    wroteDaemon: false,
    wroteEnv: false,
    recreatedService: false,
    restartedService: false
  };

  if (plan.status === 'disabled') {
    return result;
  }

  const targetIp = plan.detectedTargetIp ?? config.DNS_HOST_IP.trim();

  if ((plan.status === 'rotate' || plan.status === 'reorder') && plan.record) {
    if (Object.keys(plan.envUpdates).length > 0) {
      deps.writeEnv(config.ENV_PATH, plan.envUpdates);
      result.wroteEnv = true;
    }

    if (plan.changesFile) {
      deps.writeDaemon(plan.daemonPath, plan.after);
      result.wroteDaemon = true;
      deps.writeRecord({
        ...plan.record,
        phase: 'prepared',
        preparedReason: 'no-restart',
        targetIp,
        insertedEntries: plan.entries,
        updatedAt: deps.now()
      });
    }

    if (result.wroteEnv) {
      try {
        deps.recreateDnsService(config.COMPOSE_FILE_PATH);
        result.recreatedService = true;
      } catch (thrown) {
        result.error = thrown instanceof Error ? thrown.message : String(thrown);
      }
    }
  }

  // A recreated container has just regenerated its mappings, so there is nothing
  // left to refresh.
  if (result.recreatedService) {
    return result;
  }

  const mappings = readMappingState({ ...config, DNS_HOST_IP: targetIp }, targetIp, deps);
  result.mappings = mappings;

  if (mappings.changed) {
    try {
      deps.restartDnsService(config.COMPOSE_FILE_PATH);
      result.restartedService = true;
    } catch (thrown) {
      result.error = thrown instanceof Error ? thrown.message : String(thrown);
    }
  }

  return result;
}

export type DnsHealthStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type DnsHealthCheckId =
  | 'ownership'
  | 'position'
  | 'service'
  | 'targetIp'
  | 'mappings'
  | 'desktopRestart';

export interface DnsHealthCheck {
  id: DnsHealthCheckId;
  status: DnsHealthStatus;
  detail: Record<string, string | number>;
}

export interface DnsHealthReport {
  enabled: boolean;
  checks: DnsHealthCheck[];
}

/**
 * Spec 10.4 for `doctor`: **report only, never auto-correct.** Every dependency
 * used here is a read. Correcting a daemon `dns` array from a diagnostic command
 * is precisely the guessing that spec 9.3 forbids — `doctor` says what it sees
 * and names the command that would fix it.
 */
export function checkDnsHealth(
  config: RunestoneEnv,
  dependencies: Partial<LifecycleDependencies> = {}
): DnsHealthReport {
  if (!isDnsEnabled(config)) {
    return { enabled: false, checks: [] };
  }

  const deps = { ...defaultLifecycleDependencies, ...dependencies };
  const target = resolveDaemonConfigTarget(deps.environment());
  const checks: DnsHealthCheck[] = [];
  const record = deps.readRecord();

  if (!record || record.insertedEntries.length === 0) {
    checks.push({ id: 'ownership', status: 'fail', detail: { path: target.path } });
    return { enabled: true, checks };
  }

  if (!sameDaemonPath(record.daemonPath, target.path)) {
    checks.push({
      id: 'ownership',
      status: 'fail',
      detail: { recorded: record.daemonPath, actual: target.path }
    });
    return { enabled: true, checks };
  }

  checks.push({
    id: 'ownership',
    status: record.phase === 'applied' ? 'pass' : 'warn',
    detail: { phase: record.phase, reason: record.preparedReason ?? '', path: record.daemonPath }
  });

  const plan = planUpDns(config, { ...deps, targetIp: () => ({ ip: record.targetIp }) });

  if (plan.status === 'daemon-unreadable') {
    checks.push({ id: 'position', status: 'fail', detail: { path: target.path, message: plan.message ?? '' } });
  } else if (plan.conflicts.length > 0) {
    checks.push({
      id: 'position',
      status: 'fail',
      detail: { values: plan.conflicts.map((conflict) => conflict.value).join(', ') }
    });
  } else {
    const positions = plan.identifications
      .filter((identification) => identification.status === 'matched')
      .map((identification) => `${identification.value}@${identification.index}`)
      .join(', ');

    checks.push({
      id: 'position',
      status: plan.atFront ? 'pass' : 'warn',
      detail: { positions, autoReorder: String(isAutoReorderEnabled(config)) }
    });
  }

  const state = dnsContainerState(config, deps);
  checks.push({
    id: 'service',
    status: state.running ? 'pass' : 'fail',
    detail: { name: dnsContainerName(config), error: state.error ?? '' }
  });

  // Whether a future `dns enable` may restart Docker for you, or will hand that
  // step back. Worth reporting from a diagnostic, because the answer decides
  // whether an enable can finish on its own — and because the remedy is an
  // update the user has to choose to install.
  if (target.host === 'docker-desktop') {
    const version = deps.desktopVersion();
    if (!version?.version) {
      checks.push({ id: 'desktopRestart', status: 'skip', detail: { minimum: DESKTOP_SAFE_RESTART_VERSION } });
    } else {
      checks.push({
        id: 'desktopRestart',
        status: desktopRestartIsSafe(version) ? 'pass' : 'warn',
        detail: { version: version.version, minimum: DESKTOP_SAFE_RESTART_VERSION }
      });
    }
  }

  const probe = deps.targetIp(dnsImage(config));
  if (!probe.ip) {
    checks.push({ id: 'targetIp', status: 'skip', detail: { message: probe.error ?? '' } });
  } else {
    checks.push({
      id: 'targetIp',
      status: probe.ip === record.targetIp ? 'pass' : 'warn',
      detail: { recorded: record.targetIp, detected: probe.ip }
    });
  }

  if (!state.running) {
    checks.push({ id: 'mappings', status: 'skip', detail: { reason: 'not-running' } });
    return { enabled: true, checks };
  }

  const mappings = readMappingState(config, record.targetIp, deps);
  checks.push({
    id: 'mappings',
    status: mappings.error ? 'skip' : mappings.changed ? 'warn' : 'pass',
    detail: mappings.error
      ? { reason: 'unreadable', message: mappings.error }
      : { domains: mappings.domains.length, mapped: mappings.actual?.length ?? 0 }
  });

  return { enabled: true, checks };
}

export interface DnsSetupFacts {
  daemonPath: string;
  requiresPrivilege: boolean;
  upstreams: UpstreamResolution;
}

/**
 * The real values the setup questions have to carry (spec 11.3: the user
 * consents to concrete actions, not to abstract warnings). Reads only — setup
 * must be able to ask about DNS on a machine where Docker is not even running.
 */
export function dnsSetupFacts(
  config: RunestoneEnv,
  dependencies: Partial<LifecycleDependencies & { hostResolvers: () => string[] }> = {}
): DnsSetupFacts {
  const deps = { ...defaultLifecycleDependencies, ...dependencies };
  const target = resolveDaemonConfigTarget(deps.environment());

  let daemonEntries: string[] | undefined;
  try {
    daemonEntries = readDnsArray(deps.readDaemon(target.path).text).values.filter(
      (value): value is string => typeof value === 'string'
    );
  } catch {
    daemonEntries = undefined;
  }

  const hostResolvers = dependencies.hostResolvers ?? defaultHostResolvers;

  return {
    daemonPath: target.path,
    requiresPrivilege: target.requiresPrivilege,
    upstreams: determineUpstreams({
      configured: config.DNS_UPSTREAM,
      daemonEntries,
      hostResolvers: hostResolvers(),
      targetIp: config.DNS_HOST_IP.trim() || undefined
    })
  };
}

export interface StopTargets {
  services: string[];
  profiles: string[];
  /** True when the dns service is deliberately being left running (spec 11.3 item 5). */
  keepsDns: boolean;
}

/**
 * Spec 10.4 for `stop`. **`stop` leaves the dns service running**: the daemon
 * still points at it, so stopping it would break name resolution for every
 * container on the machine, including projects that have nothing to do with
 * Runestone. `--all` stops it too, after saying so.
 *
 * With DNS off this returns the unscoped project stop, byte for byte what the
 * command did before this milestone.
 */
export function stopTargets(config: RunestoneEnv, all: boolean): StopTargets {
  if (!isDnsEnabled(config)) {
    return { services: [], profiles: [], keepsDns: false };
  }

  if (all) {
    return { services: [], profiles: [DNS_PROFILE], keepsDns: false };
  }

  return { services: [COMPOSE_SERVICES.runestone], profiles: [], keepsDns: true };
}
