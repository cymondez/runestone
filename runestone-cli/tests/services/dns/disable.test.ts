import * as path from 'path';
import {
  DisablePlan,
  applyDisable,
  describeDiff,
  planDisable,
  resolveDisableTargets
} from '../../../src/services/dns/disable';
import { DAEMON_PATH_OVERRIDE_ENV } from '../../../src/services/dns/daemon-target';
import { DNS_STATE_SCHEMA_VERSION, DnsOwnershipState } from '../../../src/utils/tool-state';
import { RunestoneEnv } from '../../../src/utils/env-loader';
import { testEnv } from '../../helpers/env';

const TARGET = '192.168.65.254';
const FALLBACK = '1.1.1.1';
// The override is resolved to an absolute path, which on Windows means a drive
// letter gets prepended. Resolving here too keeps the record and the assertions
// talking about the same file.
const DAEMON_PATH = path.resolve('/tmp/runestone-test/daemon.json');
const OTHER_DAEMON_PATH = path.resolve('/etc/docker/daemon.json');

function daemonText(dns?: string[], extra: Record<string, unknown> = { experimental: false }): string {
  return `${JSON.stringify(dns === undefined ? extra : { dns, ...extra }, null, 2)}\n`;
}

function record(overrides: Partial<DnsOwnershipState> = {}): DnsOwnershipState {
  return {
    schemaVersion: DNS_STATE_SCHEMA_VERSION,
    phase: 'applied',
    contextName: 'desktop-linux',
    daemonPath: DAEMON_PATH,
    targetIp: TARGET,
    insertedEntries: [{ role: 'target', value: TARGET, index: 0 }],
    createdDnsKey: false,
    createdDaemonFile: false,
    upstreams: ['8.8.8.8'],
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...overrides
  };
}

function config(overrides: Partial<RunestoneEnv> = {}): RunestoneEnv {
  return testEnv('/tmp/runestone-test', { DNS_ENABLE: 'true', DNS_HOST_IP: TARGET, ...overrides });
}

function plan(options: {
  text?: string;
  existed?: boolean;
  state?: DnsOwnershipState;
  assumeEntries?: string[];
  assumeIndexes?: number[];
  env?: Partial<RunestoneEnv>;
  readThrows?: string;
}): DisablePlan {
  return planDisable(
    config(options.env),
    { assumeEntries: options.assumeEntries, assumeIndexes: options.assumeIndexes },
    {
      readDaemon: () => {
        if (options.readThrows) {
          throw new Error(options.readThrows);
        }
        return { text: options.text ?? daemonText([TARGET, '8.8.8.8']), existed: options.existed ?? true };
      },
      readRecord: () => options.state
    }
  );
}

