import { spawnCommand } from '../utils/spawn';

function addressHasPort(address: string, port: number): boolean {
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[:.]${escapedPort}$`).test(address.trim());
}

export function isListeningLineForPort(line: string, port: number): boolean {
  const parts = line.trim().split(/\s+/);
  if (parts.length === 0) {
    return false;
  }

  const hasListeningState = parts.some((part) => /^LISTEN(?:ING)?$/i.test(part));
  if (!hasListeningState) {
    return false;
  }

  const upperFirst = parts[0].toUpperCase();
  const localAddress =
    upperFirst === 'LISTEN'
      ? parts[3]
      : /^TCP\d*$/i.test(parts[0]) || /^UDP\d*$/i.test(parts[0])
        ? parts[3]?.toUpperCase() === 'LISTEN' || parts[3]?.toUpperCase() === 'LISTENING'
          ? parts[1]
          : parts[3]
        : undefined;

  return Boolean(localAddress && addressHasPort(localAddress, port));
}

function netstatOutput(): string {
  const args = process.platform === 'win32' ? ['-ano'] : ['-an'];
  const result = spawnCommand('netstat', args, { encoding: 'utf8' });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'netstat failed');
  }

  return result.stdout ?? '';
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return !netstatOutput()
    .split(/\r?\n/)
    .some((line) => isListeningLineForPort(line, port));
}
