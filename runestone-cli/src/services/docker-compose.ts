import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as path from 'path';

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
  const result = spawnSync('docker', composeArgs(composePath, args), {
    encoding: 'utf8',
    shell: process.platform === 'win32',
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

  restart(composePath: string): void {
    runCompose(['restart'], composePath);
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
