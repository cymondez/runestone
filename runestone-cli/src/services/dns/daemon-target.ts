import * as path from 'path';
import { osDetector } from '../../utils/os-detector';

/**
 * Resolution of the two operations that touch global state: which daemon
 * configuration file is written, and which command restarts Docker.
 *
 * Both can be redirected by an environment variable (spec 7.4). The overrides
 * are deliberately absent from `.env` and from `runestone setup`; they exist so
 * that the ownership engine can be developed and tested without a real daemon
 * file and without a real Docker restart. Because a wrong path means writing to
 * the wrong file, `dns status` and `doctor` must report prominently whenever one
 * is active, and every risk disclosure must print the values actually in effect
 * rather than the platform defaults.
 *
 * This module only resolves. It never reads, writes or restarts anything.
 */

export const DAEMON_PATH_OVERRIDE_ENV = 'RUNESTONE_DNS_DAEMON_PATH';
export const RESTART_CMD_OVERRIDE_ENV = 'RUNESTONE_DNS_RESTART_CMD';

/**
 * Where the daemon configuration lives and how Docker is restarted (spec 6.2).
 *
 * There is deliberately no WSL variant. Running the CLI inside WSL against a
 * Docker Desktop daemon would mean writing to the WSL home's
 * `~/.docker/daemon.json` — a file Docker Desktop never reads — so the write
 * would report success while DNS silently did nothing, which is the exact
 * failure this whole feature exists to remove. That case is **refused** in
 * preflight instead, on the strength of what `docker info` says the daemon is,
 * rather than guessed at from a kernel string that a container reports too.
 */
export type DaemonHost = 'docker-desktop' | 'linux-engine';

export type ResolutionSource = 'override' | 'platform';

export interface DaemonEnvironment {
  host: DaemonHost;
  /** Native home directory; used by the Docker Desktop host. */
  homeDir: string;
}

export interface DaemonConfigTarget {
  /** Absolute path to the daemon configuration file. */
  path: string;
  source: ResolutionSource;
  host: DaemonHost;
  /** `/etc/docker/daemon.json` needs privilege escalation (spec 9.3). */
  requiresPrivilege: boolean;
}

export interface DockerRestartStep {
  command: string;
  args: string[];
}

export interface DockerRestartPlan {
  source: ResolutionSource;
  /** Candidates in order; the first one that succeeds wins. */
  steps: DockerRestartStep[];
  /** Whether falling back to asking the user to restart Docker by hand is valid. */
  allowManualFallback: boolean;
  host: DaemonHost;
  /** The override string exactly as given, for disclosure output. */
  raw?: string;
}

export interface ActiveOverride {
  variable: string;
  value: string;
}

function readOverride(variable: string): string | undefined {
  const raw = process.env[variable];
  if (typeof raw !== 'string') {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Splits an override command into a command and arguments, honouring single and
 * double quotes. The override is run without a shell, so quoting is the only
 * shell-like syntax it supports.
 */
export function parseRestartCommand(input: string): DockerRestartStep {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }

    current += char;
    started = true;
  }

  if (quote) {
    throw new Error(`${RESTART_CMD_OVERRIDE_ENV} has an unterminated ${quote} quote: ${input}`);
  }

  if (started) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error(`${RESTART_CMD_OVERRIDE_ENV} is set but contains no command`);
  }

  return { command: tokens[0], args: tokens.slice(1) };
}

export function detectDaemonEnvironment(): DaemonEnvironment {
  const homeDir = osDetector.homeDir();
  const platform = osDetector.platform();

  return platform === 'win32' || platform === 'darwin'
    ? { host: 'docker-desktop', homeDir }
    : { host: 'linux-engine', homeDir };
}

/** The platform default from spec 6.2, ignoring any override. */
export function platformDaemonPath(environment: DaemonEnvironment): string {
  return environment.host === 'docker-desktop'
    ? path.join(environment.homeDir, '.docker', 'daemon.json')
    : '/etc/docker/daemon.json';
}

