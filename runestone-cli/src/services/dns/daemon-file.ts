import * as fs from 'fs';
import * as path from 'path';
import { assertDaemonConfig } from './daemon-config';

/**
 * Reading and writing the daemon configuration file (spec 9.3).
 *
 * The write is atomic and self-checking: a temporary file in the same directory
 * is written, read back and re-parsed, and only then renamed over the original.
 * A partial or corrupt write therefore never becomes the daemon's configuration
 * — and if anything fails, the original file is left exactly as it was, because
 * it is not touched until the rename.
 */

const TEMP_SUFFIX = '.runestone-tmp';

let sequence = 0;

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

export function writeDaemonConfig(filePath: string, text: string): void {
  // Refuse before creating anything, so an engine bug cannot leave a temporary
  // file behind next to the user's daemon configuration.
  assertDaemonConfig(text);

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
 * Spec 9.2 step 4: only ever called for a file Runestone created, and only when
 * nothing else is left in it.
 */
export function deleteDaemonConfig(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}