describe('dns disable', () => {
  const previousOverride = process.env[DAEMON_PATH_OVERRIDE_ENV];

  beforeEach(() => {
    process.env[DAEMON_PATH_OVERRIDE_ENV] = DAEMON_PATH;
  });

  afterAll(() => {
    if (previousOverride === undefined) {
      delete process.env[DAEMON_PATH_OVERRIDE_ENV];
    } else {
      process.env[DAEMON_PATH_OVERRIDE_ENV] = previousOverride;
    }
  });

  describe('resolveDisableTargets', () => {
    it('uses the record when the user asserts nothing', () => {
      expect(resolveDisableTargets(record(), {})).toEqual({
        source: 'record',
        targets: [{ role: 'target', value: TARGET, index: 0 }]
      });
    });

    it('has nothing to remove when there is no record', () => {
      expect(resolveDisableTargets(undefined, {})).toEqual({ source: 'none', targets: [] });
    });

    it('gives an assumed entry an index no position can match, so the value decides', () => {
      expect(resolveDisableTargets(undefined, { assumeEntries: ['10.0.0.9'] })).toEqual({
        source: 'assumption',
        targets: [{ role: 'target', value: '10.0.0.9', index: -1 }]
      });
    });

    it('pairs assumed entries and indexes positionally', () => {
      expect(
        resolveDisableTargets(undefined, { assumeEntries: ['10.0.0.9', '10.0.0.8'], assumeIndexes: [2, 5] })
      ).toEqual({
        source: 'assumption',
        targets: [
          { role: 'target', value: '10.0.0.9', index: 2 },
          { role: 'fallback', value: '10.0.0.8', index: 5 }
        ]
      });
    });

    it('lets an assumed index override the recorded position', () => {
      expect(resolveDisableTargets(record(), { assumeIndexes: [3] })).toEqual({
        source: 'assumption',
        targets: [{ role: 'target', value: TARGET, index: 3 }]
      });
    });
  });

  describe('planning', () => {
    it('removes our entry and keeps everything else', () => {
      const result = plan({ state: record() });

      expect(result.blockers).toEqual([]);
      expect(result.removed).toEqual([{ role: 'target', value: TARGET, index: 0 }]);
      expect(result.changesFile).toBe(true);
      expect(JSON.parse(result.after).dns).toEqual(['8.8.8.8']);
      expect(JSON.parse(result.after).experimental).toBe(false);
    });

    it('refuses to guess when there is no record at all', () => {
      const result = plan({});

      expect(result.blockers).toEqual([{ kind: 'no-ownership' }]);
      expect(result.after).toBe(result.before);
    });

    it('revokes a hand-planted entry when the user names it', () => {
      // The escape hatch: an entry someone put there by hand, with no record.
      const result = plan({ text: daemonText(['10.0.0.9', '8.8.8.8']), assumeEntries: ['10.0.0.9'] });

      expect(result.blockers).toEqual([]);
      expect(result.source).toBe('assumption');
      expect(JSON.parse(result.after).dns).toEqual(['8.8.8.8']);
    });

    it('treats an entry the user already removed as revoked, changing nothing', () => {
      const result = plan({ text: daemonText(['8.8.8.8']), state: record() });

      expect(result.blockers).toEqual([]);
      expect(result.alreadyRevoked).toEqual([{ role: 'target', value: TARGET, index: 0 }]);
      expect(result.changesFile).toBe(false);
      expect(result.after).toBe(result.before);
    });

    it('aborts on an ownership conflict rather than picking one', () => {
      const result = plan({ text: daemonText(['10.0.0.1', TARGET, TARGET]), state: record() });

      expect(result.blockers[0].kind).toBe('ownership-conflict');
      expect(result.after).toBe(result.before);
      expect(result.removed).toEqual([]);
    });

    it('resolves that conflict when the user names the position', () => {
      const result = plan({
        text: daemonText(['10.0.0.1', TARGET, TARGET]),
        state: record(),
        assumeIndexes: [2]
      });

      expect(result.blockers).toEqual([]);
      expect(JSON.parse(result.after).dns).toEqual(['10.0.0.1', TARGET]);
    });

    it('aborts when the record was written against another file', () => {
      const result = plan({ state: record({ daemonPath: OTHER_DAEMON_PATH }) });

      expect(result.blockers).toEqual([
        { kind: 'daemon-path-mismatch', recorded: OTHER_DAEMON_PATH, actual: DAEMON_PATH }
      ]);
    });

    it('lets an explicit assumption override the recorded path', () => {
      const result = plan({ state: record({ daemonPath: OTHER_DAEMON_PATH }), assumeEntries: [TARGET] });

      expect(result.blockers).toEqual([]);
    });

    it('aborts without writing when the file cannot be read', () => {
      const result = plan({ state: record(), readThrows: 'Daemon configuration is not valid JSON: bad' });

      expect(result.blockers[0]).toMatchObject({ kind: 'daemon-unreadable' });
      expect(result.changesFile).toBe(false);
    });

    it('removes a dns key it created once it is empty', () => {
      const result = plan({
        text: daemonText([TARGET]),
        state: record({ createdDnsKey: true })
      });

      expect(result.dnsKeyRemoved).toBe(true);
      expect(JSON.parse(result.after).dns).toBeUndefined();
      expect(result.deleteDaemonFile).toBe(false);
    });

    it('removes a file it created once nothing is left in it', () => {
      const result = plan({
        text: `${JSON.stringify({ dns: [TARGET] }, null, 2)}\n`,
        state: record({ createdDnsKey: true, createdDaemonFile: true })
      });

      expect(result.deleteDaemonFile).toBe(true);
    });

    it('keeps a file it created once the user added their own settings', () => {
      const result = plan({
        text: daemonText([TARGET], { experimental: true }),
        state: record({ createdDnsKey: true, createdDaemonFile: true })
      });

      expect(result.deleteDaemonFile).toBe(false);
    });

    it('removes both owned entries together', () => {
      const state = record({
        insertedEntries: [
          { role: 'target', value: TARGET, index: 0 },
          { role: 'fallback', value: FALLBACK, index: 1 }
        ]
      });

      const result = plan({ text: daemonText([TARGET, FALLBACK, '8.8.8.8']), state });

      expect(result.removed).toHaveLength(2);
      expect(JSON.parse(result.after).dns).toEqual(['8.8.8.8']);
    });
  });

  describe('describeDiff', () => {
    it('marks only the removed lines', () => {
      expect(describeDiff(plan({ state: record() }))).toEqual([`- ${TARGET}`, '  8.8.8.8']);
    });

    it('consumes matches, so a duplicate the user added is shown as kept', () => {
      const result = plan({ text: daemonText([TARGET, '8.8.8.8', TARGET]), state: record() });

      expect(describeDiff(result)).toEqual([`- ${TARGET}`, '  8.8.8.8', `  ${TARGET}`]);
    });

    it('shows nothing removed when there is nothing to remove', () => {
      expect(describeDiff(plan({ text: daemonText(['8.8.8.8']), state: record() }))).toEqual(['  8.8.8.8']);
    });
  });

  describe('applying', () => {
    function spies() {
      return {
        writeDaemon: jest.fn(),
        deleteDaemon: jest.fn(),
        readDaemon: jest.fn(() => ({ text: daemonText(['8.8.8.8']), existed: true })),
        restart: jest.fn(() => ({ status: 'restarted' as const, waitedMs: 4000 })),
        clearRecord: jest.fn(),
        writeEnv: jest.fn(),
        removeService: jest.fn(),
        removeUiRoute: jest.fn(() => true)
      };
    }

    it('writes, restarts, verifies and cleans up', () => {
      const deps = spies();
      const target = plan({ state: record() });

      const result = applyDisable(config(), target, deps);

      expect(deps.writeDaemon).toHaveBeenCalledWith(DAEMON_PATH, target.after);
      expect(deps.restart).toHaveBeenCalledTimes(1);
      expect(deps.removeService).toHaveBeenCalledTimes(1);
      expect(deps.clearRecord).toHaveBeenCalledTimes(1);
      expect(deps.writeEnv).toHaveBeenCalledWith(config().ENV_PATH, { DNS_ENABLE: 'false' });
      expect(result).toMatchObject({ wroteDaemon: true, verified: true, clearedRecord: true });
    });

    it('never restarts Docker when the file does not change', () => {
      // The user had already removed our entry. Restarting would terminate every
      // container on the machine to apply nothing at all.
      const deps = spies();
      const target = plan({ text: daemonText(['8.8.8.8']), state: record() });

      const result = applyDisable(config(), target, deps);

      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.restart).not.toHaveBeenCalled();
      expect(result.restart).toBeUndefined();
      expect(deps.clearRecord).toHaveBeenCalledTimes(1);
    });

    it('reports a verification failure rather than claiming success', () => {
      const deps = spies();
      deps.readDaemon = jest.fn(() => ({ text: daemonText([TARGET, '8.8.8.8']), existed: true }));
      const target = plan({ state: record() });

      expect(applyDisable(config(), target, deps).verified).toBe(false);
    });

    it('carries on when the dns service cannot be removed, and says so', () => {
      const deps = spies();
      deps.removeService = jest.fn(() => {
        throw new Error('docker compose failed');
      });
      const target = plan({ state: record() });

      const result = applyDisable(config(), target, deps);

      expect(result.serviceError).toBe('docker compose failed');
      expect(result.clearedRecord).toBe(true);
    });

    it('does not rewrite .env when DNS was already off', () => {
      const deps = spies();
      const target = plan({ state: record(), env: { DNS_ENABLE: 'false' } });

      const result = applyDisable(config({ DNS_ENABLE: 'false' }), target, deps);

      expect(deps.writeEnv).not.toHaveBeenCalled();
      expect(result.disabledInEnv).toBe(false);
    });

    it('skips verification when it deleted the file it created', () => {
      const deps = spies();
      const target = plan({
        text: `${JSON.stringify({ dns: [TARGET] }, null, 2)}\n`,
        state: record({ createdDnsKey: true, createdDaemonFile: true })
      });

      const result = applyDisable(config(), target, deps);

      expect(deps.deleteDaemon).toHaveBeenCalledWith(DAEMON_PATH);
      expect(deps.readDaemon).not.toHaveBeenCalled();
      expect(result.verified).toBe(true);
    });

    it('refuses to apply a plan that has blockers', () => {
      const blocked = plan({});

      expect(() => applyDisable(config(), blocked, spies())).toThrow('blockers');
    });
  });
});
