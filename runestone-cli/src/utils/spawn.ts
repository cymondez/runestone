import { spawnSync, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'child_process';

type StringSpawnOptions = SpawnSyncOptionsWithStringEncoding & {
  encoding: BufferEncoding;
};

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ');
}

function shouldRetryWithShell(error: unknown): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'ENOENT';
}

export function spawnCommand(
  command: string,
  args: string[],
  options: StringSpawnOptions
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    ...options,
    shell: false
  });

  if (!result.error || !shouldRetryWithShell(result.error)) {
    return result;
  }

  return spawnSync(shellCommand(command, args), {
    ...options,
    shell: true
  });
}
