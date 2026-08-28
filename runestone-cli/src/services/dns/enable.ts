import { RunestoneEnv, envLoader } from '../../utils/env-loader';
import { osDetector } from '../../utils/os-detector';
import { ensureProjectFiles } from '../../utils/project-files';
import { DnsOwnershipState, toolState } from '../../utils/tool-state';
import { COMPOSE_SERVICES, DNS_PROFILE, composeService } from '../docker-compose';
import {
  Identification,
  OwnedEntry,
  insertOwnedEntries,
  readDnsArray,
  reconcileOwnedEntries,
  removeOwnedEntries
} from './daemon-config';
import { deleteDaemonConfig, readDaemonConfig, writeDaemonConfig } from './daemon-file';
import { DaemonHost, DockerRestartPlan, resolveDaemonConfigTarget, resolveDockerRestartPlan } from './daemon-target';
import { RestartOutcome, restartDocker } from './docker-restart';
import {
  DockerContextInfo,
  DockerDesktopVersion,
  DockerProbes,
  ResolutionCheck,
  defaultDockerProbes,
  desktopRestartIsSafe,
  readContainerNameservers,
  readDaemonInfo,
  readDesktopVersion,
  readDockerContext,
  resolveTargetIp,
  verifyDomainResolution
} from './environment';
import { isAutoReorderEnabled, ownedEntryInputs } from './settings';
import { syncDnsUiRoute } from './ui-route';
import {
  UpstreamResolution,
  bindPrefix,
  defaultHostResolvers,
  determineBindIp,
  determineUpstreams
} from './upstream';

/**
 * `runestone dns enable` (spec 10.1).
 *
 * The order of the steps is the safety property, not an implementation detail:
 * the daemon configuration is the last thing written and the first thing undone.
 * Everything that can fail — Docker being unavailable, the service not starting,
 * the service starting but not answering — fails **before** the machine's global
 * DNS has been touched at all.
 */

export type PreflightFailure =
  | { kind: 'setup-incomplete' }
  | { kind: 'docker-unavailable'; message: string }
  | { kind: 'windows-containers'; osType: string }
  /**
   * The CLI is running on Linux but the daemon is Docker Desktop — the shape of
   * "the CLI inside WSL, talking to Docker Desktop through its integration".
   * Its configuration lives on the Windows side, so writing this machine's
   * `~/.docker/daemon.json` would report success while changing nothing that
   * Docker ever reads.
   */
  | { kind: 'docker-desktop-elsewhere'; operatingSystem: string }
  | { kind: 'remote-context'; name: string; endpoint: string }
  | { kind: 'target-ip'; message: string }
  | { kind: 'daemon-unreadable'; message: string };

export interface Preflight {
  ok: boolean;
  failures: PreflightFailure[];
  targetIp?: string;
  bindIp?: string;
  context?: DockerContextInfo;
  upstreams: UpstreamResolution;
  daemonPath: string;
  daemonExists: boolean;
  daemonText: string;
  requiresPrivilege: boolean;
  host: DaemonHost;
  /** True when the upstream list fell back to the shipped public default. */
  upstreamIsFallback: boolean;
  restartPlan: DockerRestartPlan;
  /** Docker Desktop's own version, when this is Docker Desktop. */
  desktopVersion?: DockerDesktopVersion;
  /** Whether restarting it automatically would leave containers recoverable. */
  desktopRestartIsSafe: boolean;
}

export interface PreflightDependencies {
  probes: Partial<DockerProbes>;
  readDaemon: (path: string) => { text: string; existed: boolean };
  hasRequiredVars: (config: RunestoneEnv) => boolean;
  /** The host's own resolvers, the second detection source of spec 8.4. */
  hostResolvers: () => string[];
}

export const defaultPreflightDependencies: PreflightDependencies = {
  probes: {},
  readDaemon: readDaemonConfig,
  hasRequiredVars: (config) => envLoader.hasRequiredVars(config),
  hostResolvers: defaultHostResolvers
};

