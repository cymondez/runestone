import { SpawnSyncReturns } from 'child_process';
import { spawnCommand } from '../utils/spawn';

export interface DockerVolume {
  Name: string;
  Driver: string;
  Mountpoint: string;
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

export const volumeService = {
  createVolume(name: string): void {
    const result = runDocker(['volume', 'create', name]);
    if (result.status !== 0) {
      throw new Error(`Failed to create volume '${name}': ${result.stderr?.trim() || 'unknown error'}`);
    }
  },

  exists(name: string): boolean {
    try {
      const result = runDocker(['volume', 'inspect', name]);
      return result.status === 0 && Boolean(result.stdout?.trim());
    } catch {
      return false;
    }
  },

  removeVolume(name: string): void {
    const result = runDocker(['volume', 'rm', name]);
    if (result.status !== 0) {
      throw new Error(`Failed to remove volume '${name}': ${result.stderr?.trim() || 'unknown error'}`);
    }
  },

  list(): DockerVolume[] {
    const result = runDocker(['volume', 'ls', '--no-trunc', '--format', '{{json .}}']);
    if (result.status !== 0) {
      throw new Error(`Failed to list volumes: ${result.stderr?.trim() || 'unknown error'}`);
    }

    return (result.stdout ?? '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, string>)
      .map((item) => ({
        Name: item.Name ?? '',
        Driver: item.Driver ?? '',
        Mountpoint: item.Mountpoint ?? ''
      }));
  }
};
