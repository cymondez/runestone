import { RunestoneEnv } from '../../utils/env-loader';
import { DnsOwnershipState, DnsPreparedReason, toolState } from '../../utils/tool-state';
import { DockerContainer, composeService } from '../docker-compose';
import {
  Identification,
  OwnedEntry,
  identifyOwnedEntries,
  ownedEntriesAtFront,
  readDnsArray
} from './daemon-config';
import { readDaemonConfig } from './daemon-file';
import {
  ActiveOverride,
  DaemonHost,
  DockerRestartPlan,
  ResolutionSource,
  activeOverrides,
  resolveDaemonConfigTarget,
  resolveDockerRestartPlan,
  sameDaemonPath
} from './daemon-target';
import {
  daemonFallbackValue,
  isAutoReorderEnabled,
  isDnsEnabled,
  isDnsUiAuthConfigured,
  isDnsUiEnabled
} from './settings';
import { UpstreamResolution, determineUpstreams } from './upstream';
import { dnsUiUrl } from './ui-route';

/**
 * The report behind `runestone dns status` (spec 10.3).
 *
 * It is built as data and printed elsewhere, for two reasons: it can be asserted
 * against hand-crafted daemon files without going near a terminal, and **it
 * cannot write anything** — every dependency it has is a read.
 */

export interface DnsServiceState {
  name: string;
  state: string;
  status: string;
}

export interface DnsStatusReport {
  enabled: boolean;
  targetIp: string;
  bindIp: string;
  autoReorder: boolean;
  upstreams: UpstreamResolution;
  fallback?: string;
  ui: {
    enabled: boolean;
    url: string;
    authConfigured: boolean;
  };
  daemon: {
    path: string;
    source: ResolutionSource;
    host: DaemonHost;
    requiresPrivilege: boolean;
    exists: boolean;
    /** Set when the file exists but could not be parsed. */
    error?: string;
    /** The `dns` array as it stands, when it could be read. */
    entries?: string[];
  };
  restart: DockerRestartPlan;
  overrides: ActiveOverride[];
  record?: DnsOwnershipState;
  /** Set when a record exists and the daemon file could be read. */
  identifications?: Identification[];
  atFront?: boolean;
  /**
   * Entries equal to the Target IP that Runestone does not own. They stay behind
   * after disabling and stop resolving once the dns service is gone (spec 9.5).
   */
  unownedTargetDuplicates: number;
  /** True when the record was written against a different daemon path (spec 9.3). */
  recordPathMismatch: boolean;
  service?: DnsServiceState;
  serviceError?: string;
}

export interface DnsStatusDependencies {
  readDaemon: (path: string) => { text: string; exists: boolean };
  readRecord: () => DnsOwnershipState | undefined;
  listContainers: (composePath: string) => DockerContainer[];
}

export const defaultDnsStatusDependencies: DnsStatusDependencies = {
  readDaemon: (path) => {
    const result = readDaemonConfig(path);
    return { text: result.text, exists: result.existed };
  },
  readRecord: () => toolState.readDnsState(),
  listContainers: (composePath) => composeService.ps(composePath)
};

export function preparedReasonOf(record: DnsOwnershipState | undefined): DnsPreparedReason | 'unknown' | undefined {
  if (!record || record.phase !== 'prepared') {
    return undefined;
  }

  return record.preparedReason ?? 'unknown';
}

export function buildDnsStatusReport(
  config: RunestoneEnv,
  dependencies: Partial<DnsStatusDependencies> = {}
): DnsStatusReport {
  const deps = { ...defaultDnsStatusDependencies, ...dependencies };

  const target = resolveDaemonConfigTarget();
  const restart = resolveDockerRestartPlan();
  const record = deps.readRecord();

  let exists = false;
  let error: string | undefined;
  let entries: string[] | undefined;
  let daemonText: string | undefined;

  try {
    const read = deps.readDaemon(target.path);
    exists = read.exists;
    daemonText = read.text;
    entries = readDnsArray(read.text).values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value)));
  } catch (thrown) {
    exists = true;
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const recorded: OwnedEntry[] = record?.insertedEntries ?? [];
  const identifications =
    record && daemonText !== undefined ? identifyOwnedEntries(daemonText, recorded) : undefined;

  const targetIp = config.DNS_HOST_IP.trim();
  const ownedTargetMatches =
    identifications?.filter(
      (identification) => identification.value === targetIp && identification.status === 'matched'
    ).length ?? 0;
  const totalTargetOccurrences = targetIp === '' ? 0 : (entries ?? []).filter((value) => value === targetIp).length;

  let service: DnsServiceState | undefined;
  let serviceError: string | undefined;
  try {
    const container = deps
      .listContainers(config.COMPOSE_FILE_PATH)
      .find((candidate) => candidate.Service === 'dns');
    if (container) {
      service = { name: container.Name, state: container.State, status: container.Status };
    }
  } catch (thrown) {
    serviceError = thrown instanceof Error ? thrown.message : String(thrown);
  }

  return {
    enabled: isDnsEnabled(config),
    targetIp,
    bindIp: config.DNS_BIND_IP.trim(),
    autoReorder: isAutoReorderEnabled(config),
    upstreams: determineUpstreams({
      configured: config.DNS_UPSTREAM,
      daemonEntries: entries,
      targetIp: targetIp === '' ? undefined : targetIp
    }),
    fallback: daemonFallbackValue(config),
    ui: {
      enabled: isDnsUiEnabled(config),
      url: dnsUiUrl(config),
      authConfigured: isDnsUiAuthConfigured(config)
    },
    daemon: {
      path: target.path,
      source: target.source,
      host: target.host,
      requiresPrivilege: target.requiresPrivilege,
      exists,
      error,
      entries
    },
    restart,
    overrides: activeOverrides(),
    record,
    identifications,
    atFront: identifications ? ownedEntriesAtFront(identifications) : undefined,
    unownedTargetDuplicates: Math.max(0, totalTargetOccurrences - ownedTargetMatches),
    recordPathMismatch: Boolean(record && !sameDaemonPath(record.daemonPath, target.path)),
    service,
    serviceError
  };
}