export function verificationImage(config: RunestoneEnv): string {
  return `${config.RUNESTONE_IMAGE}:${config.RUNESTONE_TAG}`;
}

/** The domain used to prove the service answers (spec 10.1 steps 3 and 6). */
export function verificationDomain(config: RunestoneEnv): string {
  return `traefik.${config.HOST_DOMAIN}`;
}

/** Spec 10.1 step 1. Reads only: nothing here changes anything. */
export function preflight(
  config: RunestoneEnv,
  dependencies: Partial<PreflightDependencies> = {}
): Preflight {
  const deps = { ...defaultPreflightDependencies, ...dependencies };
  const target = resolveDaemonConfigTarget();
  const failures: PreflightFailure[] = [];

  if (!deps.hasRequiredVars(config)) {
    failures.push({ kind: 'setup-incomplete' });
  }

  const daemon = readDaemonInfo(deps.probes);
  if (!daemon) {
    failures.push({ kind: 'docker-unavailable', message: 'docker info did not answer' });
  } else if (daemon.osType.toLowerCase() !== 'linux') {
    failures.push({ kind: 'windows-containers', osType: daemon.osType });
  } else if (daemon.isDockerDesktop && osDetector.platform() === 'linux') {
    failures.push({ kind: 'docker-desktop-elsewhere', operatingSystem: daemon.operatingSystem });
  }

  // Read before deciding how to restart: on Docker Desktop the version is what
  // says whether an automatic restart strands the machine's containers.
  const desktopVersion = target.host === 'docker-desktop' ? readDesktopVersion(deps.probes) : undefined;
  const restartIsSafe = target.host === 'docker-desktop' ? desktopRestartIsSafe(desktopVersion) : true;

  const context = readDockerContext(deps.probes);
  if (context?.remote) {
    failures.push({ kind: 'remote-context', name: context.name, endpoint: context.endpoint });
  }

  let targetIp: string | undefined;
  if (failures.length === 0) {
    const resolved = resolveTargetIp(verificationImage(config), deps.probes);
    if (resolved.ip) {
      targetIp = resolved.ip;
    } else {
      failures.push({ kind: 'target-ip', message: resolved.error ?? 'unknown' });
    }
  }

  let daemonText = '{}';
  let daemonExists = false;
  try {
    const read = deps.readDaemon(target.path);
    daemonText = read.text;
    daemonExists = read.existed;
  } catch (thrown) {
    failures.push({
      kind: 'daemon-unreadable',
      message: thrown instanceof Error ? thrown.message : String(thrown)
    });
  }

  // The upstream list cannot fail preflight: spec 8.4 guarantees one exists.
  let daemonEntries: string[] | undefined;
  try {
    daemonEntries = readDnsArray(daemonText).values.filter((value): value is string => typeof value === 'string');
  } catch {
    daemonEntries = undefined;
  }

  const upstreams = determineUpstreams({
    configured: config.DNS_UPSTREAM,
    daemonEntries,
    hostResolvers: deps.hostResolvers(),
    targetIp
  });

  return {
    ok: failures.length === 0,
    failures,
    targetIp,
    bindIp: targetIp ? config.DNS_BIND_IP.trim() || determineBindIp({ host: target.host, targetIp }) : undefined,
    context,
    upstreams,
    daemonPath: target.path,
    daemonExists,
    daemonText,
    requiresPrivilege: target.requiresPrivilege,
    host: target.host,
    upstreamIsFallback: upstreams.origins.every((origin) => origin.origin === 'default'),
    restartPlan: resolveDockerRestartPlan(undefined, { desktopRestartIsSafe: restartIsSafe }),
    desktopVersion,
    desktopRestartIsSafe: restartIsSafe
  };
}

export type EnableMode = 'insert' | 'reconcile' | 'rotate';

