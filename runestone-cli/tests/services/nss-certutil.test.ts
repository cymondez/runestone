import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findNssDatabases,
  importRootCaToNssDatabases,
  rootCaPath
} from '../../src/services/nss-certutil';

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

describe('nss-certutil', () => {
  let tempDir: string;
  let originalXdgConfigHome: string | undefined;
  let originalXdgDataHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-nss-'));
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds XDG Firefox and Chromium NSS databases before falling back to home search', () => {
    touch(path.join(tempDir, '.config', 'mozilla', 'firefox', 'goz12bkw.default-release', 'cert9.db'));
    touch(path.join(tempDir, '.local', 'share', 'pki', 'nssdb', 'cert9.db'));

    expect(findNssDatabases(tempDir)).toEqual([
      {
        dir: path.join(tempDir, '.local', 'share', 'pki', 'nssdb'),
        version: 'cert9'
      },
      {
        dir: path.join(tempDir, '.config', 'mozilla', 'firefox', 'goz12bkw.default-release'),
        version: 'cert9'
      }
    ]);
  });

  it('searches the home directory when default locations do not contain NSS databases', () => {
    touch(path.join(tempDir, 'custom', 'browser-profile', 'cert8.db'));

    expect(findNssDatabases(tempDir)).toEqual([
      {
        dir: path.join(tempDir, 'custom', 'browser-profile'),
        version: 'cert8'
      }
    ]);
  });

  it('imports the root CA into cert9 databases with sql database syntax', () => {
    const cert9Dir = path.join(tempDir, '.local', 'share', 'pki', 'nssdb');
    const rootCa = path.join(tempDir, 'certs', 'rootCA.pem');
    touch(path.join(cert9Dir, 'cert9.db'));
    touch(rootCa);

    const calls: string[][] = [];
    const result = importRootCaToNssDatabases(rootCa, {
      certutilPath: '/bundled/certutil',
      homeDir: tempDir,
      runner: (_command, args) => {
        calls.push(args);
        return { status: 0, stderr: Buffer.from('') } as never;
      }
    });

    expect(result.imported.map((db) => db.dir)).toEqual([cert9Dir]);
    expect(calls).toEqual([
      ['-A', '-d', `sql:${cert9Dir}`, '-t', 'C,,', '-n', 'Runestone Local CA', '-i', rootCa]
    ]);
  });

  it('imports fallback cert8 databases without sql database syntax', () => {
    const cert8Dir = path.join(tempDir, 'fallback', 'profile');
    const rootCa = path.join(tempDir, 'certs', 'rootCA.pem');
    touch(path.join(cert8Dir, 'cert8.db'));
    touch(rootCa);

    const calls: string[][] = [];
    const result = importRootCaToNssDatabases(rootCa, {
      certutilPath: '/bundled/certutil',
      homeDir: tempDir,
      runner: (_command, args) => {
        calls.push(args);
        return { status: 0, stderr: Buffer.from('') } as never;
      }
    });

    expect(result.imported.map((db) => db.dir)).toEqual([cert8Dir]);
    expect(calls).toEqual([
      ['-A', '-d', cert8Dir, '-t', 'C,,', '-n', 'Runestone Local CA', '-i', rootCa]
    ]);
  });

  it('uses rootCA.pem before rootCA.crt', () => {
    const certsDir = path.join(tempDir, 'certs');
    fs.mkdirSync(certsDir, { recursive: true });
    fs.writeFileSync(path.join(certsDir, 'rootCA.crt'), 'crt');
    fs.writeFileSync(path.join(certsDir, 'rootCA.pem'), 'pem');

    expect(rootCaPath(tempDir)).toBe(path.join(certsDir, 'rootCA.pem'));
  });

});
