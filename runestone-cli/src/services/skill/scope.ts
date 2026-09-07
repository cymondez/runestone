/**
 * Where to install, and which targets this directory actually wants.
 *
 * The word `project` is deliberately absent from every option name here.
 * `PROJECT_DIR` and `resolveProjectDir()` already mean `~/.runestone`
 * throughout this CLI, so a `--project` flag meaning "the user's repository"
 * would collide with the tool's own vocabulary at the exact point where being
 * wrong writes files into the wrong tree. The destination is a positional
 * argument, matching `certs create <domain>`, and user scope is one boolean.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TARGETS, TargetDefinition, findTarget, resolveTargetId } from './targets';

/**
 * Redirects the home root, for development and for tests that must not touch
 * the real `~/.claude`. Precedent: `RUNESTONE_TOOL_STATE_PATH`. Per the
 * override rule in `AGENTS.md`, `skill status` reports loudly when it is set —
 * an override that silently changes where files land is exactly the kind that
 * ruins an afternoon.
 */
export const SKILL_HOME_OVERRIDE = 'RUNESTONE_SKILL_HOME';

export function skillHome(): string {
  return process.env[SKILL_HOME_OVERRIDE]?.trim() || os.homedir();
}

export function activeSkillHomeOverride(): string | undefined {
  const value = process.env[SKILL_HOME_OVERRIDE]?.trim();
  return value ? value : undefined;
}

export type Scope = 'directory' | 'user';

export interface ResolvedScope {
  scope: Scope;
  /** Absolute. Everything a plan writes is relative to this. */
  root: string;
}

export class ScopeError extends Error {}

export function resolveScope(dir: string | undefined, user: boolean): ResolvedScope {
  if (user && dir) {
    throw new ScopeError('conflict');
  }

  if (user) {
    return { scope: 'user', root: skillHome() };
  }

  return { scope: 'directory', root: path.resolve(dir ?? process.cwd()) };
}

/**
 * Which runtimes are already in use here.
 *
 * Detection rather than "install everything" is what stops a Cursor-only
 * repository acquiring a stray `.claude/` directory it never asked for.
 */
export function detectTargets(root: string, exists: (p: string) => boolean = fs.existsSync): TargetDefinition[] {
  return TARGETS.filter((target) => target.detect.some((relative) => exists(path.join(root, relative))));
}

export class UnknownTargetError extends Error {}

export function resolveRequestedTargets(ids: string[]): TargetDefinition[] {
  return ids.map((id) => {
    const target = findTarget(resolveTargetId(id));
    if (!target) {
      throw new UnknownTargetError(id);
    }

    return target;
  });
}

/**
 * User scope supports only the targets with a real user-level path.
 *
 * Cursor's user rules live in application settings rather than in a file
 * Runestone could write, and no tool reads `~/AGENTS.md`, so silently
 * "succeeding" for those would leave the user with files nothing loads.
 */
export function targetsForScope(targets: TargetDefinition[], scope: Scope): {
  supported: TargetDefinition[];
  unsupported: TargetDefinition[];
} {
  if (scope === 'directory') {
    return { supported: targets, unsupported: [] };
  }

  return {
    supported: targets.filter((target) => target.userScope !== undefined),
    unsupported: targets.filter((target) => target.userScope === undefined)
  };
}