export interface EnablePlan {
  preflight: Preflight;
  mode: EnableMode;
  /** What `insertedEntries` becomes once this plan is applied. */
  entries: OwnedEntry[];
  before: string;
  after: string;
  createdDnsKey: boolean;
  createdDaemonFile: boolean;
  /**
   * Values already in the array that equal one of ours. **Not deduplicated**
   * (spec 9.1): they belong to the user or another tool, and they will still be
   * there after disabling.
   */
  duplicates: string[];
  conflicts: Identification[];
  changesFile: boolean;
  atFront: boolean;
  record?: DnsOwnershipState;
  envUpdates: Record<string, string>;
  verifyDomain: string;
}

export function planEnable(
  config: RunestoneEnv,
  dependencies: Partial<PreflightDependencies> & { readRecord?: () => DnsOwnershipState | undefined } = {}
): EnablePlan {
  const checks = preflight(config, dependencies);
  const record = (dependencies.readRecord ?? (() => toolState.readDnsState()))();
  const targetIp = checks.targetIp ?? '';
  const bindIp = checks.bindIp ?? '';

  const desired = ownedEntryInputs({ ...config, DNS_HOST_IP: targetIp });
  const envUpdates: Record<string, string> = {
    DNS_ENABLE: 'true',
    DNS_HOST_IP: targetIp,
    DNS_BIND_IP: bindIp,
    DNS_BIND_PREFIX: bindPrefix(bindIp),
    DNS_UPSTREAM: checks.upstreams.upstreams.join(','),
    DNS_CONTAINER_RESOLVER: checks.upstreams.upstreams[0] ?? '',
    // Written for the same reason 8.4 writes the upstream list: a value that
    // only lives in a flag is a value nobody can read back afterwards. Empty is
    // meaningful here — it is how the 9.7 fallback is turned off.
    DNS_DAEMON_FALLBACK: config.DNS_DAEMON_FALLBACK.trim()
  };

  const base: EnablePlan = {
    preflight: checks,
    mode: 'insert',
    entries: [],
    before: checks.daemonText,
    after: checks.daemonText,
    createdDnsKey: false,
    createdDaemonFile: !checks.daemonExists,
    duplicates: [],
    conflicts: [],
    changesFile: false,
    atFront: true,
    record,
    envUpdates,
    verifyDomain: verificationDomain(config)
  };

  if (!checks.ok || desired.length === 0) {
    return base;
  }

  // Re-entrancy (spec 9.5): with a record in hand this must never insert again.
  if (record) {
    const sameEntries =
      record.insertedEntries.length === desired.length &&
      record.insertedEntries.every((entry, index) => entry.value === desired[index].value);

    if (sameEntries) {
      const reconciled = reconcileOwnedEntries(checks.daemonText, record.insertedEntries, {
        autoReorder: isAutoReorderEnabled(config)
      });

      return {
        ...base,
        mode: 'reconcile',
        entries: reconciled.entries,
        after: reconciled.text,
        changesFile: reconciled.changed,
        conflicts: reconciled.conflicts,
        atFront: reconciled.atFront,
        createdDnsKey: record.createdDnsKey,
        createdDaemonFile: record.createdDaemonFile
      };
    }

    // Target IP rotation (spec 9.4): remove the old entries and insert the new
    // ones as one transaction, so the array is never left holding both.
    const removal = removeOwnedEntries(checks.daemonText, record.insertedEntries, {
      createdDnsKey: record.createdDnsKey
    });

    if (removal.conflicts.length > 0) {
      return { ...base, mode: 'rotate', conflicts: removal.conflicts };
    }

    const inserted = insertOwnedEntries(removal.text, desired);
    return {
      ...base,
      mode: 'rotate',
      entries: inserted.entries,
      after: inserted.text,
      changesFile: inserted.text !== checks.daemonText,
      duplicates: inserted.duplicates,
      createdDnsKey: record.createdDnsKey || inserted.createdDnsKey,
      createdDaemonFile: record.createdDaemonFile
    };
  }

  const inserted = insertOwnedEntries(checks.daemonText, desired);
  return {
    ...base,
    mode: 'insert',
    entries: inserted.entries,
    after: inserted.text,
    changesFile: inserted.text !== checks.daemonText,
    duplicates: inserted.duplicates,
    createdDnsKey: inserted.createdDnsKey,
    createdDaemonFile: !checks.daemonExists,
    atFront: true
  };
}

