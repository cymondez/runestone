import * as path from 'path';
import { CommandOutcome, DockerProbes } from '../../../src/services/dns/environment';
import { CompleteDependencies, EnablePlan, completeEnable, planEnable } from '../../../src/services/dns/enable';
import { DAEMON_PATH_OVERRIDE_ENV } from '../../../src/services/dns/daemon-target';
import { RestartOutcome } from '../../../src/services/dns/docker-restart';
import { DNS_STATE_SCHEMA_VERSION, DnsOwnershipState } from '../../../src/utils/tool-state';
import { RunestoneEnv } from '../../../src/utils/env-loader';
import { testEnv } from '../../helpers/env';

const TARGET = '172.17.0.1';
const DAEMON_PATH = path.resolve('/tmp/runestone-complete/daemon.json');

function ok(stdout: string): CommandOutcome {
  return { ok: true, stdout };
}

function config(overrides: Partial<RunestoneEnv> = {}): RunestoneEnv {
  return testEnv('/tmp/runestone-complete', { HOST_DOMAIN: 'example.test', ...overrides });
}

function daemonText(dns: string[]): string {
  return `${JSON.stringify({ dns, experimental: false }, null, 2)}\n`;
}

function makePlan(before = daemonText(['8.8.8.8']), existed = true): EnablePlan {
  const probes: Partial<DockerProbes> = {
    osType: () => ok('linux'),
    context: () => ok('desktop-linux|npipe:////./pipe/x'),
    runInContainer: () => ok(TARGET)
  };

  return planEnable(config(), {
    probes,
    hasRequiredVars: () => true,
    hostResolvers: () => [],
    readDaemon: () => ({ text: before, existed }),
    readRecord: () => undefined
  });
}

function prepared(plan: EnablePlan): DnsOwnershipState {
  return {
    schemaVersion: DNS_STATE_SCHEMA_VERSION,
    phase: 'prepared',
    preparedReason: 'no-restart',
    contextName: 'desktop-linux',
    daemonPath: plan.preflight.daemonPath,
    targetIp: TARGET,
    insertedEntries: plan.entries,
    createdDnsKey: plan.createdDnsKey,
    createdDaemonFile: plan.createdDaemonFile,
    upstreams: plan.preflight.upstreams.upstreams,
    updatedAt: '2026-08-28T00:00:00.000Z'
  };
}

function restarted(): RestartOutcome {
  return { status: 'restarted', waitedMs: 4000 };
}

function spies(overrides: Partial<CompleteDependencies> = {}) {
  return {
    restart: jest.fn(restarted),
    nameservers: jest.fn(() => [TARGET, '8.8.8.8']),
    verify: jest.fn(() => ({ ok: true, answers: [TARGET] })),
    writeDaemon: jest.fn(),
    deleteDaemon: jest.fn(),
    stopService: jest.fn(),
    writeRecord: jest.fn(),
    clearRecord: jest.fn(),
    now: () => '2026-08-28T01:00:00.000Z',
    ...overrides
  };
}

describe('completing an enable (spec 10.1 steps 5 to 7)', () => {
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

  it('marks the record applied only after both checks pass', () => {
    const plan = makePlan();
    const deps = spies();

    const result = completeEnable(config(), plan, prepared(plan), deps);

    expect(result.phase).toBe('applied');
    expect(result.failure).toBeUndefined();
    expect(deps.writeRecord).toHaveBeenCalledWith(expect.objectContaining({ phase: 'applied' }));
    expect((deps.writeRecord as jest.Mock).mock.calls[0][0]).not.toHaveProperty('preparedReason');
  });

  describe('the restart failing', () => {
    it('inverts the daemon change when Docker never comes back', () => {
      // The gate case for the dind harness: a restart that times out must leave
      // the file restored, not a half-applied global DNS setting.
      const plan = makePlan();
      const deps = spies({ restart: jest.fn(() => ({ status: 'timed-out', waitedMs: 120_000 }) as RestartOutcome) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('restart');
      expect(result.invertedDaemon).toBe(true);
      expect(deps.writeDaemon).toHaveBeenCalledWith(DAEMON_PATH, plan.before);
      expect(deps.stopService).toHaveBeenCalledTimes(1);
      expect(deps.clearRecord).toHaveBeenCalledTimes(1);
      expect(result.phase).toBe('prepared');
    });

    it('restarts again after inverting, because the inversion is not real until Docker reads it', () => {
      const plan = makePlan();
      const deps = spies({ restart: jest.fn(() => ({ status: 'failed', waitedMs: 0 }) as RestartOutcome) });

      completeEnable(config(), plan, prepared(plan), deps);

      expect(deps.restart).toHaveBeenCalledTimes(2);
    });

    it('deletes the file again when it was the one that created it', () => {
      const plan = makePlan('{}', false);
      const deps = spies({ restart: jest.fn(() => ({ status: 'timed-out', waitedMs: 1 }) as RestartOutcome) });

      completeEnable(config(), plan, prepared(plan), deps);

      expect(deps.deleteDaemon).toHaveBeenCalledWith(DAEMON_PATH);
      expect(deps.writeDaemon).not.toHaveBeenCalled();
    });

    it('leaves the record at prepared with a reason when the inversion itself fails', () => {
      const plan = makePlan();
      const deps = spies({
        restart: jest.fn(() => ({ status: 'timed-out', waitedMs: 1 }) as RestartOutcome),
        writeDaemon: jest.fn(() => {
          throw new Error('permission denied');
        })
      });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.rollbackError).toBe('permission denied');
      expect(deps.writeRecord).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'prepared', preparedReason: 'rollback-failed' })
      );
      expect(deps.clearRecord).not.toHaveBeenCalled();
    });

    it('stops without inverting when a manual restart is what is needed', () => {
      const plan = makePlan();
      const deps = spies({ restart: jest.fn(() => ({ status: 'manual-required', waitedMs: 0 }) as RestartOutcome) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      // Nothing is wrong: the write stands and takes effect at the user's own
      // restart, which is the same resting place as --no-restart.
      expect(result.failure).toBe('restart');
      expect(result.restart.status).toBe('manual-required');
    });
  });

  describe('the checks after the restart', () => {
    it('inverts when a new container is not given our address first', () => {
      const plan = makePlan();
      const deps = spies({ nameservers: jest.fn(() => ['8.8.8.8', TARGET]) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('resolv-conf');
      expect(result.invertedDaemon).toBe(true);
      expect(deps.verify).not.toHaveBeenCalled();
    });

    it('inverts when the managed domain does not resolve to us', () => {
      const plan = makePlan();
      const deps = spies({ verify: jest.fn(() => ({ ok: false, answers: ['127.0.0.1'], error: 'expected' })) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('resolution');
      expect(result.invertedDaemon).toBe(true);
      expect(deps.writeRecord).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'applied' }));
    });

    it('reports the nameservers it actually saw', () => {
      const plan = makePlan();
      const deps = spies({ nameservers: jest.fn(() => ['1.2.3.4']) });

      expect(completeEnable(config(), plan, prepared(plan), deps).nameservers).toEqual(['1.2.3.4']);
    });
  });
});
