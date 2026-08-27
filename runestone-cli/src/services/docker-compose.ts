import { SpawnSyncReturns } from 'child_process';
import * as path from 'path';
import { spawnCommand } from '../utils/spawn';

/**
 * Service names as they appear in the generated compose file. Kept here so that
 * every scoped `docker compose` invocation names a service from one list rather
 * than an inline string literal.
 */
export const COMPOSE_SERVICES = {
  runestone: 'runestone'
} as const;

export type ComposeServiceName = (typeof COMPOSE_SERVICES)[keyof typeof COMPOSE_SERVICES];

export interface ComposeOptions {
  wait?: boolean;
  removeVolumes?: boolean;
  removeImages?: boolean;
  forceRecreate?: boolean;
  noDeps?: boolean;
}

export interface DockerContainer {
  Id: string;
  Name: string;
  State: string;
  Status: string;
  Service: string;
}

function composeArgs(composePath: string, args: string[]): string[] {
  const absolutePath = path.resolve(composePath);
  return ['compose', '--project-directory', path.dirname(absolutePath), '-f', absolutePath, ...args];
}

function runCompose(args: string[], composePath: string, timeout = 120000): SpawnSyncReturns<string> {
  const result = spawnCommand('docker', composeArgs(composePath, args), {
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
    throw new Error(`docker compose failed: ${result.stderr?.trim() || result.stdout?.trim() || 'unknown error'}`);
  }

  return result;
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

    runCompose(args, composePath);
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

  stop(composePath: string): void {
    runCompose(['stop'], composePath);
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
