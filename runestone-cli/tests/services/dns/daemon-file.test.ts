import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deleteDaemonConfig,
  readDaemonConfig,
  writeDaemonConfig
} from '../../../src/services/dns/daemon-file';

/**
 * These tests use a temporary directory and never a platform daemon
 * configuration path. A temporary directory is unavoidable here: the point of
 * the write is its rename semantics, which cannot be proven without a
 * filesystem.
 */
describe('daemon configuration file', () => {
  let directory: string;
  let daemonPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-daemon-'));
    daemonPath = path.join(directory, 'daemon.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function leftovers(): string[] {
    return fs.readdirSync(directory).filter((entry) => entry !== 'daemon.json');
  }

  describe('reading', () => {
    it('reports an absent file as an empty object', () => {
      expect(readDaemonConfig(daemonPath)).toEqual({ text: '{}', existed: false });
    });

    it('returns the file text verbatim', () => {
      const text = '{\n\t"experimental": false\n}\n';
      fs.writeFileSync(daemonPath, text, 'utf8');

      expect(readDaemonConfig(daemonPath)).toEqual({ text, existed: true });
    });

    it('aborts on invalid JSON', () => {
      fs.writeFileSync(daemonPath, '{"dns": [', 'utf8');

      expect(() => readDaemonConfig(daemonPath)).toThrow('not valid JSON');
    });
  });

  describe('writing', () => {
    it('writes the text exactly, leaving no temporary file behind', () => {
      const text = '{\n  "dns": ["192.168.65.254"]\n}\n';

      writeDaemonConfig(daemonPath, text);

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(text);
      expect(leftovers()).toEqual([]);
    });

    it('creates the parent directory when it does not exist', () => {
      const nested = path.join(directory, 'docker', 'daemon.json');

      writeDaemonConfig(nested, '{}');

      expect(fs.readFileSync(nested, 'utf8')).toBe('{}');
    });

    it('refuses invalid JSON without creating anything', () => {
      expect(() => writeDaemonConfig(daemonPath, '{"dns": [')).toThrow('not valid JSON');
      expect(fs.existsSync(daemonPath)).toBe(false);
      expect(leftovers()).toEqual([]);
    });

    it('refuses a JSON value that is not an object', () => {
      expect(() => writeDaemonConfig(daemonPath, '[]')).toThrow('must be a JSON object');
      expect(fs.existsSync(daemonPath)).toBe(false);
    });

    it('removes the temporary file and leaves the destination alone when the rename fails', () => {
      // A directory in the destination's place is a rename the OS refuses, which
      // is the cheapest honest way to reach the failure path.
      fs.mkdirSync(daemonPath);
      fs.writeFileSync(path.join(daemonPath, 'occupied'), 'x', 'utf8');

      expect(() => writeDaemonConfig(daemonPath, '{"dns": ["1.1.1.1"]}')).toThrow();
      expect(fs.readdirSync(daemonPath)).toEqual(['occupied']);
      expect(leftovers()).toEqual([]);
    });

    it('overwrites an existing file in place', () => {
      fs.writeFileSync(daemonPath, '{"experimental": false}', 'utf8');

      writeDaemonConfig(daemonPath, '{"experimental": true}');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe('{"experimental": true}');
      expect(leftovers()).toEqual([]);
    });

    const posixOnly = process.platform === 'win32' ? it.skip : it;
    posixOnly('preserves the original file permissions', () => {
      fs.writeFileSync(daemonPath, '{}', 'utf8');
      fs.chmodSync(daemonPath, 0o640);

      writeDaemonConfig(daemonPath, '{"dns": ["1.1.1.1"]}');

      expect(fs.statSync(daemonPath).mode & 0o777).toBe(0o640);
    });
  });

  describe('deleting', () => {
    it('removes the file', () => {
      fs.writeFileSync(daemonPath, '{}', 'utf8');

      deleteDaemonConfig(daemonPath);

      expect(fs.existsSync(daemonPath)).toBe(false);
    });

    it('does not fail when the file is already gone', () => {
      expect(() => deleteDaemonConfig(daemonPath)).not.toThrow();
    });
  });
});
