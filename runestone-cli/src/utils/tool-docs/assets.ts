/**
 * The only part of this module that touches the filesystem.
 *
 * The assets ship verbatim: `package.json`'s `files` already includes
 * `tool-docs/`, and `tsc` compiles `src/**` only, so the markdown is never
 * bundled or transformed. It is read at call time, which is why the path
 * depth below has to be right in `dist/` as well as in `src/` — the packaged
 * tarball is the only thing that can prove it, so a release gate does
 * (spec 14.3).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * From `dist/utils/tool-docs/assets.js` and from `src/utils/tool-docs/assets.ts`
 * alike, three levels up is the package root. The predecessor of this file sat
 * one level shallower and used two.
 */
export const TOPIC_ASSET_ROOT = path.resolve(__dirname, '..', '..', '..', 'tool-docs', 'ai-context');

export function readTopicAsset(id: string): string {
  return fs.readFileSync(path.join(TOPIC_ASSET_ROOT, `${id}.md`), 'utf8');
}

/** Asset basenames present on disk. For the bijection test, not for dispatch. */
export function listTopicAssets(): string[] {
  return fs.readdirSync(TOPIC_ASSET_ROOT)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.basename(name, '.md'))
    .sort();
}
