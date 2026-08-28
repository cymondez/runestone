import * as fs from 'fs';
import * as path from 'path';
import { pathHelpers } from '../../utils/path-helpers';

/**
 * Serialises DNS operations (spec 9.3). Two `dns disable` runs racing each other
 * over the same daemon file would each read the array, each remove what it found,
 * and the second write would undo the first — or worse, remove an entry the first
 * had already accounted for.
 *
 * The lock is advisory and self-healing: a lock whose process is gone is stale
 * and is taken over, because a crashed run must not leave the feature permanently
 * unusable.
 */

export interface DnsLockContents {
  pid: number;
  command: string;
  startedAt: string;
}

export function dnsLockPath(): string {
  return path.join(pathHelpers.runestoneDir(), 'dns.lock');
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without delivering
    // anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readDnsLock(lockPath = dnsLockPath()): DnsLockContents | undefined {
  if (!fs.existsSync(lockPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<DnsLockContents>;
    if (typeof parsed.pid !== 'number') {
      return undefined;
    }

    return { pid: parsed.pid, command: String(parsed.command ?? ''), startedAt: String(parsed.startedAt ?? '') };
  } catch {
    // A lock we cannot read is a lock we cannot honour; treat it as absent
    // rather than blocking the user out of their own machine.
    return undefined;
  }
}

export class DnsLockHeldError extends Error {
  constructor(public readonly holder: DnsLockContents) {
    super(`Another Runestone DNS operation is already running (pid ${holder.pid}).`);
    this.name = 'DnsLockHeldError';
  }
}

/**
 * Runs `action` while holding the lock, and always releases it — including when
 * the action throws, which is exactly when a stuck lock would hurt most.
 */
export function withDnsLock<T>(command: string, action: () => T, lockPath = dnsLockPath()): T {
  const holder = readDnsLock(lockPath);
  if (holder && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
    throw new DnsLockHeldError(holder);
  }

  const contents: DnsLockContents = {
    pid: process.pid,
    command,
    startedAt: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');

  try {
    return action();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}
