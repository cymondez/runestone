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

/** A monotonic clock for the retry window; `patient()` never runs out. */
function advancingClock(step: number) {
  let value = 0;
  return jest.fn(() => {
    value += step;
    return value;
  });
}

function patient() {
  return jest.fn(() => 0);
}

/** Our address only after the first call, which is the pre-restart reading. */
function notYetInEffect() {
  let calls = 0;
  return jest.fn(() => {
    calls += 1;
    return calls === 1 ? ['192.168.65.7'] : [TARGET, '8.8.8.8'];
  });
}

function spies(overrides: Partial<CompleteDependencies> = {}) {
  return {
    restart: jest.fn(restarted),
    // The daemon hands out its own resolver until the restart, and ours after.
    // A fixture that answered with our address from the start would describe a
    // machine where the restart had already happened.
    nameservers: notYetInEffect(),
    verify: jest.fn(() => ({ ok: true, answers: [TARGET] })),
    writeDaemon: jest.fn(),
    deleteDaemon: jest.fn(),
    startService: jest.fn(),
    stopService: jest.fn(),
    writeRecord: jest.fn(),
    clearRecord: jest.fn(),
    sleep: jest.fn(),
    // Advances far enough that one retry happens and then the window closes,
    // so a check that never passes ends rather than spinning.
    elapsed: advancingClock(50_000),
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
      // restart, which is the same resting place as --no-restart. Treating it as
      // a failure would invert a configuration that is correct.
      expect(result.failure).toBeUndefined();
      expect(result.restart.status).toBe('manual-required');
      expect(result.phase).toBe('prepared');
      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.stopService).not.toHaveBeenCalled();
      expect(deps.clearRecord).not.toHaveBeenCalled();
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
  describe('when this run wrote nothing to the daemon file', () => {
    // The `--no-restart` shape: one run writes the file and stops at prepared,
    // a later one restarts. If that later restart fails there is nothing to
    // invert, and inverting anyway would be actively harmful.
    function preparedEarlier() {
      const plan = makePlan();
      // The entries are already in the file, so this run changes nothing.
      return { ...plan, changesFile: false, before: plan.after };
    }

    it('keeps the ownership record instead of orphaning entries the daemon points at', () => {
      const plan = preparedEarlier();
      const deps = spies({ restart: jest.fn(() => ({ status: 'timed-out', waitedMs: 120000 })) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('restart');
      expect(result.invertedDaemon).toBe(false);
      // Cleared, `disable` would refuse to remove the entries for want of a
      // record, and the daemon would keep pointing at a service nobody owns.
      expect(deps.clearRecord).not.toHaveBeenCalled();
      expect(deps.writeRecord).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'prepared', preparedReason: 'no-restart' })
      );
    });

    it('leaves the dns service running, because the daemon is still pointed at it', () => {
      const plan = preparedEarlier();
      const deps = spies({ restart: jest.fn(() => ({ status: 'timed-out', waitedMs: 120000 })) });

      completeEnable(config(), plan, prepared(plan), deps);

      expect(deps.stopService).not.toHaveBeenCalled();
      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.deleteDaemon).not.toHaveBeenCalled();
    });
  });

  describe('after the restart, before believing anything', () => {
    // Measured on Docker Desktop: `docker desktop restart` returns and
    // `docker info` answers well before the containers it stopped are back. The
    // dns service is one of them, so a single-shot verification at that moment
    // failed a configuration that was perfectly correct, and inverted it.
    it('brings the dns service back rather than trusting the restart policy', () => {
      const plan = makePlan();
      const deps = spies();

      completeEnable(config(), plan, prepared(plan), deps);

      expect(deps.startService).toHaveBeenCalledWith(config().COMPOSE_FILE_PATH);
    });

    it('keeps asking while the service is still warming up, instead of failing it', () => {
      const plan = makePlan();
      let attempt = 0;
      const deps = spies({
        // Down for the first two polls, answering on the third.
        verify: jest.fn(() => {
          attempt += 1;
          return attempt < 3
            ? { ok: false, answers: [], error: 'timed out' }
            : { ok: true, answers: [TARGET] };
        }),
        elapsed: patient()
      });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.phase).toBe('applied');
      expect(result.failure).toBeUndefined();
      expect(attempt).toBe(3);
      expect(deps.writeDaemon).not.toHaveBeenCalled();
    });

    it('waits out an empty resolv.conf, which means the daemon is still settling', () => {
      const plan = makePlan();
      let attempt = 0;
      const deps = spies({
        nameservers: jest.fn(() => {
          attempt += 1;
          return attempt < 2 ? [] : [TARGET, '8.8.8.8'];
        }),
        elapsed: patient()
      });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.phase).toBe('applied');
    });

    it('fails at once on the wrong address, because waiting cannot change a fact', () => {
      const plan = makePlan();
      const deps = spies({ nameservers: jest.fn(() => ['9.9.9.9']) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('resolv-conf');
      expect(deps.sleep).not.toHaveBeenCalled();
    });

    it('gives up once the window is spent, and says which check never passed', () => {
      const plan = makePlan();
      let clock = 0;
      const deps = spies({
        verify: jest.fn(() => ({ ok: false, answers: [], error: 'timed out' }))
      });
      void clock;

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('resolution');
      expect(result.invertedDaemon).toBe(true);
    });

    it('reports a service that could not be brought back at all', () => {
      const plan = makePlan();
      const deps = spies({
        startService: jest.fn(() => {
          throw new Error('port is already allocated');
        })
      });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('service-gone');
      expect(result.failureMessage).toContain('port is already allocated');
    });
  });

  describe('when the configuration is already in effect', () => {
    // The write and the restart are separable on purpose, so the restart can
    // arrive from elsewhere: `--no-restart` then a manual restart, a reboot, or
    // a Docker Desktop update. Restarting again would terminate every container
    // on the machine to achieve nothing.
    it('marks it applied without restarting anything', () => {
      const plan = makePlan();
      const deps = spies({ nameservers: jest.fn(() => [TARGET, '8.8.8.8']) });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.alreadyInEffect).toBe(true);
      expect(result.phase).toBe('applied');
      expect(deps.restart).not.toHaveBeenCalled();
      expect(deps.writeRecord).toHaveBeenCalledWith(expect.objectContaining({ phase: 'applied' }));
    });

    it('still proves the domain resolves before believing it', () => {
      const plan = makePlan();
      const deps = spies({
        nameservers: jest.fn(() => [TARGET]),
        verify: jest.fn(() => ({ ok: false, answers: [], error: 'nothing answered' }))
      });

      const result = completeEnable(config(), plan, prepared(plan), deps);

      expect(result.failure).toBe('resolution');
      expect(result.phase).toBe('prepared');
      expect(deps.restart).not.toHaveBeenCalled();
      // Nothing was inverted: this run wrote nothing and the entries are not its
      // to withdraw.
      expect(deps.writeDaemon).not.toHaveBeenCalled();
      expect(deps.clearRecord).not.toHaveBeenCalled();
    });

    it('does restart when the daemon is handing out something else', () => {
      const plan = makePlan();
      const deps = spies({ nameservers: jest.fn(() => ['192.168.65.7']) });

      completeEnable(config(), plan, prepared(plan), deps);

      expect(deps.restart).toHaveBeenCalled();
    });
  });

});