export interface EnableApplyDependencies {
  writeEnv: (path: string, values: Record<string, string>) => void;
  ensureFiles: (config: RunestoneEnv) => void;
  syncUiRoute: (config: RunestoneEnv) => boolean;
  startService: (composePath: string) => void;
  stopService: (composePath: string) => void;
  verify: (image: string, domain: string, serverIp: string) => ResolutionCheck;
  writeDaemon: (path: string, text: string) => void;
  writeRecord: (state: DnsOwnershipState) => void;
  clearRecord: () => void;
  now: () => string;
}

export const defaultEnableApplyDependencies: EnableApplyDependencies = {
  writeEnv: (path, values) => envLoader.write(path, values),
  ensureFiles: (config) => {
    ensureProjectFiles(config);
  },
  syncUiRoute: (config) => syncDnsUiRoute(config),
  startService: (composePath) =>
    composeService.up(composePath, { profiles: [DNS_PROFILE], services: [COMPOSE_SERVICES.dns] }),
  stopService: (composePath) =>
    composeService.removeServices(composePath, [COMPOSE_SERVICES.dns], { profiles: [DNS_PROFILE] }),
  verify: (image, domain, serverIp) => verifyDomainResolution(image, domain, serverIp),
  writeDaemon: writeDaemonConfig,
  writeRecord: (state) => toolState.writeDnsState(state),
  clearRecord: () => toolState.clearDnsState(),
  now: () => new Date().toISOString()
};

export type EnableStage = 'files' | 'service' | 'verification' | 'daemon' | 'prepared';

export interface EnableResult {
  stage: EnableStage;
  wroteEnv: boolean;
  startedService: boolean;
  verification?: ResolutionCheck;
  wroteDaemon: boolean;
  /** Set when a step failed and the earlier steps were undone. */
  rolledBack: boolean;
  rollbackError?: string;
  failure?: 'service-start' | 'verification' | 'daemon-write';
  failureMessage?: string;
  record?: DnsOwnershipState;
}

/**
 * Spec 10.1 steps 2 to 4, stopping at `phase=prepared`. **The daemon
 * configuration is written last**, so a failure anywhere earlier leaves the
 * machine's global DNS exactly as it was — which is the whole reason the steps
 * are in this order.
 */
