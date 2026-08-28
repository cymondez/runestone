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
  DockerProbes,
  ResolutionCheck,
  defaultDockerProbes,
  readContainerNameservers,
  readDaemonInfo,
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
    restartPlan: resolveDockerRestartPlan()
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
    DNS_CONTAINER_RESOLVER: checks.upstreams.upstreams[0] ?? ''
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

export interface CompleteDependencies {
  restart: (plan: DockerRestartPlan) => RestartOutcome;
  nameservers: (image: string) => string[];
  verify: (image: string, domain: string, serverIp: string) => ResolutionCheck;
  writeDaemon: (path: string, text: string) => void;
  deleteDaemon: (path: string) => void;
  stopService: (composePath: string) => void;
  writeRecord: (state: DnsOwnershipState) => void;
  clearRecord: () => void;
  now: () => string;
}

export const defaultCompleteDependencies: CompleteDependencies = {
  restart: (plan) => restartDocker(plan),
  nameservers: (image) => readContainerNameservers(image),
  verify: (image, domain, serverIp) => verifyDomainResolution(image, domain, serverIp),
  writeDaemon: writeDaemonConfig,
  deleteDaemon: deleteDaemonConfig,
  stopService: defaultEnableApplyDependencies.stopService,
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
  failure?: 'restart' | 'resolv-conf' | 'resolution';
  failureMessage?: string;
  /** Whether the daemon change was inverted after a failure. */
  invertedDaemon: boolean;
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
  dependencies: Partial<CompleteDependencies> = {}
): CompleteResult {
  const deps = { ...defaultCompleteDependencies, ...dependencies };
  const image = verificationImage(config);
  const targetIp = plan.preflight.targetIp as string;

  const restart = deps.restart(plan.preflight.restartPlan);
  const result: CompleteResult = { restart, phase: 'prepared', invertedDaemon: false };

  const invert = (failure: CompleteResult['failure'], message: string): CompleteResult => {
    result.failure = failure;
    result.failureMessage = message;

    try {
      if (plan.changesFile) {
        if (plan.createdDaemonFile) {
          deps.deleteDaemon(plan.preflight.daemonPath);
        } else {
          deps.writeDaemon(plan.preflight.daemonPath, plan.before);
        }
        result.invertedDaemon = true;
        // The inversion is only real once Docker has read it again.
        deps.restart(plan.preflight.restartPlan);
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

  if (restart.status !== 'restarted') {
    return invert('restart', restart.error ?? restart.status);
  }

  const nameservers = deps.nameservers(image);
  result.nameservers = nameservers;
  if (nameservers[0] !== targetIp) {
    return invert(
      'resolv-conf',
      `expected ${targetIp} first, got ${nameservers.join(', ') || '(none)'}`
    );
  }

  const resolution = deps.verify(image, plan.verifyDomain, targetIp);
  result.resolution = resolution;
  if (!resolution.ok) {
    return invert('resolution', resolution.error ?? 'the domain did not resolve');
  }

  const applied: DnsOwnershipState = { ...prepared, phase: 'applied', updatedAt: deps.now() };
  delete applied.preparedReason;
  deps.writeRecord(applied);
  result.phase = 'applied';

  return result;
}
