import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DnsLockHeldError, readDnsLock, withDnsLock } from '../../../src/services/dns/lock';

describe('dns operation lock (spec 9.3)', () => {
  let directory: string;
  let lockPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-lock-'));
    lockPath = path.join(directory, 'dns.lock');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('holds the lock while the action runs and releases it afterwards', () => {
    const seen = withDnsLock('dns disable', () => readDnsLock(lockPath), lockPath);

    expect(seen).toMatchObject({ pid: process.pid, command: 'dns disable' });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('releases the lock even when the action throws', () => {
    expect(() =>
      withDnsLock(
        'dns disable',
        () => {
          throw new Error('write failed');
        },
        lockPath
      )
    ).toThrow('write failed');

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('refuses to run while another live process holds it', () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid + 0, command: 'dns enable', startedAt: 'now' }),
      'utf8'
    );

    // Same pid counts as ours, so use a pid that is alive but different: the
    // parent process, which is alive for as long as this test is.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.ppid, command: 'dns enable', startedAt: 'now' }),
      'utf8'
    );

    expect(() => withDnsLock('dns disable', () => 'ran', lockPath)).toThrow(DnsLockHeldError);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('takes over a lock whose process is gone, so a crash is not permanent', () => {
    // A pid that cannot exist: the maximum is far below this on every platform.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2147483646, command: 'dns enable', startedAt: 'yesterday' }),
      'utf8'
    );

    expect(withDnsLock('dns disable', () => 'ran', lockPath)).toBe('ran');
  });

  it('treats an unreadable lock as absent rather than locking the user out', () => {
    fs.writeFileSync(lockPath, 'not json at all', 'utf8');

    expect(readDnsLock(lockPath)).toBeUndefined();
    expect(withDnsLock('dns disable', () => 'ran', lockPath)).toBe('ran');
  });

  it('reports no lock when the file does not exist', () => {
    expect(readDnsLock(lockPath)).toBeUndefined();
  });

  it('re-enters when this same process already holds it', () => {
    const result = withDnsLock('dns disable', () => withDnsLock('dns disable', () => 'inner', lockPath), lockPath);

    expect(result).toBe('inner');
  });
});
