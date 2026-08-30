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

/**
 * Development override, in the same family as those in spec 7.4 and equally
 * absent from `.env` and setup. Without it the rollback-on-timeout path can only
 * be exercised by waiting two minutes, which is long enough that nobody tests it
 * — and it is the path that matters most.
 */
export const RESTART_TIMEOUT_OVERRIDE_ENV = 'RUNESTONE_DNS_RESTART_TIMEOUT_MS';

export function restartPollLimit(): number {
  const raw = process.env[RESTART_TIMEOUT_OVERRIDE_ENV];
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : RESTART_POLL_LIMIT_MS;
}

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
  /** Containers started again afterwards, only ever when asked to (see `RestartOptions`). */
  restored?: string[];
  /** Containers that were running before and refused to start again. */
  lost?: string[];
}

export interface RestartOptions {
  /**
   * Record what is running before the restart and start back whatever does not
   * return. **Off unless the user asks for it.**
   *
   * Runestone has no business starting containers it does not own, so this is
   * never a default and never silent. It exists for one situation: a Docker
   * Desktop older than `DESKTOP_SAFE_RESTART_VERSION`, whose restart leaves
   * `unless-stopped` containers down for good. Offered as a choice, alongside
   * updating Docker Desktop and restarting by hand, and taken only if chosen.
   */
  restoreContainers?: boolean;
}

export interface RestartDependencies {
  runStep: (step: DockerRestartStep) => { ok: boolean; message?: string };
  dockerResponds: () => boolean;
  sleep: (ms: number) => void;
  now: () => number;
  runningContainers: () => string[];
  startContainer: (name: string) => boolean;
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

function runningContainersWithDocker(): string[] {
  const result = spawnCommand('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
    timeout: 30_000
  });

  if (result.error || result.status !== 0) {
    return [];
  }

  return (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function startContainerWithDocker(name: string): boolean {
  const result = spawnCommand('docker', ['start', name], { encoding: 'utf8', timeout: 60_000 });
  return !result.error && result.status === 0;
}

export const defaultRestartDependencies: RestartDependencies = {
  runStep: runStepWithDocker,
  dockerResponds: dockerRespondsWithDocker,
  sleep: sleepSync,
  now: () => Date.now(),
  runningContainers: runningContainersWithDocker,
  startContainer: startContainerWithDocker
};

/** Long enough for containers that recover on their own to have done so. */
const SETTLE_MS = 5_000;

function restoreContainers(
  before: string[],
  deps: RestartDependencies
): { restored: string[]; lost: string[] } {
  if (before.length === 0) {
    return { restored: [], lost: [] };
  }

  deps.sleep(SETTLE_MS);

  const running = new Set(deps.runningContainers());
  const restored: string[] = [];
  const lost: string[] = [];

  for (const name of before) {
    if (running.has(name)) {
      continue;
    }

    if (deps.startContainer(name)) {
      restored.push(name);
    } else {
      lost.push(name);
    }
  }

  return { restored, lost };
}

/** Waits for Docker to answer again, which is the only proof a restart finished. */
export function waitForDocker(
  dependencies: Partial<RestartDependencies> = {},
  limitMs = restartPollLimit()
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
  limitMs = restartPollLimit(),
  options: RestartOptions = {}
): RestartOutcome {
  const deps = { ...defaultRestartDependencies, ...dependencies };
  let lastError: string | undefined;

  // Only recorded when the user asked for the containers to be put back;
  // otherwise nothing outside Runestone's own project is even looked at.
  const before = options.restoreContainers ? deps.runningContainers() : [];

  for (const step of plan.steps) {
    const attempt = deps.runStep(step);
    if (!attempt.ok) {
      lastError = attempt.message;
      continue;
    }

    const waited = waitForDocker(deps, limitMs);
    if (!waited.responded) {
      return { status: 'timed-out', step, waitedMs: waited.waitedMs, error: lastError };
    }

    return {
      status: 'restarted',
      step,
      waitedMs: waited.waitedMs,
      ...(options.restoreContainers ? restoreContainers(before, deps) : {})
    };
  }

  return {
    status: plan.allowManualFallback ? 'manual-required' : 'failed',
    error: lastError,
    waitedMs: 0
  };
}