export function applyEnable(
  config: RunestoneEnv,
  plan: EnablePlan,
  dependencies: Partial<EnableApplyDependencies> = {}
): EnableResult {
  if (!plan.preflight.ok || plan.conflicts.length > 0) {
    throw new Error('Refusing to apply an enable plan that did not pass preflight');
  }

  const deps = { ...defaultEnableApplyDependencies, ...dependencies };
  const previousEnv: Record<string, string> = {
    DNS_ENABLE: config.DNS_ENABLE,
    DNS_HOST_IP: config.DNS_HOST_IP,
    DNS_BIND_IP: config.DNS_BIND_IP,
    DNS_BIND_PREFIX: config.DNS_BIND_PREFIX,
    DNS_UPSTREAM: config.DNS_UPSTREAM,
    DNS_CONTAINER_RESOLVER: config.DNS_CONTAINER_RESOLVER
  };

  const result: EnableResult = {
    stage: 'files',
    wroteEnv: false,
    startedService: false,
    wroteDaemon: false,
    rolledBack: false
  };

  const enabledConfig: RunestoneEnv = { ...config, ...plan.envUpdates } as RunestoneEnv;

  const undoFiles = (): void => {
    try {
      deps.writeEnv(config.ENV_PATH, previousEnv);
      deps.syncUiRoute(config);
    } catch (thrown) {
      result.rollbackError = thrown instanceof Error ? thrown.message : String(thrown);
    }
    result.rolledBack = true;
  };

  deps.writeEnv(config.ENV_PATH, plan.envUpdates);
  result.wroteEnv = true;
  deps.ensureFiles(enabledConfig);
  deps.syncUiRoute(enabledConfig);

  result.stage = 'service';
  try {
    deps.startService(config.COMPOSE_FILE_PATH);
    result.startedService = true;
  } catch (thrown) {
    result.failure = 'service-start';
    result.failureMessage = thrown instanceof Error ? thrown.message : String(thrown);
    undoFiles();
    return result;
  }

  result.stage = 'verification';
  const verification = deps.verify(verificationImage(config), plan.verifyDomain, plan.preflight.targetIp as string);
  result.verification = verification;
  if (!verification.ok) {
    // Spec 10.1 step 3: stop the service, restore `.env`, and finish **without
    // having touched the daemon configuration at all**.
    result.failure = 'verification';
    result.failureMessage = verification.error;
    try {
      deps.stopService(config.COMPOSE_FILE_PATH);
    } catch (thrown) {
      result.rollbackError = thrown instanceof Error ? thrown.message : String(thrown);
    }
    undoFiles();
    return result;
  }

  result.stage = 'daemon';
  const state: DnsOwnershipState = {
    schemaVersion: 1,
    phase: 'prepared',
    preparedReason: 'no-restart',
    contextName: plan.preflight.context?.name ?? '',
    daemonPath: plan.preflight.daemonPath,
    targetIp: plan.preflight.targetIp as string,
    insertedEntries: plan.entries,
    createdDnsKey: plan.createdDnsKey,
    createdDaemonFile: plan.createdDaemonFile,
    upstreams: plan.preflight.upstreams.upstreams,
    updatedAt: deps.now()
  };

  try {
    // The record goes first: an entry in the file with no record of it is an
    // orphan nobody can revoke, while a record with nothing in the file is
    // merely wrong and `disable` handles it.
    deps.writeRecord(state);
    if (plan.changesFile) {
      deps.writeDaemon(plan.preflight.daemonPath, plan.after);
      result.wroteDaemon = true;
    }
  } catch (thrown) {
    result.failure = 'daemon-write';
    result.failureMessage = thrown instanceof Error ? thrown.message : String(thrown);
    try {
      deps.clearRecord();
      deps.stopService(config.COMPOSE_FILE_PATH);
    } catch (rollbackError) {
      result.rollbackError = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    }
    undoFiles();
    return result;
  }

  result.stage = 'prepared';
  result.record = state;
  return result;
}

export interface CompleteOptions {
  /** Put back containers the restart stopped. Only ever when the user asked. */
  restoreContainers?: boolean;
}

export interface CompleteDependencies {
  restart: (plan: DockerRestartPlan, options: CompleteOptions) => RestartOutcome;
  nameservers: (image: string) => string[];
  verify: (image: string, domain: string, serverIp: string) => ResolutionCheck;
  writeDaemon: (path: string, text: string) => void;
  deleteDaemon: (path: string) => void;
  /** Brings the dns service back after the restart. Idempotent by design. */
  startService: (composePath: string) => void;
  stopService: (composePath: string) => void;
  writeRecord: (state: DnsOwnershipState) => void;
  clearRecord: () => void;
  sleep: (ms: number) => void;
  elapsed: () => number;
  now: () => string;
}

/**
 * How long to keep asking after the restart before calling it a failure.
 *
 * The restart returning is not the finish line: Docker Desktop answers `docker
 * info` well before the containers it stopped are back, and dnsmasq needs a
 * moment more after that.
 */
export const VERIFY_LIMIT_MS = 90_000;
const VERIFY_POLL_MS = 3_000;

function verifyLimitMs(): number {
  const raw = process.env.RUNESTONE_DNS_VERIFY_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : VERIFY_LIMIT_MS;
}

