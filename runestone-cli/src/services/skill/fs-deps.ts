/**
 * The impure half of the planner's inputs, kept in one small module so the
 * planner itself stays a pure function of what it was told.
 *
 * Reading is all this does. Writing arrives in its own milestone, so that the
 * step where Runestone first touches a directory belonging to the user is a
 * separate, revertible commit.
 */

import * as fs from 'fs';
import { PlanDependencies } from './plan';
import { nextBackupPath } from '../../utils/project-files';

export function planDependencies(): PlanDependencies {
  return {
    readText: (absolutePath) => {
      try {
        return fs.readFileSync(absolutePath, 'utf8');
      } catch {
        // Missing is the ordinary case and is not an error; anything else
        // (a directory, a permission problem) is reported by the write step,
        // which is the only place it can be acted on.
        return undefined;
      }
    },
    exists: (absolutePath) => fs.existsSync(absolutePath),
    backupPathFor: (absolutePath) => nextBackupPath(absolutePath)
  };
}
