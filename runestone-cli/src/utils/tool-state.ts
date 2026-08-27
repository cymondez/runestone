import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ToolState {
  runestonePath?: string;
  locale?: string;
  services?: RunestoneServiceRecord[];
  dns?: DnsOwnershipState;
}

export interface RunestoneServiceRecord {
  group: string | null;
  name: string;
  route: string;
  url: string;
}

export const DNS_STATE_SCHEMA_VERSION = 1;

/**
 * `prepared` means the daemon configuration is written but Docker has not been
 * restarted, so the change has no effect yet. It is **not only a failure
 * intermediate**: `dns enable --no-restart` deliberately stops there.
 */
export type DnsPhase = 'prepared' | 'applied';

/**
 * One item Runestone owns in the daemon `dns` array. `index` is its last known
 * position, used **for identification only, never to restore a position**.
 *
 * Structurally identical to `OwnedEntry` in `services/dns/daemon-config.ts`, and
 * declared here rather than imported so that `utils` keeps not depending on
 * `services`.
 */
export interface DnsOwnedEntryRecord {
  role: 'target' | 'fallback';
  value: string;
  index: number;
}

/** Spec 7.3. Everything outside `insertedEntries` belongs to the user. */
export interface DnsOwnershipState {
  schemaVersion: number;
  phase: DnsPhase;
  contextName: string;
  daemonPath: string;
  targetIp: string;
  insertedEntries: DnsOwnedEntryRecord[];
  createdDnsKey: boolean;
  createdDaemonFile: boolean;
  upstreams: string[];
  updatedAt: string;
}

function isDnsOwnershipState(value: unknown): value is DnsOwnershipState {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DnsOwnershipState>;
  return (
    typeof candidate.schemaVersion === 'number' &&
    Array.isArray(candidate.insertedEntries) &&
    typeof candidate.daemonPath === 'string'
  );
}

function packageRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function stateFilePath(): string {
  return process.env.RUNESTONE_TOOL_STATE_PATH || path.join(os.homedir(), '.runestone', 'runestone.config.json');
}

function readState(): ToolState {
  const statePath = stateFilePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as ToolState;
  } catch {
    return {};
  }
}

function writeState(nextState: ToolState): void {
  const statePath = stateFilePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    `${JSON.stringify(nextState, null, 2)}\n`,
    'utf8'
  );
}

export const toolState = {
  packageRoot,
  stateFilePath,

  readRunestonePath(): string | undefined {
    const runestonePath = readState().runestonePath;
    return runestonePath ? path.resolve(runestonePath) : undefined;
  },

  readLocale(): string | undefined {
    return readState().locale;
  },

  writeRunestonePath(runestonePath: string): void {
    writeState({ ...readState(), runestonePath: path.resolve(runestonePath) });
  },

  writeLocale(locale: string): void {
    writeState({ ...readState(), locale });
  },

  writeSetupState(state: { runestonePath: string; locale: string }): void {
    writeState({
      ...readState(),
      runestonePath: path.resolve(state.runestonePath),
      locale: state.locale
    });
  },

  readServices(): RunestoneServiceRecord[] {
    return (readState().services ?? []).map((service) => ({
      ...service,
      group: service.group && service.group !== 'none' ? service.group : null
    }));
  },

  writeServices(services: RunestoneServiceRecord[]): void {
    writeState({ ...readState(), services });
  },

  /**
   * Returns the record even when its `schemaVersion` is one this build does not
   * know. Discarding it would orphan the entries it describes, and spec 9.3 is
   * explicit that Runestone must never guess which entry to remove — so the
   * caller aborts and tells the user, rather than losing the ownership record.
   */
  readDnsState(): DnsOwnershipState | undefined {
    const dns = readState().dns;
    return isDnsOwnershipState(dns) ? dns : undefined;
  },

  writeDnsState(state: DnsOwnershipState): void {
    writeState({ ...readState(), dns: state });
  },

  clearDnsState(): void {
    const { dns, ...rest } = readState();
    void dns;
    writeState(rest);
  }
};