export const defaultCompleteDependencies: CompleteDependencies = {
  restart: (plan, options) => restartDocker(plan, {}, undefined, options),
  nameservers: (image) => readContainerNameservers(image),
  verify: (image, domain, serverIp) => verifyDomainResolution(image, domain, serverIp),
  writeDaemon: writeDaemonConfig,
  deleteDaemon: deleteDaemonConfig,
  startService: defaultEnableApplyDependencies.startService,
  stopService: defaultEnableApplyDependencies.stopService,
  sleep: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
  elapsed: () => Date.now(),
  writeRecord: (state) => toolState.writeDnsState(state),
  clearRecord: () => toolState.clearDnsState(),
  now: () => new Date().toISOString()
};

export interface CompleteResult {
  restart: RestartOutcome;
  /** Nameservers a fresh container was given, in order (spec 10.1 step 6). */
  nameservers?: string[];
  resolution?: ResolutionCheck;
  phase: 'applied' | 'prepared';
  failure?: 'restart' | 'service-gone' | 'resolv-conf' | 'resolution';
  failureMessage?: string;
  /** Whether the daemon change was inverted after a failure. */
  invertedDaemon: boolean;
  /** True when the configuration was already live, so no restart was needed. */
  alreadyInEffect?: boolean;
  /** Set when the inversion itself failed, which needs a human (spec 10.1). */
  rollbackError?: string;
}

/**
 * Spec 10.1 steps 5 to 7: restart Docker, prove it took, and only then call it
 * applied.
 *
 * This is the destructive half. Everything before it can be rehearsed; this
 * terminates every container on the machine, so it runs only after the caller
 * has consent. When it fails, the daemon change is inverted and Docker is
 * restarted again — leaving a half-applied global DNS setting behind is the one
 * outcome worse than not enabling at all.
 */
