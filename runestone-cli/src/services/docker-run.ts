import { spawnCommand } from '../utils/spawn';

export interface RunOptions {
  rm?: boolean;
  interactive?: boolean;
  tty?: boolean;
  user?: string;
  volumes?: Array<{ source: string; target: string; readonly?: boolean }>;
  volumesFrom?: string;
  name?: string;
  input?: string;
}

function buildArgs(options?: RunOptions): string[] {
  const args: string[] = [];
  if (options?.rm) {
    args.push('--rm');
  }
  if (options?.interactive) {
    args.push('-i');
  }
  if (options?.tty) {
    args.push('-t');
  }
  if (options?.user) {
    args.push('-u', options.user);
  }
  if (options?.volumes) {
    for (const volume of options.volumes) {
      const mode = volume.readonly ? ':ro' : '';
      args.push('-v', `${volume.source}:${volume.target}${mode}`);
    }
  }
  if (options?.volumesFrom) {
    args.push('--volumes-from', options.volumesFrom);
  }
  if (options?.name) {
    args.push('--name', options.name);
  }

  return args;
}

export const runService = {
  run(image: string, command: string[], options?: RunOptions): string {
    if (options?.tty) {
      throw new Error('TTY mode is not supported for automated container runs');
    }

    const args = ['run', ...buildArgs(options), image, ...command];
    const result = spawnCommand('docker', args, {
      input: options?.input,
      encoding: 'utf8',
      timeout: 300000
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status === null) {
      throw new Error('docker command not found. Is Docker installed?');
    }

    if (result.status !== 0) {
      throw new Error(`Docker run failed (exit ${result.status}): ${result.stderr?.trim() || 'unknown error'}`);
    }

    return result.stdout ?? '';
  }
};
