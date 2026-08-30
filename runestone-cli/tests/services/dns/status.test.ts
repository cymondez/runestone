import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDnsStatusReport, preparedReasonOf } from '../../../src/services/dns/status';
import {
  DAEMON_PATH_OVERRIDE_ENV,
  RESTART_CMD_OVERRIDE_ENV
} from '../../../src/services/dns/daemon-target';
import { DnsOwnershipState, DNS_STATE_SCHEMA_VERSION } from '../../../src/utils/tool-state';
import { RunestoneEnv } from '../../../src/utils/env-loader';
import { testEnv } from '../../helpers/env';

const TARGET = '192.168.65.254';
const FALLBACK = '1.1.1.1';
const DAEMON_PATH = path.join('C:', 'Users', 'me', '.docker', 'daemon.json');

function daemon(dns: string[] | undefined): string {
  return dns === undefined
    ? JSON.stringify({ experimental: false }, null, 2)
    : JSON.stringify({ dns, experimental: false }, null, 2);
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
    upstreams: ['1.0.0.1'],
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...overrides
  };
}

function config(overrides: Partial<RunestoneEnv> = {}): RunestoneEnv {
  return testEnv('/tmp/runestone', {
    DNS_ENABLE: 'true',
    DNS_HOST_IP: TARGET,
    DNS_BIND_IP: '0.0.0.0',
    ...overrides
  });
}

function report(options: {
  env?: Partial<RunestoneEnv>;
  dns?: string[];
  state?: DnsOwnershipState;
  daemonText?: string;
  exists?: boolean;
}) {
  return buildDnsStatusReport(config(options.env), {
    readDaemon: () => ({
      text: options.daemonText ?? daemon(options.dns),
      exists: options.exists ?? true
    }),
    readRecord: () => options.state,
    listContainers: () => []
  });
}

