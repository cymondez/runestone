import * as path from 'path';
import { RunestonePlatform, osDetector } from '../../utils/os-detector';
import { readDaemonInfo } from './environment';

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
 * **The platform does not decide this, in either direction.** Every platform can
 * be Docker Desktop and every platform can be a plain Docker Engine: Windows can
 * run docker-ce inside WSL2, macOS has Colima and Lima, Linux has Docker Desktop
 * for Linux. What the daemon is comes from the daemon; which filesystem holds
 * its configuration needs that plus where the CLI runs.
 *
 * `elsewhere` is the honest third answer: the daemon is real and reachable, but
 * its configuration is on a filesystem this process cannot name — a WSL distro
 * using Docker Desktop's integration, or a Windows/macOS CLI talking to an
 * engine inside somebody else's VM. Those are refused rather than guessed at,
 * and `RUNESTONE_DNS_DAEMON_PATH` (spec 7.4) is how a user who knows the answer
 * supplies it.
 */
export type DaemonHost = 'docker-desktop' | 'linux-engine' | 'elsewhere';

export interface DaemonClassification {
  /** What `docker info` reports: is this daemon Docker Desktop's? */
  daemonIsDockerDesktop: boolean;
  /** Where the CLI process itself runs. */
  platform: RunestonePlatform;
  /** Whether that Linux userland is a WSL distribution. */
  isWsl: boolean;
  homeDir: string;
}

/**
 * Spec 6.2's decision table, as a pure function. The five rows:
 *
 * | # | Desktop daemon | CLI on | result |
 * | --- | --- | --- | --- |
 * | 1 | yes | Windows / macOS | `docker-desktop` |
 * | 2 | yes | Linux, WSL | `elsewhere` — configuration is on the Windows side |
 * | 3 | yes | Linux, not WSL | `docker-desktop` — Docker Desktop for Linux |
 * | 4 | no | Linux | `linux-engine` |
 * | 5 | no | Windows / macOS | `elsewhere` — neither has a native engine |
 *
 * Row 5 is not pedantry: there is no native Docker Engine on Windows or macOS,
 * so a non-Desktop daemon reached from there lives in a VM or a distro, and
 * `/etc/docker/daemon.json` on *this* filesystem is not its configuration.
 */
export function classifyDaemonEnvironment(input: DaemonClassification): DaemonEnvironment {
  const { daemonIsDockerDesktop, platform, isWsl, homeDir } = input;
  const onLinux = platform === 'linux';

  if (daemonIsDockerDesktop) {
    return { host: onLinux && isWsl ? 'elsewhere' : 'docker-desktop', homeDir };
  }

  return { host: onLinux ? 'linux-engine' : 'elsewhere', homeDir };
}

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

/**
 * The classification for this machine, asking the daemon rather than assuming
 * from the platform.
 *
 * `daemon` is passed in by callers that have already run `docker info` — every
 * command's preflight does — so the common path costs no extra probe. When it
 * is absent the probe runs here, because the alternative is guessing, and a
 * guess here means writing to the wrong file.
 *
 * An unreachable daemon is treated as not-Desktop: nothing is written on that
 * path anyway, since preflight refuses on `docker-unavailable` first.
 */
export function detectDaemonEnvironment(daemon?: { isDockerDesktop: boolean }): DaemonEnvironment {
  const info = daemon ?? readDaemonInfo();

  return classifyDaemonEnvironment({
    daemonIsDockerDesktop: info?.isDockerDesktop ?? false,
    platform: osDetector.platform(),
    isWsl: osDetector.isWsl(),
    homeDir: osDetector.homeDir()
  });
}

/** The platform default from spec 6.2, ignoring any override. */
export function platformDaemonPath(environment: DaemonEnvironment): string {
  if (environment.host === 'docker-desktop') {
    return path.join(environment.homeDir, '.docker', 'daemon.json');
  }

  if (environment.host === 'linux-engine') {
    return '/etc/docker/daemon.json';
  }

  // **Empty on purpose.** There is no honest default for `elsewhere`, and the
  // one this used to return — this filesystem's `~/.docker/daemon.json`, or
  // `/etc/docker/daemon.json` — is a file that daemon never reads. Everything
  // that writes refuses on an empty path (see `daemon-file.ts`), and everything
  // that displays says so rather than printing a path nobody can use.
  return '';
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

  if (environment.host === 'elsewhere') {
    // Whatever restarts that daemon lives where that daemon lives. Handing the
    // step back is the same answer spec 6.2 already gives for Colima, OrbStack
    // and the rest: `RUNESTONE_DNS_RESTART_CMD` is where a user who knows the
    // command says so.
    return { host: environment.host, steps: [], allowManualFallback: true };
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
  // `path.resolve` follows the host's separator rules, but what is being
  // compared here is a path belonging to the platform the daemon lives on. On a
  // Linux host, `path.resolve` leaves a Windows path's backslashes untouched, so
  // two spellings of one file compare as two files. Choosing the flavour makes
  // the answer the same wherever the comparison runs — identical to today's
  // behaviour in production, where the two always agreed.
  const normalise = (value: string): string =>
    osDetector.platform() === 'win32'
      ? path.win32.resolve(value).toLowerCase()
      : path.posix.resolve(value);

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
