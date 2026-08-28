import { RunestoneEnv, envLoader } from '../../utils/env-loader';
import { DnsOwnershipState, toolState } from '../../utils/tool-state';
import { COMPOSE_SERVICES, DNS_PROFILE, composeService } from '../docker-compose';
import { Identification, OwnedEntry, readDnsArray, removeOwnedEntries } from './daemon-config';
import { deleteDaemonConfig, readDaemonConfig, writeDaemonConfig } from './daemon-file';
import {
  DockerRestartPlan,
  resolveDaemonConfigTarget,
  resolveDockerRestartPlan,
  sameDaemonPath
} from './daemon-target';
import { RestartOutcome, restartDocker } from './docker-restart';
import { isDnsEnabled } from './settings';
import { syncDnsUiRoute } from './ui-route';

/**
 * `runestone dns disable` (spec 9.2 and 10.2) — the inverse operation.
 *
 * It is split into a plan and an application so that `--dry-run` is not a second
 * implementation of the same logic that could drift from it: the dry run prints
 * the plan, and a real run applies that same plan. What you were shown is what
 * happens.
 *
 * The rule the whole thing serves: **remove only what Runestone recorded as its
 * own, and when that cannot be established, remove nothing and say so.** Guessing
 * would mean deleting a resolver the user depends on.
 */

export interface DisableOptions {
  /** `--assume-entry <ip>`, repeatable: the user states which value is ours. */
  assumeEntries?: string[];
  /** `--assume-index <n>`, repeatable: the user states which position is ours. */
  assumeIndexes?: number[];
}

export type DisableBlocker =
  | { kind: 'no-ownership' }
  | { kind: 'daemon-path-mismatch'; recorded: string; actual: string }
  | { kind: 'daemon-unreadable'; message: string }
  | { kind: 'ownership-conflict'; identifications: Identification[] };

export interface DisablePlan {
  daemonPath: string;
  daemonExists: boolean;
  before: string;
  after: string;
  /** The entries this run would try to remove. */
  targets: OwnedEntry[];
  identifications: Identification[];
  removed: OwnedEntry[];
  /** Entries the user had already removed themselves (spec 9.5). */
  alreadyRevoked: OwnedEntry[];
  dnsKeyRemoved: boolean;
  deleteDaemonFile: boolean;
  changesFile: boolean;
  record?: DnsOwnershipState;
  source: 'record' | 'assumption' | 'none';
  blockers: DisableBlocker[];
  restartPlan: DockerRestartPlan;
}

export interface PlanDependencies {
  readDaemon: (path: string) => { text: string; existed: boolean };
  readRecord: () => DnsOwnershipState | undefined;
}

export const defaultPlanDependencies: PlanDependencies = {
  readDaemon: readDaemonConfig,
  readRecord: () => toolState.readDnsState()
};

/**
 * What the user asserted wins over what was recorded. `--assume-entry` with no
 * index is given `-1`, which no position can match, so identification falls to
 * the "exactly one item matches this value" rule rather than to a position that
 * was never stated.
 */
export function resolveDisableTargets(
  record: DnsOwnershipState | undefined,
  options: DisableOptions
): { targets: OwnedEntry[]; source: DisablePlan['source'] } {
  const assumeEntries = options.assumeEntries ?? [];
  const assumeIndexes = options.assumeIndexes ?? [];

  if (assumeEntries.length > 0) {
    return {
      source: 'assumption',
      targets: assumeEntries.map((value, position) => ({
        role: record?.insertedEntries[position]?.role ?? (position === 0 ? 'target' : 'fallback'),
        value,
        index: assumeIndexes[position] ?? -1
      }))
    };
  }

  if (!record || record.insertedEntries.length === 0) {
    return { targets: [], source: 'none' };
  }

  if (assumeIndexes.length > 0) {
    return {
      source: 'assumption',
      targets: record.insertedEntries.map((entry, position) => ({
        ...entry,
        index: assumeIndexes[position] ?? entry.index
      }))
    };
  }

  return { targets: record.insertedEntries, source: 'record' };
}

export function planDisable(
  config: RunestoneEnv,
  options: DisableOptions = {},
  dependencies: Partial<PlanDependencies> = {}
): DisablePlan {
  const deps = { ...defaultPlanDependencies, ...dependencies };
  const target = resolveDaemonConfigTarget();
  const restartPlan = resolveDockerRestartPlan();
  const record = deps.readRecord();
  const { targets, source } = resolveDisableTargets(record, options);
  const blockers: DisableBlocker[] = [];

  let before = '{}';
  let daemonExists = false;
  try {
    const read = deps.readDaemon(target.path);
    before = read.text;
    daemonExists = read.existed;
  } catch (thrown) {
    blockers.push({
      kind: 'daemon-unreadable',
      message: thrown instanceof Error ? thrown.message : String(thrown)
    });
  }

  const empty: DisablePlan = {
    daemonPath: target.path,
    daemonExists,
    before,
    after: before,
    targets,
    identifications: [],
    removed: [],
    alreadyRevoked: [],
    dnsKeyRemoved: false,
    deleteDaemonFile: false,
    changesFile: false,
    record,
    source,
    blockers,
    restartPlan
  };

  if (targets.length === 0) {
    blockers.push({ kind: 'no-ownership' });
    return empty;
  }

  // An explicit assumption is the user overriding Runestone's own bookkeeping,
  // so it also overrides the recorded-path check that exists to protect that
  // bookkeeping.
  if (record && source !== 'assumption' && !sameDaemonPath(record.daemonPath, target.path)) {
    blockers.push({ kind: 'daemon-path-mismatch', recorded: record.daemonPath, actual: target.path });
    return empty;
  }

  if (blockers.length > 0) {
    return empty;
  }

  const result = removeOwnedEntries(before, targets, { createdDnsKey: record?.createdDnsKey === true });

  if (result.conflicts.length > 0) {
    blockers.push({ kind: 'ownership-conflict', identifications: result.identifications });
    return { ...empty, identifications: result.identifications };
  }

  return {
    ...empty,
    after: result.text,
    identifications: result.identifications,
    removed: result.removed,
    alreadyRevoked: result.alreadyRevoked,
    dnsKeyRemoved: result.dnsKeyRemoved,
    deleteDaemonFile: record?.createdDaemonFile === true && result.objectEmpty && daemonExists,
    changesFile: result.text !== before
  };
}

