import * as path from 'path';
import { CommandOutcome, DockerProbes } from '../../../src/services/dns/environment';
import { EnablePlan, applyEnable, planEnable, preflight } from '../../../src/services/dns/enable';
import { DAEMON_PATH_OVERRIDE_ENV } from '../../../src/services/dns/daemon-target';
import { DNS_STATE_SCHEMA_VERSION, DnsOwnershipState } from '../../../src/utils/tool-state';
import { RunestoneEnv } from '../../../src/utils/env-loader';
import { osDetector } from '../../../src/utils/os-detector';
import { testEnv } from '../../helpers/env';

const TARGET = '192.168.65.254';
const FALLBACK = '1.1.1.1';
const DAEMON_PATH = path.resolve('/tmp/runestone-enable/daemon.json');

function ok(stdout: string): CommandOutcome {
  return { ok: true, stdout };
}

function probes(overrides: Partial<DockerProbes> = {}): Partial<DockerProbes> {
  return {
    osType: () => ok('linux|Docker Desktop'),
    context: () => ok('desktop-linux|npipe:////./pipe/dockerDesktopLinuxEngine'),
    runInContainer: () => ok(TARGET),
    ...overrides
  };
}

function daemonText(dns?: string[], extra: Record<string, unknown> = { experimental: false }): string {
  return `${JSON.stringify(dns === undefined ? extra : { dns, ...extra }, null, 2)}\n`;
}

