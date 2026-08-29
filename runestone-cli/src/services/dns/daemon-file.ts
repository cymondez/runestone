import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertDaemonConfig } from './daemon-config';
import { spawnCommand } from '../../utils/spawn';

/**
 * Reading and writing the daemon configuration file (spec 9.3).
 *
 * The write is atomic and self-checking: a temporary file in the same directory
 * is written, read back and re-parsed, and only then renamed over the original.
 * A partial or corrupt write therefore never becomes the daemon's configuration
 * — and if anything fails, the original file is left exactly as it was, because
 * it is not touched until the rename.
 *
 * **On a native Linux engine the file belongs to root**, so the same write goes
 * through `sudo` (spec 9.3). That path keeps both properties: the content is
 * validated before elevation is asked for, and the target is only ever replaced
 * by a rename inside its own directory, so a refused or failed `sudo` leaves the
 * original exactly as it was.
 */

const TEMP_SUFFIX = '.runestone-tmp';

let sequence = 0;

export interface ElevatedRun {
  status: number | null;
  message?: string;
}

/** Injected by the tests, so the elevated path can be exercised without root. */
export type ElevationRunner = (command: string, args: string[]) => ElevatedRun;

function sudo(command: string, args: string[]): ElevatedRun {
  // stdin and stderr are inherited so that `sudo` can ask for a password and
  // say why it refused. A machine with NOPASSWD never shows either.
  const result = spawnCommand('sudo', [command, ...args], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
    timeout: 120_000
  });

  return { status: result.status, message: result.error?.message };
}

/**
 * True when this process can replace the file without help: the directory takes
 * new entries, and an existing file can be overwritten.
 */
function writableDirectly(filePath: string): boolean {
  // The nearest directory that exists, not the immediate parent: a daemon
  // configuration whose directory has yet to be created is still an ordinary
  // write when the directory above it is ours.
  let directory = path.dirname(filePath);
  while (!fs.existsSync(directory)) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch {
    return false;
  }

  if (!fs.existsSync(filePath)) {
    return true;
  }

  try {
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function elevationAvailable(): boolean {
  return process.platform !== 'win32';
}

export interface DaemonConfigRead {
  /** The file's text, or `{}` when the file does not exist. */
  text: string;
  /** False when the file had to be invented, which spec 7.3 records as `createdDaemonFile`. */
  existed: boolean;
}

export function readDaemonConfig(filePath: string): DaemonConfigRead {
  if (!fs.existsSync(filePath)) {
    return { text: '{}', existed: false };
  }

  const text = fs.readFileSync(filePath, 'utf8');
  assertDaemonConfig(text);

  return { text, existed: true };
}

function tempPathFor(filePath: string): string {
  sequence += 1;
  return path.join(path.dirname(filePath), `${path.basename(filePath)}${TEMP_SUFFIX}-${process.pid}-${sequence}`);
}

export function writeDaemonConfig(filePath: string, text: string, run: ElevationRunner = sudo): void {
  // Refuse before creating anything, so an engine bug cannot leave a temporary
  // file behind next to the user's daemon configuration.
  assertDaemonConfig(text);

  if (!writableDirectly(filePath)) {
    if (!elevationAvailable()) {
      throw new Error(`Cannot write ${filePath}: no permission, and this platform has no elevation path.`);
    }

    writeElevated(filePath, text, run);
    return;
  }

  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode : undefined;
  const tempPath = tempPathFor(filePath);

  try {
    fs.writeFileSync(tempPath, text, 'utf8');
    assertDaemonConfig(fs.readFileSync(tempPath, 'utf8'));

    if (mode !== undefined) {
      try {
        fs.chmodSync(tempPath, mode);
      } catch {
        // Permission bits are not reproducible on every platform; the content is
        // what matters, so this must not fail the write.
      }
    }

    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * Spec 9.3, the elevated half. The content is written and validated as an
 * ordinary user first, so `sudo` is only ever asked to move a file that has
 * already been proved to be valid JSON. The move is a rename inside the target
 * directory, which is atomic; every failure before it leaves the original file
 * untouched, and the temporary it may have left behind is removed on the way
 * out — **spec 9.3's "elevation fails, abort, no partial write"**.
 */
function writeElevated(filePath: string, text: string, run: ElevationRunner): void {
  const staged = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-daemon-')), 'daemon.json');
  const landing = `${filePath}${TEMP_SUFFIX}-${process.pid}`;

  const step = (command: string, args: string[], what: string): void => {
    const outcome = run(command, args);
    if (outcome.status !== 0) {
      run('rm', ['-f', landing]);
      // No trailing full stop: the caller's message continues this sentence.
      throw new Error(
        `elevation was refused while trying to ${what}${outcome.message ? ` (${outcome.message})` : ''}; nothing was written`
      );
    }
  };

  try {
    fs.writeFileSync(staged, text, 'utf8');
    assertDaemonConfig(fs.readFileSync(staged, 'utf8'));

    // Only when it is actually missing. Asking sudo to create a directory that
    // is already there spends the elevation on a no-op and, when sudo refuses,
    // reports the wrong step as the one that failed.
    if (!fs.existsSync(path.dirname(filePath))) {
      step('mkdir', ['-p', path.dirname(filePath)], 'create the directory');
    }

    // Copied in as a second file, then renamed over the target: the daemon
    // never sees a half-written file, and a crash between the two leaves a
    // temporary rather than a broken configuration.
    step('cp', [staged, landing], 'stage the new file beside it');
    step('chmod', ['0644', landing], 'set the permissions');
    step('mv', ['-f', landing, filePath], 'move the new file into place');
  } finally {
    fs.rmSync(path.dirname(staged), { recursive: true, force: true });
  }

  const written = fs.readFileSync(filePath, 'utf8');
  if (written !== text) {
    throw new Error(`Wrote ${filePath}, but reading it back gave different content.`);
  }
}

/**
 * Spec 9.2 step 4: only ever called for a file Runestone created, and only when
 * nothing else is left in it.
 */
export function deleteDaemonConfig(filePath: string, run: ElevationRunner = sudo): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (writableDirectly(filePath)) {
    fs.rmSync(filePath, { force: true });
    return;
  }

  if (!elevationAvailable()) {
    throw new Error(`Cannot remove ${filePath}: no permission, and this platform has no elevation path.`);
  }

  const outcome = run('rm', ['-f', filePath]);
  if (outcome.status !== 0) {
    throw new Error(
      `Could not remove ${filePath} with elevated privileges${outcome.message ? `: ${outcome.message}` : ''}.`
    );
  }
}
