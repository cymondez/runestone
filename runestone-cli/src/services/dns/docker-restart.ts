import { spawnCommand } from '../../utils/spawn';
import { DockerRestartPlan, DockerRestartStep } from './daemon-target';

/**
 * Restarting Docker (spec 6.2).
 *
 * This is the destructive step of the whole feature: it terminates every
 * container on the machine, including projects that have nothing to do with
 * Runestone. Everything else can be rehearsed; this cannot. So it is isolated
 * here, it is never reached without the caller having confirmed, and it reports
 * what it did rather than assuming success — a restart command that returns 0
 * before the daemon is actually back would otherwise look like success while the
 * next Docker call fails.
 */

/** Spec 6.2: poll until Docker answers again, up to 120 seconds. */
export const RESTART_POLL_LIMIT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

export type RestartStatus =
  /** A restart command succeeded and Docker answered again. */
  | 'restarted'
  /** No command worked, but the platform allows asking the user to do it. */
  | 'manual-required'
  /** A command ran, but Docker never answered again within the limit. */
  | 'timed-out'
  /** Every candidate command failed and there is no manual fallback. */
  | 'failed';

export interface RestartOutcome {
  status: RestartStatus;
  step?: DockerRestartStep;
  /** Output of the last command that failed, for the error message. */
  error?: string;
  waitedMs: number;
}

export interface RestartDependencies {
  runStep: (step: DockerRestartStep) => { ok: boolean; message?: string };
  dockerResponds: () => boolean;
  sleep: (ms: number) => void;
  now: () => number;
}

function runStepWithDocker(step: DockerRestartStep): { ok: boolean; message?: string } {
  const result = spawnCommand(step.command, step.args, { encoding: 'utf8', timeout: 60_000 });
  if (result.error) {
    return { ok: false, message: result.error.message };
  }

  if (result.status !== 0) {
    return { ok: false, message: result.stderr?.trim() || result.stdout?.trim() || `exit ${String(result.status)}` };
  }

  return { ok: true };
}

function dockerRespondsWithDocker(): boolean {
  const result = spawnCommand('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    timeout: 15_000
  });

  return !result.error && result.status === 0 && Boolean(result.stdout?.trim());
}

/** A synchronous sleep, to match the rest of the CLI's synchronous Docker calls. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export const defaultRestartDependencies: RestartDependencies = {
  runStep: runStepWithDocker,
  dockerResponds: dockerRespondsWithDocker,
  sleep: sleepSync,
  now: () => Date.now()
};

/** Waits for Docker to answer again, which is the only proof a restart finished. */
export function waitForDocker(
  dependencies: Partial<RestartDependencies> = {},
  limitMs = RESTART_POLL_LIMIT_MS
): { responded: boolean; waitedMs: number } {
  const deps = { ...defaultRestartDependencies, ...dependencies };
  const started = deps.now();

  for (;;) {
    if (deps.dockerResponds()) {
      return { responded: true, waitedMs: deps.now() - started };
    }

    if (deps.now() - started >= limitMs) {
      return { responded: false, waitedMs: deps.now() - started };
    }

    deps.sleep(POLL_INTERVAL_MS);
  }
}

export function restartDocker(
  plan: DockerRestartPlan,
  dependencies: Partial<RestartDependencies> = {},
  limitMs = RESTART_POLL_LIMIT_MS
): RestartOutcome {
  const deps = { ...defaultRestartDependencies, ...dependencies };
  let lastError: string | undefined;

  for (const step of plan.steps) {
    const attempt = deps.runStep(step);
    if (!attempt.ok) {
      lastError = attempt.message;
      continue;
    }

    const waited = waitForDocker(deps, limitMs);
    return {
      status: waited.responded ? 'restarted' : 'timed-out',
      step,
      waitedMs: waited.waitedMs,
      ...(waited.responded ? {} : { error: lastError })
    };
  }

  return {
    status: plan.allowManualFallback ? 'manual-required' : 'failed',
    error: lastError,
    waitedMs: 0
  };
}
