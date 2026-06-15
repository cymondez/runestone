import { spawnCommand } from '../utils/spawn';

export interface ExecOptions {
  tty?: boolean;
  user?: string;
  workingDir?: string;
  env?: Record<string, string>;
}

export const execService = {
  exec(containerName: string, command: string[], options?: ExecOptions): string {
    const args = ['exec'];
    if (options?.tty) {
      args.push('-t');
    }
    if (options?.user) {
      args.push('-u', options.user);
    }
    if (options?.workingDir) {
      args.push('-w', options.workingDir);
    }
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }
    args.push(containerName, ...command);

    const result = spawnCommand('docker', args, {
      encoding: 'utf8',
      timeout: 120000
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status === null) {
      throw new Error('docker command not found. Is Docker installed?');
    }
    if (result.status !== 0) {
      throw new Error(`docker exec failed for container '${containerName}': ${result.stderr?.trim() || 'unknown error'}`);
    }

    return result.stdout ?? '';
  }
};