export interface RestartPlanOptions {
  /**
   * Whether this Docker Desktop is new enough that restarting it leaves the
   * machine's containers recoverable. **Defaults to false**: not knowing is not
   * the same as knowing it is safe.
   */
  desktopRestartIsSafe?: boolean;
}

/** The platform default from spec 6.2, ignoring any override. */
export function platformRestartPlan(
  environment: DaemonEnvironment,
  options: RestartPlanOptions = {}
): Omit<DockerRestartPlan, 'source' | 'raw'> {
  if (environment.host === 'linux-engine') {
    return {
      host: environment.host,
      steps: [
        { command: 'sudo', args: ['systemctl', 'restart', 'docker'] },
        { command: 'sudo', args: ['service', 'docker', 'restart'] }
      ],
      allowManualFallback: false
    };
  }

  // **Whether Docker Desktop may be restarted automatically depends on its
  // version.**
  //
  // Older releases stopped the running containers on restart, and
  // `unless-stopped` means "restart unless it was stopped" — so by definition
  // those stayed down afterwards, permanently. Measured twice on this platform:
  // every `always` container returned and every `unless-stopped` one did not,
  // and waiting never helped because nothing was pending. From
  // `DESKTOP_SAFE_RESTART_VERSION` on, that is fixed and the restart is safe to
  // attempt.
  //
  // Below it, Runestone attempts nothing: the write stands and the applying is
  // handed back, which is the same place `--no-restart` stops.
  return {
    host: environment.host,
    steps: options.desktopRestartIsSafe ? [{ command: 'docker', args: ['desktop', 'restart'] }] : [],
    allowManualFallback: true
  };
}

export function resolveDaemonConfigTarget(environment?: DaemonEnvironment): DaemonConfigTarget {
  const resolved = environment ?? detectDaemonEnvironment();
  const override = readOverride(DAEMON_PATH_OVERRIDE_ENV);

  if (override) {
    return {
      path: path.resolve(override),
      source: 'override',
      host: resolved.host,
      requiresPrivilege: false
    };
  }

  return {
    path: platformDaemonPath(resolved),
    source: 'platform',
    host: resolved.host,
    requiresPrivilege: resolved.host === 'linux-engine'
  };
}

/**
 * Whether two recorded daemon paths name the same file.
 *
 * A byte comparison is wrong on Windows, where `C:/x/daemon.json` and
 * `C:\x\daemon.json` are the same file and differ only in how someone typed
 * them. Getting this wrong is expensive in one direction in particular: the
 * mismatch check is what makes `dns disable` refuse to act, so a false mismatch
 * refuses to remove an entry that really is ours, and prints two paths the user
 * will read as identical.
 *
 * Case is folded only on Windows. macOS filesystems are usually case-insensitive
 * too, but "usually" is not something to build a refusal on, and being strict
 * there costs nothing that has ever been observed.
 */
export function sameDaemonPath(left: string, right: string): boolean {
  const normalise = (value: string): string => {
    const resolved = path.resolve(value);
    return osDetector.platform() === 'win32' ? resolved.toLowerCase() : resolved;
  };

  return normalise(left) === normalise(right);
}

export function resolveDockerRestartPlan(
  environment?: DaemonEnvironment,
  options: RestartPlanOptions = {}
): DockerRestartPlan {
  const resolved = environment ?? detectDaemonEnvironment();
  const override = readOverride(RESTART_CMD_OVERRIDE_ENV);

  if (override) {
    return {
      source: 'override',
      steps: [parseRestartCommand(override)],
      allowManualFallback: false,
      host: resolved.host,
      raw: override
    };
  }

  return { source: 'platform', ...platformRestartPlan(resolved, options) };
}

/** What `dns status` and `doctor` must report prominently (spec 7.4). */
export function activeOverrides(): ActiveOverride[] {
  return [DAEMON_PATH_OVERRIDE_ENV, RESTART_CMD_OVERRIDE_ENV]
    .map((variable) => ({ variable, value: readOverride(variable) }))
    .filter((entry): entry is ActiveOverride => entry.value !== undefined);
}
