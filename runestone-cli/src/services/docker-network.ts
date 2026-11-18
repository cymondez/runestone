import { SpawnSyncReturns } from 'child_process';
import { spawnCommand } from '../utils/spawn';

export interface DockerNetwork {
  Name: string;
  Id: string;
  Driver: string;
  Scope: string;
}

/** A running container attached to a network, and the names Docker resolves it by there. */
export interface NetworkMember {
  container: string;
  /** `com.docker.compose.project`, or null for a container Compose did not start. */
  project: string | null;
  /** `com.docker.compose.service`, which Compose registers as an alias on every network the service joins. */
  service: string | null;
}

function runDocker(args: string[], timeout = 30000): SpawnSyncReturns<string> {
  const result = spawnCommand('docker', args, {
    encoding: 'utf8',
    timeout
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

  /**
   * Running containers on a network. One `docker ps` rather than a network
   * inspect plus a container inspect each: the Compose labels carry the service
   * name, which is the alias that collides.
   */
  members(name: string, timeoutMs = 30000): NetworkMember[] {
    const result = runDocker(
      [
        'ps',
        '--filter',
        `network=${name}`,
        '--format',
        '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}'
      ],
      timeoutMs
    );
    if (result.status !== 0) {
      throw new Error(`Failed to list containers on network '${name}': ${result.stderr?.trim() || 'unknown error'}`);
    }

    return (result.stdout ?? '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [container = '', project = '', service = ''] = line.split('\t');
        return { container, project: project || null, service: service || null };
      });
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