function config(overrides: Partial<RunestoneEnv> = {}): RunestoneEnv {
  return testEnv('/tmp/runestone-enable', { HOST_DOMAIN: 'example.test', ...overrides });
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

function makePlan(options: {
  env?: Partial<RunestoneEnv>;
  text?: string;
  existed?: boolean;
  state?: DnsOwnershipState;
  probes?: Partial<DockerProbes>;
  readThrows?: string;
  setupDone?: boolean;
  hostResolvers?: string[];
}): EnablePlan {
  return planEnable(config(options.env), {
    probes: probes(options.probes),
    hasRequiredVars: () => options.setupDone !== false,
    // Injected so the tests never depend on the resolvers of whichever machine
    // happens to be running them.
    hostResolvers: () => options.hostResolvers ?? [],
    readDaemon: () => {
      if (options.readThrows) {
        throw new Error(options.readThrows);
      }
      return { text: options.text ?? daemonText(['8.8.8.8']), existed: options.existed ?? true };
    },
    readRecord: () => options.state
  });
}

describe('dns enable', () => {
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

  describe('preflight (spec 10.1 step 1)', () => {
    function check(options: Parameters<typeof makePlan>[0]) {
      return makePlan(options).preflight;
    }

    it('passes when everything is in place', () => {
      const result = check({});

      expect(result.ok).toBe(true);
      expect(result.targetIp).toBe(TARGET);
      expect(result.failures).toEqual([]);
    });

    it('refuses when setup has not been run', () => {
      expect(check({ setupDone: false }).failures).toContainEqual({ kind: 'setup-incomplete' });
    });

    it('refuses when Docker is not answering', () => {
      const result = check({ probes: { osType: () => ({ ok: false, stdout: '', message: 'daemon not running' }) } });

      expect(result.failures.map((failure) => failure.kind)).toContain('docker-unavailable');
    });

    it('refuses Windows container mode', () => {
      const result = check({ probes: { osType: () => ok('windows|Docker Desktop') } });

      expect(result.failures).toContainEqual({ kind: 'windows-containers', osType: 'windows' });
    });

    it('refuses a Docker Desktop daemon while running on Linux', () => {
      // The shape of "the CLI inside WSL, talking to Docker Desktop": its
      // configuration is on the Windows side, so writing this filesystem's
      // ~/.docker/daemon.json would change a file Docker never reads.
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');

      const result = check({ probes: { osType: () => ok('linux|Docker Desktop') } });

      expect(result.failures).toContainEqual({
        kind: 'docker-desktop-elsewhere',
        operatingSystem: 'Docker Desktop'
      });
    });

    it('accepts a Docker Desktop daemon when the CLI is on the platform that owns it', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('win32');

      expect(check({ probes: { osType: () => ok('linux|Docker Desktop') } }).ok).toBe(true);
    });

    it('accepts a native engine on Linux', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');

      expect(check({ probes: { osType: () => ok('linux|Ubuntu 24.04.1 LTS') } }).ok).toBe(true);
    });

    it('refuses a remote context, because that is somebody else machine', () => {
      const result = check({ probes: { context: () => ok('remote|tcp://10.0.0.5:2376') } });

      expect(result.failures).toContainEqual({
        kind: 'remote-context',
        name: 'remote',
        endpoint: 'tcp://10.0.0.5:2376'
      });
    });

    it('refuses when host.docker.internal does not resolve to an address', () => {
      const result = check({ probes: { runInContainer: () => ok('') } });

      expect(result.failures.map((failure) => failure.kind)).toContain('target-ip');
    });

    it('refuses an unreadable daemon file', () => {
      const result = check({ readThrows: 'Daemon configuration is not valid JSON: bad' });

      expect(result.failures.map((failure) => failure.kind)).toContain('daemon-unreadable');
    });

    it('never fails for want of an upstream, and says when it fell back', () => {
      const result = check({ env: { DNS_UPSTREAM: '' }, text: daemonText([]) });

      expect(result.ok).toBe(true);
      expect(result.upstreams.upstreams).toEqual(['1.1.1.1']);
      expect(result.upstreamIsFallback).toBe(true);
    });

    it('detects upstreams from the daemon array before falling back', () => {
      const result = check({ env: { DNS_UPSTREAM: '' }, text: daemonText(['9.9.9.9']) });

      expect(result.upstreams.upstreams).toEqual(['9.9.9.9']);
      expect(result.upstreamIsFallback).toBe(false);
    });

    it('falls back to the host resolvers when the daemon array has none', () => {
      const result = check({ text: daemonText([]), hostResolvers: ['10.1.1.1', '127.0.0.53'] });

      // The systemd-resolved stub is dropped: forwarding to it would be asking
      // the machine to resolve through the thing we are replacing.
      expect(result.upstreams.origins).toEqual([{ value: '10.1.1.1', origin: 'host' }]);
    });

    it('detects when nothing has been configured at all', () => {
      // Regression: the loader used to default DNS_UPSTREAM to 1.1.1.1, which
      // looked like a choice the user had made, so detection never ran. On a
      // network that only permits its own resolvers, every container lookup on
      // the machine would have been forwarded to a public resolver instead.
      const result = check({ text: daemonText(['10.20.30.40']) });

      expect(result.upstreams.origins).toEqual([{ value: '10.20.30.40', origin: 'daemon' }]);
    });

    it('binds every interface on Docker Desktop', () => {
      expect(check({}).bindIp).toBe('0.0.0.0');
    });

    it('honours an explicit bind address', () => {
      expect(check({ env: { DNS_BIND_IP: '127.0.0.1' } }).bindIp).toBe('127.0.0.1');
    });
  });

  describe('planning', () => {
    it('inserts our entry at the front of an existing array', () => {
      const plan = makePlan({});

      expect(plan.mode).toBe('insert');
      expect(JSON.parse(plan.after).dns).toEqual([TARGET, '8.8.8.8']);
      expect(plan.entries).toEqual([{ role: 'target', value: TARGET, index: 0 }]);
      expect(plan.changesFile).toBe(true);
    });

    it('adds the 9.7 fallback second when it is configured', () => {
      const plan = makePlan({ env: { DNS_DAEMON_FALLBACK: FALLBACK } });

      expect(JSON.parse(plan.after).dns).toEqual([TARGET, FALLBACK, '8.8.8.8']);
      expect(plan.entries.map((entry) => entry.role)).toEqual(['target', 'fallback']);
    });

    it('reports a duplicate without removing it', () => {
      const plan = makePlan({ text: daemonText(['8.8.8.8', TARGET]) });

      expect(plan.duplicates).toEqual([TARGET]);
      expect(JSON.parse(plan.after).dns).toEqual([TARGET, '8.8.8.8', TARGET]);
    });

    it('records that it created the file when there was none', () => {
      const plan = makePlan({ text: '{}', existed: false });

      expect(plan.createdDaemonFile).toBe(true);
      expect(plan.createdDnsKey).toBe(true);
    });

    it('writes .env values that describe what it actually resolved', () => {
      const plan = makePlan({ env: { DNS_UPSTREAM: '10.0.0.1,10.0.0.2' } });

      expect(plan.envUpdates).toEqual({
        DNS_ENABLE: 'true',
        DNS_HOST_IP: TARGET,
        DNS_BIND_IP: '0.0.0.0',
        DNS_UPSTREAM: '10.0.0.1,10.0.0.2',
        DNS_CONTAINER_RESOLVER: '10.0.0.1'
      });
    });

    describe('with a record already in hand (spec 9.5 re-entrancy)', () => {
      it('never inserts a second entry of ours', () => {
        const plan = makePlan({ text: daemonText([TARGET, '8.8.8.8']), state: record() });

        expect(plan.mode).toBe('reconcile');
        expect(plan.changesFile).toBe(false);
        expect(JSON.parse(plan.after).dns).toEqual([TARGET, '8.8.8.8']);
      });

      it('leaves a displaced entry alone when automatic reordering is off', () => {
        const plan = makePlan({ text: daemonText(['10.0.0.1', TARGET]), state: record() });

        expect(plan.changesFile).toBe(false);
        expect(plan.atFront).toBe(false);
      });

      it('moves it back to the front when automatic reordering is on', () => {
        const plan = makePlan({
          env: { DNS_AUTO_REORDER: 'true' },
          text: daemonText(['10.0.0.1', TARGET]),
          state: record()
        });

        expect(plan.changesFile).toBe(true);
        expect(JSON.parse(plan.after).dns).toEqual([TARGET, '10.0.0.1']);
      });

      it('rotates the Target IP in one transaction when it changed (spec 9.4)', () => {
        const plan = makePlan({
          text: daemonText(['10.9.9.9', '8.8.8.8']),
          state: record({ targetIp: '10.9.9.9', insertedEntries: [{ role: 'target', value: '10.9.9.9', index: 0 }] })
        });

        expect(plan.mode).toBe('rotate');
        expect(JSON.parse(plan.after).dns).toEqual([TARGET, '8.8.8.8']);
      });

      it('rotates when the fallback is turned on afterwards', () => {
        const plan = makePlan({
          env: { DNS_DAEMON_FALLBACK: FALLBACK },
          text: daemonText([TARGET, '8.8.8.8']),
          state: record()
        });

        expect(plan.mode).toBe('rotate');
        expect(JSON.parse(plan.after).dns).toEqual([TARGET, FALLBACK, '8.8.8.8']);
      });

      it('refuses to rotate while an ownership conflict stands', () => {
        const plan = makePlan({
          text: daemonText(['10.0.0.1', '10.9.9.9', '10.9.9.9']),
          state: record({ targetIp: '10.9.9.9', insertedEntries: [{ role: 'target', value: '10.9.9.9', index: 0 }] })
        });

        expect(plan.conflicts).toHaveLength(1);
        expect(plan.after).toBe(plan.before);
      });
    });
  });

  describe('applying (spec 10.1 steps 2 to 4)', () => {
    function spies() {
      return {
        writeEnv: jest.fn(),
        ensureFiles: jest.fn(),
        syncUiRoute: jest.fn(() => true),
        startService: jest.fn(),
        stopService: jest.fn(),
        verify: jest.fn(() => ({ ok: true, answers: [TARGET] })),
        writeDaemon: jest.fn(),
        writeRecord: jest.fn(),
        clearRecord: jest.fn(),
        now: () => '2026-08-28T00:00:00.000Z'
      };
    }

    it('writes the daemon configuration last, and stops at prepared', () => {
      const deps = spies();
      const plan = makePlan({});

      const result = applyEnable(config(), plan, deps);

      expect(result.stage).toBe('prepared');
      expect(deps.writeDaemon).toHaveBeenCalledWith(DAEMON_PATH, plan.after);
      expect(result.record).toMatchObject({ phase: 'prepared', preparedReason: 'no-restart', targetIp: TARGET });
    });

    it('records ownership before writing the file, so no entry can be orphaned', () => {
      const deps = spies();
      const order: string[] = [];
      deps.writeRecord = jest.fn(() => {
        order.push('record');
      });
      deps.writeDaemon = jest.fn(() => {
        order.push('daemon');
      });

      applyEnable(config(), makePlan({}), deps);

      expect(order).toEqual(['record', 'daemon']);
    });

    it('never opens the daemon file when the service does not start', () => {
      const deps = spies();
      deps.startService = jest.fn(() => {
        throw new Error('port 53 is in use');
      });

      const result = applyEnable(config(), makePlan({}), deps);

      expect(result.failure).toBe('service-start');
      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.writeRecord).not.toHaveBeenCalled();
      expect(result.rolledBack).toBe(true);
    });

    it('never opens the daemon file when the service does not answer', () => {
      // A container that started is not a container that answers, and this is
      // the last point at which nothing global has been touched.
      const deps = spies();
      deps.verify = jest.fn(() => ({ ok: false, answers: [], error: 'no answer' }));

      const result = applyEnable(config(), makePlan({}), deps);

      expect(result.failure).toBe('verification');
      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.stopService).toHaveBeenCalledTimes(1);
      expect(deps.writeEnv).toHaveBeenLastCalledWith(config().ENV_PATH, expect.objectContaining({ DNS_ENABLE: 'false' }));
    });

    it('undoes everything when the daemon write fails', () => {
      const deps = spies();
      deps.writeDaemon = jest.fn(() => {
        throw new Error('permission denied');
      });

      const result = applyEnable(config(), makePlan({}), deps);

      expect(result.failure).toBe('daemon-write');
      expect(deps.clearRecord).toHaveBeenCalledTimes(1);
      expect(deps.stopService).toHaveBeenCalledTimes(1);
      expect(result.rolledBack).toBe(true);
    });

    it('reports a rollback that itself failed rather than hiding it', () => {
      const deps = spies();
      deps.verify = jest.fn(() => ({ ok: false, answers: [], error: 'no answer' }));
      deps.stopService = jest.fn(() => {
        throw new Error('docker is gone');
      });

      const result = applyEnable(config(), makePlan({}), deps);

      expect(result.rollbackError).toBe('docker is gone');
    });

    it('does not write the file at all when reconciliation changes nothing', () => {
      const deps = spies();
      const plan = makePlan({ text: daemonText([TARGET, '8.8.8.8']), state: record() });

      const result = applyEnable(config(), plan, deps);

      expect(result.wroteDaemon).toBe(false);
      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.writeRecord).toHaveBeenCalledTimes(1);
    });

    it('refuses to apply a plan that did not pass preflight', () => {
      expect(() => applyEnable(config(), makePlan({ setupDone: false }), spies())).toThrow('preflight');
    });
  });
});