describe('dns status report (spec 10.3)', () => {
  const originalDaemonOverride = process.env[DAEMON_PATH_OVERRIDE_ENV];
  const originalRestartOverride = process.env[RESTART_CMD_OVERRIDE_ENV];

  beforeEach(() => {
    process.env[DAEMON_PATH_OVERRIDE_ENV] = DAEMON_PATH;
    delete process.env[RESTART_CMD_OVERRIDE_ENV];
  });

  afterAll(() => {
    if (originalDaemonOverride === undefined) {
      delete process.env[DAEMON_PATH_OVERRIDE_ENV];
    } else {
      process.env[DAEMON_PATH_OVERRIDE_ENV] = originalDaemonOverride;
    }
    if (originalRestartOverride === undefined) {
      delete process.env[RESTART_CMD_OVERRIDE_ENV];
    } else {
      process.env[RESTART_CMD_OVERRIDE_ENV] = originalRestartOverride;
    }
  });

  describe('settings', () => {
    it('reports the feature as disabled when DNS_ENABLE is absent', () => {
      const result = report({ env: { DNS_ENABLE: '' } });

      expect(result.enabled).toBe(false);
    });

    it('reports the target and bind addresses in effect', () => {
      const result = report({ dns: [TARGET] });

      expect(result.targetIp).toBe(TARGET);
      expect(result.bindIp).toBe('0.0.0.0');
    });

    it('shows the upstream list with the origin of each value', () => {
      const result = report({ env: { DNS_UPSTREAM: '10.0.0.1, 10.0.0.2' }, dns: [TARGET] });

      expect(result.upstreams.origins).toEqual([
        { value: '10.0.0.1', origin: 'env' },
        { value: '10.0.0.2', origin: 'env' }
      ]);
    });

    it('reports the 9.7 fallback as off by default and on when set', () => {
      expect(report({ dns: [TARGET] }).fallback).toBeUndefined();
      expect(report({ env: { DNS_DAEMON_FALLBACK: FALLBACK }, dns: [TARGET, FALLBACK] }).fallback).toBe(FALLBACK);
    });

    it('reports the UI URL and that it has no authentication', () => {
      const result = report({ env: { HOST_DOMAIN: 'example.test' } });

      expect(result.ui).toEqual({ enabled: true, url: 'https://dns.example.test', authConfigured: false });
    });

    it('reports configured UI authentication', () => {
      expect(report({ env: { DNS_UI_USER: 'me', DNS_UI_PASS: 'secret' } }).ui.authConfigured).toBe(true);
    });
  });

  describe('the daemon file', () => {
    it('reports an absent file rather than inventing one', () => {
      const result = report({ daemonText: '{}', exists: false });

      expect(result.daemon.exists).toBe(false);
      expect(result.daemon.entries).toEqual([]);
    });

    it('reports the array as it stands', () => {
      expect(report({ dns: [TARGET, '8.8.8.8'] }).daemon.entries).toEqual([TARGET, '8.8.8.8']);
    });

    it('reports a parse failure instead of throwing', () => {
      const result = buildDnsStatusReport(config(), {
        readDaemon: () => {
          throw new Error('Daemon configuration is not valid JSON: unexpected end');
        },
        readRecord: () => undefined,
        listContainers: () => []
      });

      expect(result.daemon.error).toContain('not valid JSON');
      expect(result.daemon.entries).toBeUndefined();
    });

    it('reports the development overrides in effect, because they are a hazard', () => {
      process.env[RESTART_CMD_OVERRIDE_ENV] = 'docker restart dind';

      const result = report({});

      expect(result.overrides).toEqual([
        { variable: DAEMON_PATH_OVERRIDE_ENV, value: DAEMON_PATH },
        { variable: RESTART_CMD_OVERRIDE_ENV, value: 'docker restart dind' }
      ]);
      expect(result.restart.source).toBe('override');
    });
  });

  describe('every state of spec 9.5', () => {
    it('no record at all', () => {
      const result = report({ dns: ['8.8.8.8'] });

      expect(result.record).toBeUndefined();
      expect(result.identifications).toBeUndefined();
    });

    it('our entry in place', () => {
      const result = report({ dns: [TARGET, '8.8.8.8'], state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'matched', index: 0 });
      expect(result.atFront).toBe(true);
      expect(result.unownedTargetDuplicates).toBe(0);
    });

    it('user entries added after ours', () => {
      const result = report({ dns: [TARGET, '8.8.8.8', '9.9.9.9'], state: record() });

      expect(result.atFront).toBe(true);
    });

    it('our entry displaced by the user inserting their own first', () => {
      const result = report({ dns: ['10.0.0.1', TARGET], state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'matched', index: 1 });
      expect(result.atFront).toBe(false);
    });

    it('a duplicate of the Target IP the user added', () => {
      const result = report({ dns: [TARGET, '8.8.8.8', TARGET], state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'matched', index: 0 });
      expect(result.unownedTargetDuplicates).toBe(1);
    });

    it('our entry removed by hand', () => {
      const result = report({ dns: ['8.8.8.8'], state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'removed', valueAtRecordedIndex: '8.8.8.8' });
      expect(result.unownedTargetDuplicates).toBe(0);
    });

    it('our entry value changed, which is indistinguishable from removed', () => {
      const result = report({ dns: ['10.0.0.9', '8.8.8.8'], state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'removed', valueAtRecordedIndex: '10.0.0.9' });
    });

    it('an ownership conflict from multiple matches', () => {
      const result = report({ dns: ['10.0.0.1', TARGET, TARGET], state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'conflict', matches: [1, 2] });
    });

    it('the dns key gone entirely', () => {
      const result = report({ dns: undefined, state: record() });

      expect(result.identifications?.[0]).toMatchObject({ status: 'removed' });
      expect(result.daemon.entries).toEqual([]);
    });

    it('both owned entries, with the fallback in place', () => {
      const state = record({
        insertedEntries: [
          { role: 'target', value: TARGET, index: 0 },
          { role: 'fallback', value: FALLBACK, index: 1 }
        ]
      });

      const result = report({ env: { DNS_DAEMON_FALLBACK: FALLBACK }, dns: [TARGET, FALLBACK, '8.8.8.8'], state });

      expect(result.identifications?.map((identification) => identification.status)).toEqual(['matched', 'matched']);
      expect(result.atFront).toBe(true);
    });

    it('a file reformatted by the Docker Engine UI', () => {
      const state = record();
      const reformatted = JSON.stringify({ dns: [TARGET], experimental: false });

      const result = report({ daemonText: reformatted, state });

      expect(result.identifications?.[0]).toMatchObject({ status: 'matched', index: 0 });
    });
  });

  describe('phase and recorded context', () => {
    it('distinguishes applied from the two prepared causes', () => {
      expect(preparedReasonOf(record({ phase: 'applied' }))).toBeUndefined();
      expect(preparedReasonOf(record({ phase: 'prepared', preparedReason: 'no-restart' }))).toBe('no-restart');
      expect(preparedReasonOf(record({ phase: 'prepared', preparedReason: 'rollback-failed' }))).toBe(
        'rollback-failed'
      );
    });

    it('says the cause is unknown rather than guessing', () => {
      expect(preparedReasonOf(record({ phase: 'prepared' }))).toBe('unknown');
    });

    it('flags a record written against a different daemon path', () => {
      const result = report({ dns: [TARGET], state: record({ daemonPath: '/etc/docker/daemon.json' }) });

      expect(result.recordPathMismatch).toBe(true);
    });

    it('does not flag a matching path', () => {
      expect(report({ dns: [TARGET], state: record() }).recordPathMismatch).toBe(false);
    });
  });

  describe('the dns service', () => {
    it('reports the container when it is there', () => {
      const result = buildDnsStatusReport(config(), {
        readDaemon: () => ({ text: daemon([TARGET]), exists: true }),
        readRecord: () => undefined,
        listContainers: () => [
          { Id: '1', Name: 'runestone-dns', State: 'running', Status: 'Up 2 minutes', Service: 'dns' },
          { Id: '2', Name: 'runestone', State: 'running', Status: 'Up 2 minutes', Service: 'runestone' }
        ]
      });

      expect(result.service).toEqual({ name: 'runestone-dns', state: 'running', status: 'Up 2 minutes' });
    });

    it('reports a docker failure as a message rather than failing the command', () => {
      const result = buildDnsStatusReport(config(), {
        readDaemon: () => ({ text: daemon([TARGET]), exists: true }),
        readRecord: () => undefined,
        listContainers: () => {
          throw new Error('docker compose failed');
        }
      });

      expect(result.serviceError).toBe('docker compose failed');
      expect(result.service).toBeUndefined();
    });
  });

  describe('it writes nothing', () => {
    it('leaves the daemon file and its directory exactly as they were', () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-status-'));
      const daemonPath = path.join(directory, 'daemon.json');
      const original = daemon([TARGET, '8.8.8.8']);
      fs.writeFileSync(daemonPath, original, 'utf8');

      const statePath = path.join(directory, 'runestone.config.json');
      const previousStatePath = process.env.RUNESTONE_TOOL_STATE_PATH;
      process.env.RUNESTONE_TOOL_STATE_PATH = statePath;
      process.env[DAEMON_PATH_OVERRIDE_ENV] = daemonPath;

      try {
        // Only the docker call is injected; the daemon file and the ownership
        // record are read for real, which is the part that could write.
        buildDnsStatusReport(config(), { listContainers: () => [] });

        expect(fs.readFileSync(daemonPath, 'utf8')).toBe(original);
        expect(fs.readdirSync(directory)).toEqual(['daemon.json']);
        expect(fs.existsSync(statePath)).toBe(false);
      } finally {
        if (previousStatePath === undefined) {
          delete process.env.RUNESTONE_TOOL_STATE_PATH;
        } else {
          process.env.RUNESTONE_TOOL_STATE_PATH = previousStatePath;
        }
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
