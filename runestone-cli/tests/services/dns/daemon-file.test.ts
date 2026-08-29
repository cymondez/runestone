import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ElevationRunner,
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
  describe('the elevated write (spec 9.3)', () => {
    // On a native Linux engine `/etc/docker/daemon.json` belongs to root, so
    // the write goes through sudo. Verified against a directory this process
    // genuinely cannot write to, with the elevation itself faked: sudo would
    // make the suite depend on the machine it runs on.
    let readOnly: string;
    let target: string;
    let calls: Array<[string, string[]]>;

    const shell: ElevationRunner = (command, args) => {
      calls.push([command, args]);
      // Runs the same commands the real path runs, but as this user, against a
      // directory made writable again for the duration of the call.
      fs.chmodSync(readOnly, 0o755);
      try {
        switch (command) {
          case 'mkdir':
            fs.mkdirSync(args[1], { recursive: true });
            break;
          case 'cp':
            fs.copyFileSync(args[0], args[1]);
            break;
          case 'chmod':
            fs.chmodSync(args[1], parseInt(args[0], 8));
            break;
          case 'mv':
            fs.renameSync(args[1], args[2]);
            break;
          case 'rm':
            fs.rmSync(args[1], { force: true });
            break;
        }
      } finally {
        fs.chmodSync(readOnly, 0o555);
      }

      return { status: 0 };
    };

    beforeEach(() => {
      calls = [];
      readOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-root-'));
      target = path.join(readOnly, 'daemon.json');
      fs.chmodSync(readOnly, 0o555);
    });

    afterEach(() => {
      fs.chmodSync(readOnly, 0o755);
      fs.rmSync(readOnly, { recursive: true, force: true });
    });

    const unwritable = process.platform === 'win32' || process.getuid?.() === 0;
    const forNonRoot = unwritable ? it.skip : it;

    forNonRoot('installs the file through the runner and reads it back', () => {
      writeDaemonConfig(target, '{"dns":["172.17.0.1"]}\n', shell);

      expect(fs.readFileSync(target, 'utf8')).toBe('{"dns":["172.17.0.1"]}\n');
      // Staged as a second file and renamed over the target: the daemon never
      // sees a half-written configuration.
      // No mkdir: the directory is already there, and elevation is only asked
      // for what actually needs it.
      expect(calls.map(([command]) => command)).toEqual(['cp', 'chmod', 'mv']);
    });

    forNonRoot('aborts without a partial write when elevation is refused', () => {
      const refuse: ElevationRunner = (command, args) => {
        calls.push([command, args]);
        return command === 'rm' ? { status: 0 } : { status: 1, message: 'sudo: a password is required' };
      };

      expect(() => writeDaemonConfig(target, '{"dns":["172.17.0.1"]}\n', refuse)).toThrow('nothing was written');

      expect(fs.existsSync(target)).toBe(false);
      // And the staging file it may have left behind is cleaned up, so a second
      // attempt does not find debris next to the daemon configuration.
      expect(calls.some(([command]) => command === 'rm')).toBe(true);
      fs.chmodSync(readOnly, 0o755);
      expect(fs.readdirSync(readOnly)).toEqual([]);
    });

    forNonRoot('validates the content before asking for elevation at all', () => {
      expect(() => writeDaemonConfig(target, 'not json', shell)).toThrow();
      expect(calls).toEqual([]);
    });

    forNonRoot('removes a root-owned file through the runner', () => {
      writeDaemonConfig(target, '{}\n', shell);
      calls = [];

      deleteDaemonConfig(target, shell);

      expect(fs.existsSync(target)).toBe(false);
      expect(calls).toEqual([['rm', ['-f', target]]]);
    });

    it('does not call the runner when the file is writable anyway', () => {
      writeDaemonConfig(daemonPath, '{}\n', shell);
      deleteDaemonConfig(daemonPath, shell);

      expect(calls).toEqual([]);
    });
  });

});
