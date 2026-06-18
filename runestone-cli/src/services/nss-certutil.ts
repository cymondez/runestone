import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';

export interface NssDatabase {
  dir: string;
  version: 'cert8' | 'cert9';
}

export interface NssImportResult {
  certutilPath: string;
  imported: NssDatabase[];
  skipped: NssDatabase[];
}

type Runner = (
  command: string,
  args: string[],
  options: SpawnSyncOptions
) => SpawnSyncReturns<Buffer>;

export interface NssImportOptions {
  certutilPath?: string;
  homeDir?: string;
  runner?: Runner;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function existingDbAt(dir: string): NssDatabase | undefined {
  const cert9 = path.join(dir, 'cert9.db');
  if (fs.existsSync(cert9)) {
    return { dir, version: 'cert9' };
  }

  const cert8 = path.join(dir, 'cert8.db');
  if (fs.existsSync(cert8)) {
    return { dir, version: 'cert8' };
  }

  return undefined;
}

function defaultNssDirs(homeDir: string): string[] {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
  const firefoxProfileRoots = [
    path.join(homeDir, '.mozilla', 'firefox'),
    path.join(xdgConfigHome, 'mozilla', 'firefox'),
    path.join(homeDir, 'snap', 'firefox', 'common', '.mozilla', 'firefox')
  ];
  const firefoxProfiles = firefoxProfileRoots.flatMap((root) => {
    if (!fs.existsSync(root)) {
      return [];
    }

    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  });

  return [
    path.join(homeDir, '.pki', 'nssdb'),
    path.join(xdgDataHome, 'pki', 'nssdb'),
    path.join(homeDir, 'snap', 'chromium', 'current', '.pki', 'nssdb'),
    '/etc/pki/nssdb',
    ...firefoxProfiles
  ];
}

function searchHomeForNssDbs(homeDir: string): NssDatabase[] {
  const results: NssDatabase[] = [];
  const visited = new Set<string>();
  const queue = [homeDir];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    const db = existingDbAt(current);
    if (db) {
      results.push(db);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }

      queue.push(path.join(current, entry.name));
    }
  }

  return results;
}

export function findNssDatabases(homeDir = os.homedir()): NssDatabase[] {
  const defaults = defaultNssDirs(homeDir)
    .map((dir) => existingDbAt(dir))
    .filter((db): db is NssDatabase => Boolean(db));

  const found = defaults.length > 0 ? defaults : searchHomeForNssDbs(homeDir);
  const seen = new Set<string>();
  return found.filter((db) => {
    const key = `${db.version}:${path.resolve(db.dir)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function certutilSpawnOptions(): SpawnSyncOptions {
  return { env: process.env, stdio: 'pipe' };
}

function certutilDatabaseArg(db: NssDatabase): string {
  return db.version === 'cert9' ? `sql:${db.dir}` : db.dir;
}

export function importRootCaToNssDatabases(
  rootCaPath: string,
  options: NssImportOptions = {}
): NssImportResult {
  if (!fs.existsSync(rootCaPath)) {
    throw new Error(`Root CA file was not found: ${rootCaPath}`);
  }

  const certutilPath = options.certutilPath || 'certutil';
  const runner = options.runner || spawnSync;
  const databases = findNssDatabases(options.homeDir);
  if (databases.length === 0) {
    throw new Error('No Firefox or Chrome/Chromium NSS security databases were found.');
  }

  const imported: NssDatabase[] = [];
  const skipped: NssDatabase[] = [];
  for (const db of databases) {
    const args = [
      '-A',
      '-d',
      certutilDatabaseArg(db),
      '-t',
      'C,,',
      '-n',
      'Runestone Local CA',
      '-i',
      rootCaPath
    ];
    const result = runner(certutilPath, args, certutilSpawnOptions());
    if (result.status === 0) {
      imported.push(db);
      continue;
    }

    const stderr = result.stderr?.toString() ?? '';
    if (/SEC_ERROR_ADDING_CERT|already exists|exists/i.test(stderr)) {
      skipped.push(db);
      continue;
    }

    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (errorCode === 'ENOENT') {
      throw new Error(
        'NSS certutil was not found. Install libnss3-tools or run `runestone doctor` before installing browser certificates.'
      );
    }

    throw new Error(`Failed to import root CA into ${db.dir}: ${stderr || result.error?.message || 'unknown error'}`);
  }

  return { certutilPath, imported, skipped };
}

export function rootCaPath(projectDir: string): string {
  const certsDir = path.join(projectDir, 'certs');
  const candidates = unique([
    path.join(certsDir, 'rootCA.pem'),
    path.join(certsDir, 'rootCA.crt')
  ]);

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    throw new Error(`Root CA file was not found in ${certsDir}. Run setup or create a certificate first.`);
  }

  return existing;
}