export interface ApplyDependencies {
  writeDaemon: (path: string, text: string) => void;
  deleteDaemon: (path: string) => void;
  readDaemon: (path: string) => { text: string; existed: boolean };
  restart: (plan: DockerRestartPlan) => RestartOutcome;
  clearRecord: () => void;
  writeEnv: (path: string, values: Record<string, string>) => void;
  removeService: (composePath: string) => void;
  removeUiRoute: (config: RunestoneEnv) => boolean;
}

export const defaultApplyDependencies: ApplyDependencies = {
  writeDaemon: writeDaemonConfig,
  deleteDaemon: deleteDaemonConfig,
  readDaemon: readDaemonConfig,
  restart: (plan) => restartDocker(plan),
  clearRecord: () => toolState.clearDnsState(),
  writeEnv: (path, values) => envLoader.write(path, values),
  removeService: (composePath) =>
    composeService.removeServices(composePath, [COMPOSE_SERVICES.dns], { profiles: [DNS_PROFILE] }),
  removeUiRoute: (config) => syncDnsUiRoute({ ...config, DNS_ENABLE: 'false' })
};

export interface DisableResult {
  wroteDaemon: boolean;
  deletedDaemonFile: boolean;
  restart?: RestartOutcome;
  /** Whether the removed values are provably gone from the file afterwards. */
  verified: boolean;
  removedService: boolean;
  serviceError?: string;
  removedUiRoute: boolean;
  disabledInEnv: boolean;
  clearedRecord: boolean;
}

/**
 * Applies a plan that has no blockers. The caller is responsible for having
 * obtained consent: step 3 of spec 10.2 restarts Docker, which terminates every
 * container on the machine.
 */
export function applyDisable(
  config: RunestoneEnv,
  plan: DisablePlan,
  dependencies: Partial<ApplyDependencies> = {}
): DisableResult {
  if (plan.blockers.length > 0) {
    throw new Error('Refusing to apply a disable plan that has blockers');
  }

  const deps = { ...defaultApplyDependencies, ...dependencies };
  const result: DisableResult = {
    wroteDaemon: false,
    deletedDaemonFile: false,
    verified: true,
    removedService: false,
    removedUiRoute: false,
    disabledInEnv: false,
    clearedRecord: false
  };

  if (plan.changesFile) {
    deps.writeDaemon(plan.daemonPath, plan.after);
    result.wroteDaemon = true;

    if (plan.deleteDaemonFile) {
      deps.deleteDaemon(plan.daemonPath);
      result.deletedDaemonFile = true;
    }

    // Only a real change is worth a restart. When the user had already removed
    // our entry by hand there is nothing to apply, and restarting would
    // terminate every container on the machine for no reason at all.
    result.restart = deps.restart(plan.restartPlan);

    if (!result.deletedDaemonFile) {
      const after = deps.readDaemon(plan.daemonPath);
      const values = readDnsArray(after.text).values;
      result.verified = plan.removed.every((entry) => !values.includes(entry.value));
    }
  }

  // The dns service goes only after the daemon revocation has succeeded
  // (spec 10.2): removing it first would leave the machine pointing at a
  // container that no longer exists.
  try {
    deps.removeService(config.COMPOSE_FILE_PATH);
    result.removedService = true;
  } catch (thrown) {
    result.serviceError = thrown instanceof Error ? thrown.message : String(thrown);
  }

  result.removedUiRoute = deps.removeUiRoute(config);

  if (isDnsEnabled(config)) {
    deps.writeEnv(config.ENV_PATH, { DNS_ENABLE: 'false' });
    result.disabledInEnv = true;
  }

  deps.clearRecord();
  result.clearedRecord = true;

  return result;
}

/**
 * A line-per-entry diff of the `dns` array, for `--dry-run` and confirmations.
 *
 * It marks positions, not values. Comparing values would be wrong exactly where
 * it matters most: when the user has duplicated our address, only one of the two
 * identical lines is ours, and the diff has to show which.
 */
export function describeDiff(plan: DisablePlan): string[] {
  let before: string[];
  try {
    before = readDnsArray(plan.before).values.map(String);
  } catch {
    return [];
  }

  const removedPositions = new Set(
    plan.identifications
      .filter((identification) => identification.status === 'matched')
      .map((identification) => identification.index)
  );

  return before.map((value, position) => (removedPositions.has(position) ? `- ${value}` : `  ${value}`));
}
