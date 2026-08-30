import { DockerRestartPlan, DockerRestartStep } from '../../../src/services/dns/daemon-target';
import { restartDocker, waitForDocker } from '../../../src/services/dns/docker-restart';

const DESKTOP: DockerRestartPlan = {
  source: 'platform',
  host: 'docker-desktop',
  allowManualFallback: true,
  steps: [{ command: 'docker', args: ['desktop', 'restart'] }]
};

const LINUX: DockerRestartPlan = {
  source: 'platform',
  host: 'linux-engine',
  allowManualFallback: false,
  steps: [
    { command: 'sudo', args: ['systemctl', 'restart', 'docker'] },
    { command: 'sudo', args: ['service', 'docker', 'restart'] }
  ]
};

function clock() {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms: number) => {
      current += ms;
    }
  };
}

describe('restarting Docker (spec 6.2)', () => {
  it('reports success only once Docker answers again', () => {
    const time = clock();
    let polls = 0;
    const ran: DockerRestartStep[] = [];

    const outcome = restartDocker(DESKTOP, {
      runStep: (step) => {
        ran.push(step);
        return { ok: true };
      },
      dockerResponds: () => {
        polls += 1;
        return polls > 2;
      },
      ...time
    });

    expect(ran).toEqual(DESKTOP.steps);
    expect(outcome.status).toBe('restarted');
    expect(outcome.waitedMs).toBeGreaterThan(0);
  });

  it('falls through to the next command when the first fails', () => {
    const ran: string[] = [];

    const outcome = restartDocker(LINUX, {
      runStep: (step) => {
        ran.push(step.args.join(' '));
        return step.args[0] === 'systemctl' ? { ok: false, message: 'no systemd' } : { ok: true };
      },
      dockerResponds: () => true,
      ...clock()
    });

    expect(ran).toEqual(['systemctl restart docker', 'service docker restart']);
    expect(outcome.status).toBe('restarted');
    expect(outcome.step).toEqual(LINUX.steps[1]);
  });

  it('asks for a manual restart when the platform allows one', () => {
    const outcome = restartDocker(DESKTOP, {
      runStep: () => ({ ok: false, message: 'unknown command' }),
      dockerResponds: () => true,
      ...clock()
    });

    expect(outcome.status).toBe('manual-required');
    expect(outcome.error).toBe('unknown command');
  });

  it('fails outright when no command worked and there is no manual fallback', () => {
    const outcome = restartDocker(LINUX, {
      runStep: () => ({ ok: false, message: 'not permitted' }),
      dockerResponds: () => true,
      ...clock()
    });

    expect(outcome.status).toBe('failed');
  });

  it('does not claim success when Docker never comes back', () => {
    // A restart command that exits 0 before the daemon is actually up would
    // otherwise look like success right until the next Docker call fails.
    const outcome = restartDocker(
      DESKTOP,
      {
        runStep: () => ({ ok: true }),
        dockerResponds: () => false,
        ...clock()
      },
      10_000
    );

    expect(outcome.status).toBe('timed-out');
    expect(outcome.waitedMs).toBeGreaterThanOrEqual(10_000);
  });

  describe('waitForDocker', () => {
    it('returns as soon as Docker answers, without sleeping', () => {
      const time = clock();

      expect(waitForDocker({ dockerResponds: () => true, ...time })).toEqual({ responded: true, waitedMs: 0 });
    });

    it('gives up at the limit', () => {
      const result = waitForDocker({ dockerResponds: () => false, ...clock() }, 6_000);

      expect(result.responded).toBe(false);
      expect(result.waitedMs).toBeGreaterThanOrEqual(6_000);
    });
  });
});
