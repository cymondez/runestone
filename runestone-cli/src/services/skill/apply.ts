/**
 * Carrying out a plan. The only module here that writes.
 *
 * Two rules it exists to enforce:
 *
 * **Atomic.** Every write goes to a temporary file in the same directory and is
 * then renamed, following `dns/daemon-file.ts`. A half-written `SKILL.md` is a
 * worse outcome than a failed install, and a rename within one directory is the
 * only cheap way to rule it out.
 *
 * **Back up only when the bytes are about to change.** `updateComposeFile`
 * already establishes this: it returns early on an identical file *before* it
 * copies anything. So a repeated install creates no backup, and the user does
 * not accumulate `.bak`, `.bak2`, `.bak3` by running the command twice.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Plan, PlannedFile } from './plan';

export interface AppliedFile {
  absolutePath: string;
  action: PlannedFile['action'];
  backupPath?: string;
}

export interface ApplyResult {
  written: AppliedFile[];
  skipped: AppliedFile[];
  /** Directories removed because removal emptied them. */
  removedDirectories: string[];
}

function writeAtomic(absolutePath: string, content: string): void {
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });

  const temporary = path.join(directory, `.${path.basename(absolutePath)}.runestone-tmp`);
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, absolutePath);
}

function backupOnce(file: PlannedFile): string | undefined {
  if (!file.backupPath || !fs.existsSync(file.absolutePath)) {
    return undefined;
  }

  fs.copyFileSync(file.absolutePath, file.backupPath);
  return file.backupPath;
}

/**
 * True for the skill's own directory and anything under it.
 *
 * Everything above `<something>/runestone` — `.agents/skills`, `.agents`,
 * `.claude` — belongs to the runtime or to the user, not to Runestone, even
 * when emptying our files leaves it bare.
 */
function isWithinOwnSkillDirectory(directory: string): boolean {
  return directory.split(path.sep).includes('runestone');
}

export function applyInstall(plan: Plan): ApplyResult {
  const written: AppliedFile[] = [];
  const skipped: AppliedFile[] = [];

  for (const file of plan.files) {
    if (file.action === 'unchanged' || file.action === 'skip-modified') {
      skipped.push({ absolutePath: file.absolutePath, action: file.action });
      continue;
    }
    if (file.content === undefined) {
      skipped.push({ absolutePath: file.absolutePath, action: file.action });
      continue;
    }

    const backupPath = file.action === 'create' ? undefined : backupOnce(file);
    writeAtomic(file.absolutePath, file.content);
    written.push({ absolutePath: file.absolutePath, action: file.action, backupPath });
  }

  return { written, skipped, removedDirectories: [] };
}

/**
 * Remove only what Runestone put there.
 *
 * A whole-file backup is never restored, which is the same prohibition the DNS
 * specification places on `daemon.json` and for the same reason: restoring
 * would discard every unrelated edit made since.
 *
 * A directory is removed only when removal emptied it, and only one level at a
 * time. There is no recursive delete anywhere in this file: an unmarked file
 * left behind keeps its directory, and the caller reports which file that was.
 */
export function applyRemove(plan: Plan): ApplyResult {
  const written: AppliedFile[] = [];
  const skipped: AppliedFile[] = [];
  const removedDirectories: string[] = [];
  const candidateDirectories = new Set<string>();

  for (const file of plan.files) {
    if (file.action !== 'delete') {
      skipped.push({ absolutePath: file.absolutePath, action: file.action });
      continue;
    }

    if (!fs.existsSync(file.absolutePath)) {
      continue;
    }

    fs.rmSync(file.absolutePath, { force: true });
    written.push({ absolutePath: file.absolutePath, action: 'delete' });
    candidateDirectories.add(path.dirname(file.absolutePath));
  }

  // Deepest first, so `.../runestone/references` is considered before
  // `.../runestone`. Only empty directories go, never recursively, and never
  // above the skill's own directory.
  //
  // The floor matters more than it looks. Climbing freely would delete
  // `.agents/` or `.claude/` once emptied — directories the *user* created,
  // and the very ones target detection looks for. Removing one would silently
  // change what a later `skill install` decides to do.
  for (const directory of [...candidateDirectories].sort((a, b) => b.length - a.length)) {
    let current = directory;
    while (
      fs.existsSync(current) &&
      fs.readdirSync(current).length === 0 &&
      isWithinOwnSkillDirectory(current)
    ) {
      fs.rmdirSync(current);
      removedDirectories.push(current);
      current = path.dirname(current);
    }
  }

  return { written, skipped, removedDirectories };
}

/** Files under `root` that carry our marker but are not in `expected`. */
export function findOrphans(root: string, expected: string[], skillDirectories: string[]): string[] {
  const known = new Set(expected);
  const orphans: string[] = [];

  for (const relative of skillDirectories) {
    const directory = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(directory)) {
      continue;
    }

    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (known.has(full)) {
          continue;
        }

        // Only ours. A file the user dropped in beside the skill stays.
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('runestone:generated') || content.includes('runestone-skill-template')) {
          orphans.push(full);
        }
      }
    };

    walk(directory);
  }

  return orphans;
}
