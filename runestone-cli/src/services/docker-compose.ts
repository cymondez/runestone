import { SpawnSyncReturns } from 'child_process';
import * as path from 'path';
import { spawnCommand } from '../utils/spawn';

/**
 * Service names as they appear in the generated compose file. Kept here so that
 * every scoped `docker compose` invocation names a service from one list rather
 * than an inline string literal.
 */
export const COMPOSE_SERVICES = {
  runestone: 'runestone',
  dns: 'dns'
} as const;

/**
 * The dns service sits behind this Compose profile, so it is invisible to any
 * command that does not name the profile (spec 8.2). That is what keeps the
 * feature off while it is being built.
 */
export const DNS_PROFILE = 'dns';

export type ComposeServiceName = (typeof COMPOSE_SERVICES)[keyof typeof COMPOSE_SERVICES];

export interface ComposeOptions {
  wait?: boolean;
  removeVolumes?: boolean;
  removeImages?: boolean;
  forceRecreate?: boolean;
  noDeps?: boolean;
  /** Compose profiles to activate; without one, a profiled service is invisible. */
  profiles?: string[];
  /** Limit the command to these services instead of the whole project. */
  services?: string[];
}

export interface DockerContainer {
  Id: string;
  Name: string;
  State: string;
  Status: string;
  Service: string;
}

function composeArgs(composePath: string, args: string[], profiles: string[] = []): string[] {
  const absolutePath = path.resolve(composePath);
  return [
    'compose',
    '--project-directory',
    path.dirname(absolutePath),
    '-f',
    absolutePath,
    ...profiles.flatMap((profile) => ['--profile', profile]),
    ...args
  ];
}

function runCompose(
  args: string[],
  composePath: string,
  timeout = 120000,
  profiles: string[] = []
): SpawnSyncReturns<string> {
  const result = spawnCommand('docker', composeArgs(composePath, args, profiles), {
    encoding: 'utf8',
    timeout
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status === null) {
    throw new Error('docker compose command not found. Is Docker installed?');
  }

  if (result.status !== 0) {
    throw new Error(`docker compose failed: ${composeFailure(result)}`);
  }

  return result;
}

/**
 * The part of a failed `docker compose` run worth showing a user.
 *
 * Compose draws its progress with carriage returns, so the raw stream is one
 * long line of "Container x Creating", "Container x Created" and so on, with
 * the real error at the end. Printed as it stands, the terminal replays those
 * overwrites and the **error is the one thing you cannot see**: the last write
 * wins, and it is a progress line. Measured against a real port conflict, which
 * reported itself to the user as "Container runestone-dns Creating" and told
 * them nothing at all.
 *
 * So the carriage returns become separators and the progress chatter is
 * dropped, leaving whatever actually went wrong.
 */
function composeFailure(result: SpawnSyncReturns<string>): string {
  const raw = [result.stderr ?? '', result.stdout ?? ''].join('\n');
  const lines = raw
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const progress =
    /^Container .+ (Creating|Created|Starting|Started|Stopping|Stopped|Removing|Removed|Recreate|Recreated|Waiting|Healthy)$/;
  const meaningful = lines.filter((line) => !progress.test(line));

  return meaningful.join(' ') || lines[lines.length - 1] || 'unknown error';
}

function normalizeContainer(input: Record<string, unknown>): DockerContainer {
  return {
    Id: String(input.ID ?? input.Id ?? ''),
    Name: String(input.Name ?? ''),
    State: String(input.State ?? ''),
    Status: String(input.Status ?? ''),
    Service: String(input.Service ?? '')
  };
}

function parsePsOutput(stdout: string): DockerContainer[] {
  const text = stdout.trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.map((item) => normalizeContainer(item as Record<string, unknown>));
  }

  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => normalizeContainer(JSON.parse(line) as Record<string, unknown>));
}

export const composeService = {
  up(composePath: string, options?: ComposeOptions): void {
    const args = ['up', '-d'];
    if (options?.wait) {
      args.push('--wait');
    }
    if (options?.forceRecreate) {
      args.push('--force-recreate');
    }
    if (options?.noDeps) {
      args.push('--no-deps');
    }
    if (options?.services) {
      args.push(...options.services);
    }

    runCompose(args, composePath, 120000, options?.profiles ?? []);
  },

  down(composePath: string, options?: ComposeOptions): void {
    const args = ['down', '--remove-orphans'];
    if (options?.removeVolumes) {
      args.push('--volumes');
    }
    if (options?.removeImages) {
      args.push('--rmi', 'all');
    }

    runCompose(args, composePath);
  },

  /**
   * Without a service list this stops the whole project, which is what `stop`
   * has always done. The list exists so that `stop` can leave the dns service
   * running: the Docker daemon points at it, so stopping it would break name
   * resolution for every container on the machine (spec 10.4).
   */
  stop(composePath: string, options?: ComposeOptions): void {
    runCompose(['stop', ...(options?.services ?? [])], composePath, 120000, options?.profiles ?? []);
  },

  /**
   * Restarts only the named services. The service list is mandatory: an
   * unscoped `docker compose restart` restarts every service in the project,
   * which would let an unrelated change interrupt long-lived services.
   */
  restart(composePath: string, services: string[]): void {
    if (services.length === 0) {
      throw new Error('composeService.restart requires at least one service name');
    }

    runCompose(['restart', ...services], composePath);
  },

  /**
   * Stops and removes the named services in one step. Used when revoking DNS:
   * the service has to go, and leaving a stopped container behind would keep
   * `status` reporting a service that is no longer meant to exist.
   */
  removeServices(composePath: string, services: string[], options?: { profiles?: string[] }): void {
    if (services.length === 0) {
      throw new Error('composeService.removeServices requires at least one service name');
    }

    runCompose(['rm', '--stop', '--force', ...services], composePath, 120000, options?.profiles ?? []);
  },

  ps(composePath: string): DockerContainer[] {
    const result = runCompose(['ps', '--format', 'json'], composePath, 30000);
    try {
      return parsePsOutput(result.stdout ?? '');
    } catch {
      throw new Error('Failed to parse docker compose ps output');
    }
  },

  pull(composePath: string): void {
    runCompose(['pull'], composePath);
  },

  logs(composePath: string, service?: string): void {
    const args = ['logs', '--follow'];
    if (service) {
      args.push(service);
    }

    runCompose(args, composePath, 0);
  }
};
