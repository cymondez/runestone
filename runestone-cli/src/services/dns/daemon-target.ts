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

/** Where the daemon configuration lives and how Docker is restarted (spec 6.2). */
export type DaemonHost = 'docker-desktop' | 'wsl-docker-desktop' | 'linux-engine';

export type ResolutionSource = 'override' | 'platform';

export interface DaemonEnvironment {
  host: DaemonHost;
  /** Native home directory; used by the Docker Desktop hosts. */
  homeDir: string;
  /**
   * Windows-side home directory as seen from inside WSL, e.g.
   * `/mnt/c/Users/me`. Required by the `wsl-docker-desktop` host and not
   * determinable offline, so callers that can inspect the Docker context must
   * supply it.
   */
  windowsHomeDir?: string;
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

export function detectDaemonEnvironment(options?: { dockerDesktopEndpoint?: boolean }): DaemonEnvironment {
  const homeDir = osDetector.homeDir();
  const platform = osDetector.platform();

  if (platform === 'win32' || platform === 'darwin') {
    return { host: 'docker-desktop', homeDir };
  }

  // A native engine inside WSL keeps its configuration on the Linux side. The
  // caller must say so, because telling the two apart needs the Docker context.
  if (osDetector.isWsl() && options?.dockerDesktopEndpoint !== false) {
    return { host: 'wsl-docker-desktop', homeDir };
  }

  return { host: 'linux-engine', homeDir };
}

/** The platform default from spec 6.2, ignoring any override. */
export function platformDaemonPath(environment: DaemonEnvironment): string {
  switch (environment.host) {
    case 'docker-desktop':
      return path.join(environment.homeDir, '.docker', 'daemon.json');
    case 'wsl-docker-desktop':
      if (!environment.windowsHomeDir) {
        throw new Error(
          'Cannot determine the Windows-side Docker Desktop configuration path from inside WSL. ' +
            `Set ${DAEMON_PATH_OVERRIDE_ENV} to state it explicitly.`
        );
      }
      return path.posix.join(environment.windowsHomeDir, '.docker', 'daemon.json');
    case 'linux-engine':
      return '/etc/docker/daemon.json';
  }
}

/** The platform default from spec 6.2, ignoring any override. */
export function platformRestartPlan(environment: DaemonEnvironment): Omit<DockerRestartPlan, 'source' | 'raw'> {
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

  return {
    host: environment.host,
    steps: [{ command: 'docker', args: ['desktop', 'restart'] }],
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

export function resolveDockerRestartPlan(environment?: DaemonEnvironment): DockerRestartPlan {
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

  return { source: 'platform', ...platformRestartPlan(resolved) };
}

/** What `dns status` and `doctor` must report prominently (spec 7.4). */
export function activeOverrides(): ActiveOverride[] {
  return [DAEMON_PATH_OVERRIDE_ENV, RESTART_CMD_OVERRIDE_ENV]
    .map((variable) => ({ variable, value: readOverride(variable) }))
    .filter((entry): entry is ActiveOverride => entry.value !== undefined);
}
