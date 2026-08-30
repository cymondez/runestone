import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OwnedEntry } from '../../../src/services/dns/daemon-config';
import {
  DNS_STATE_SCHEMA_VERSION,
  DnsOwnedEntryRecord,
  DnsOwnershipState,
  toolState
} from '../../../src/utils/tool-state';

function state(overrides: Partial<DnsOwnershipState> = {}): DnsOwnershipState {
  return {
    schemaVersion: DNS_STATE_SCHEMA_VERSION,
    phase: 'applied',
    contextName: 'desktop-linux',
    daemonPath: path.join('C:', 'Users', 'me', '.docker', 'daemon.json'),
    targetIp: '192.168.65.254',
    insertedEntries: [{ role: 'target', value: '192.168.65.254', index: 0 }],
    createdDnsKey: true,
    createdDaemonFile: false,
    upstreams: ['192.168.1.1'],
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...overrides
  };
}

describe('dns ownership state (spec 7.3)', () => {
  let directory: string;
  const originalStatePath = process.env.RUNESTONE_TOOL_STATE_PATH;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-state-'));
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(directory, 'runestone.config.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    if (originalStatePath === undefined) {
      delete process.env.RUNESTONE_TOOL_STATE_PATH;
    } else {
      process.env.RUNESTONE_TOOL_STATE_PATH = originalStatePath;
    }
  });

  it('reports no state before anything is written', () => {
    expect(toolState.readDnsState()).toBeUndefined();
  });

  it('round-trips the whole record', () => {
    const written = state({
      phase: 'prepared',
      insertedEntries: [
        { role: 'target', value: '192.168.65.254', index: 0 },
        { role: 'fallback', value: '1.1.1.1', index: 1 }
      ]
    });

    toolState.writeDnsState(written);

    expect(toolState.readDnsState()).toEqual(written);
  });

  it('leaves the rest of the tool state alone', () => {
    toolState.writeSetupState({ runestonePath: directory, locale: 'zh-TW' });
    toolState.writeServices([{ group: null, name: 'api', route: 'api.test', url: 'http://127.0.0.1:3000' }]);

    toolState.writeDnsState(state());

    expect(toolState.readLocale()).toBe('zh-TW');
    expect(toolState.readServices()).toHaveLength(1);

    toolState.clearDnsState();

    expect(toolState.readDnsState()).toBeUndefined();
    expect(toolState.readLocale()).toBe('zh-TW');
    expect(toolState.readServices()).toHaveLength(1);
    expect(toolState.readRunestonePath()).toBe(path.resolve(directory));
  });

  it('clearing when there is nothing to clear is not an error', () => {
    expect(() => toolState.clearDnsState()).not.toThrow();
    expect(toolState.readDnsState()).toBeUndefined();
  });

  it('still returns a record written by a newer schema, rather than orphaning its entries', () => {
    const future = state({ schemaVersion: DNS_STATE_SCHEMA_VERSION + 1 });

    toolState.writeDnsState(future);

    expect(toolState.readDnsState()).toEqual(future);
  });

  it('ignores a malformed block', () => {
    fs.writeFileSync(
      process.env.RUNESTONE_TOOL_STATE_PATH as string,
      JSON.stringify({ dns: { phase: 'applied' } }),
      'utf8'
    );

    expect(toolState.readDnsState()).toBeUndefined();
  });

  it('records what the engine produced without translation', () => {
    // The engine's OwnedEntry and the stored record are the same shape on
    // purpose, so nothing is lost or reinterpreted on the way to disk.
    const fromEngine: OwnedEntry[] = [
      { role: 'target', value: '192.168.65.254', index: 0 },
      { role: 'fallback', value: '1.1.1.1', index: 1 }
    ];
    const stored: DnsOwnedEntryRecord[] = fromEngine;

    toolState.writeDnsState(state({ insertedEntries: stored }));

    const read = toolState.readDnsState() as DnsOwnershipState;
    const backToEngine: OwnedEntry[] = read.insertedEntries;
    expect(backToEngine).toEqual(fromEngine);
  });
});
