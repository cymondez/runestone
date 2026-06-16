import { SpawnSyncReturns } from 'child_process';
import { spawnCommand } from '../utils/spawn';

export interface DockerNetwork {
  Name: string;
  Id: string;
  Driver: string;
  Scope: string;
}

function runDocker(args: string[]): SpawnSyncReturns<string> {
  const result = spawnCommand('docker', args, {
    encoding: 'utf8',
    timeout: 30000
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status === null) {
    throw new Error('docker command not found. Is Docker installed?');
  }

  return result;
}

export const networkService = {
  createNetwork(name: string, driver = 'bridge'): void {
    const result = runDocker(['network', 'create', '--driver', driver, name]);
    if (result.status !== 0) {
      throw new Error(`Failed to create network '${name}': ${result.stderr?.trim() || 'unknown error'}`);
    }
  },

  exists(name: string): boolean {
    try {
      const result = runDocker(['network', 'inspect', name]);
      return result.status === 0 && Boolean(result.stdout?.trim());
    } catch {
      return false;
    }
  },

  removeNetwork(name: string): void {
    const result = runDocker(['network', 'rm', name]);
    if (result.status !== 0) {
      throw new Error(`Failed to remove network '${name}': ${result.stderr?.trim() || 'unknown error'}`);
    }
  },

  list(): DockerNetwork[] {
    const result = runDocker(['network', 'ls', '--no-trunc', '--format', '{{json .}}']);
    if (result.status !== 0) {
      throw new Error(`Failed to list networks: ${result.stderr?.trim() || 'unknown error'}`);
    }

    return (result.stdout ?? '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, string>)
      .map((item) => ({
        Name: item.Name ?? '',
        Id: item.ID ?? item.Id ?? '',
        Driver: item.Driver ?? '',
        Scope: item.Scope ?? ''
      }));
  }
};