export function completeEnable(
  config: RunestoneEnv,
  plan: EnablePlan,
  prepared: DnsOwnershipState,
  dependencies: Partial<CompleteDependencies> = {},
  options: CompleteOptions = {}
): CompleteResult {
  const deps = { ...defaultCompleteDependencies, ...dependencies };
  const image = verificationImage(config);
  const targetIp = plan.preflight.targetIp as string;

  // **Do not restart a machine that is already running the configuration.**
  //
  // The write and the restart are deliberately separable, so the restart can
  // arrive from somewhere else entirely: `--no-restart` followed by the user's
  // own restart, an unrelated reboot, or a Docker Desktop update. In all three
  // the daemon is already handing out our address, and restarting again would
  // terminate every container on the machine to achieve nothing at all.
  //
  // Asking is cheap and certain: a throwaway container's `resolv.conf` is the
  // fact itself, not an inference from one.
  const already = deps.nameservers(image);
  if (already[0] === targetIp) {
    const live: CompleteResult = {
      restart: { status: 'restarted', waitedMs: 0 },
      phase: 'prepared',
      invertedDaemon: false,
      nameservers: already,
      alreadyInEffect: true
    };

    const check = deps.verify(image, plan.verifyDomain, targetIp);
    live.resolution = check;
    if (!check.ok) {
      live.failure = 'resolution';
      live.failureMessage = check.error ?? 'the domain did not resolve';
      return live;
    }

    const settled: DnsOwnershipState = { ...prepared, phase: 'applied', updatedAt: deps.now() };
    delete settled.preparedReason;
    deps.writeRecord(settled);
    live.phase = 'applied';
    return live;
  }

  const restart = deps.restart(plan.preflight.restartPlan, options);
  const result: CompleteResult = { restart, phase: 'prepared', invertedDaemon: false };

  const invert = (failure: CompleteResult['failure'], message: string): CompleteResult => {
    result.failure = failure;
    result.failureMessage = message;

    // A run that wrote nothing to the daemon file has nothing to invert, and the
    // entries already sitting in it are not this run's to forget. This is the
    // `--no-restart` shape: one run writes and stops, a later one restarts. If
    // that later restart fails, clearing the record would **orphan** the entries
    // — the daemon would still point at us while `disable` refused to touch the
    // file for want of an ownership record — and stopping the service would take
    // DNS away from every container on the machine while it is still pointed
    // here. So: keep both, and report the failure.
    if (!plan.changesFile) {
      try {
        deps.writeRecord({ ...prepared, phase: 'prepared', preparedReason: 'no-restart', updatedAt: deps.now() });
      } catch (thrown) {
        result.rollbackError = thrown instanceof Error ? thrown.message : String(thrown);
      }

      return result;
    }

    try {
      if (plan.changesFile) {
        if (plan.createdDaemonFile) {
          deps.deleteDaemon(plan.preflight.daemonPath);
        } else {
          deps.writeDaemon(plan.preflight.daemonPath, plan.before);
        }
        result.invertedDaemon = true;
        // The inversion is only real once Docker has read it again.
        deps.restart(plan.preflight.restartPlan, options);
      }

      deps.stopService(config.COMPOSE_FILE_PATH);
      deps.clearRecord();
    } catch (thrown) {
      // Spec 10.1: keep phase=prepared and let the caller print the daemon path
      // and manual recovery steps. Pretending this succeeded would leave the
      // machine pointing at a container that is about to be removed.
      result.rollbackError = thrown instanceof Error ? thrown.message : String(thrown);
      deps.writeRecord({ ...prepared, phase: 'prepared', preparedReason: 'rollback-failed', updatedAt: deps.now() });
    }

    return result;
  };

  // A restart that has to be done by hand is not a failure and must not be
  // inverted: the configuration is written and correct, and the person who runs
  // the restart is the one who can do it without stripping their machine. This
  // is the same resting place `--no-restart` reaches.
  if (restart.status === 'manual-required') {
    return result;
  }

  if (restart.status !== 'restarted') {
    return invert('restart', restart.error ?? restart.status);
  }

  // **The restart returning is not the finish line.** Docker Desktop answers
  // `docker info` long before the containers it stopped are back, and the dns
  // service is one of them — so bring it back explicitly rather than trusting
  // `restart: unless-stopped` to have already done it. M6a demonstrated that
  // policy against a *killed* dockerd, which is a crash; a graceful application
  // restart is a different path, and measured on Docker Desktop it left the dns
  // service down. Verifying at that moment failed a working configuration and
  // inverted it.
  //
  // `up -d dns` is idempotent: it is a no-op when the service is already back.
  try {
    deps.startService(config.COMPOSE_FILE_PATH);
  } catch (thrown) {
    return invert('service-gone', thrown instanceof Error ? thrown.message : String(thrown));
  }

  const deadline = deps.elapsed() + verifyLimitMs();
  let nameservers: string[] = [];
  let resolution: ResolutionCheck = { ok: false, answers: [], error: 'not attempted' };

  while (true) {
    nameservers = deps.nameservers(image);
    result.nameservers = nameservers;

    // An empty list means the daemon is still settling and a throwaway container
    // could not be run yet — worth waiting for. A non-empty list with the wrong
    // address first is a fact about the configuration, and waiting cannot change
    // it, so that fails immediately.
    if (nameservers.length > 0 && nameservers[0] !== targetIp) {
      return invert('resolv-conf', `expected ${targetIp} first, got ${nameservers.join(', ')}`);
    }

    if (nameservers.length > 0) {
      resolution = deps.verify(image, plan.verifyDomain, targetIp);
      result.resolution = resolution;
      if (resolution.ok) {
        break;
      }
    }

    if (deps.elapsed() >= deadline) {
      return nameservers.length === 0
        ? invert('resolv-conf', `expected ${targetIp} first, got (none)`)
        : invert('resolution', resolution.error ?? 'the domain did not resolve');
    }

    deps.sleep(VERIFY_POLL_MS);
  }

  const applied: DnsOwnershipState = { ...prepared, phase: 'applied', updatedAt: deps.now() };
  delete applied.preparedReason;
  deps.writeRecord(applied);
  result.phase = 'applied';

  return result;
}
