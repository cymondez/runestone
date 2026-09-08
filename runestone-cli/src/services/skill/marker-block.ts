/**
 * Owning one span inside a file that belongs to the user.
 *
 * Pure: no filesystem, no process. Every operation is a splice, following
 * `../dns/daemon-config.ts` for the same reason it does — bytes we do not own
 * are never re-rendered, so the user's indentation, line endings and ordering
 * survive untouched. Re-serialising the whole file would be a fraction of the
 * code and would quietly rewrite things nobody asked us to touch.
 *
 * `AGENTS.md` is the file this exists for. A user very likely already has one;
 * this repository's own runs to seventy-odd hand-written lines. Overwriting it is not an
 * option, so we take a marked span and leave the rest alone.
 */

import { detectNewline, splice } from '../dns/json-edit';
import { BLOCK_BEGIN, BLOCK_END, beginMarker, endMarker } from './version';

export interface BlockSpan {
  /** Offset of the first character of the begin marker. */
  start: number;
  /** Offset just past the end marker. */
  end: number;
  /** The version the begin marker declares, or undefined if unparseable. */
  version?: number;
  /** The text between the markers, excluding the markers themselves. */
  body: string;
}

export type BlockStatus =
  /** No marker at all. The file may or may not exist. */
  | { kind: 'absent' }
  /** Exactly one well-formed block, at the current version. */
  | { kind: 'matched'; span: BlockSpan }
  /** Exactly one well-formed block, at an older version. */
  | { kind: 'stale'; span: BlockSpan }
  /** More than one begin marker. Refuse; do not guess which is ours. */
  | { kind: 'conflict'; offsets: number[] }
  /** A begin with no end. Refuse; the extent of our span is unknown. */
  | { kind: 'unterminated'; offset: number };

const BEGIN_PATTERN = new RegExp(`<!--\\s*${BLOCK_BEGIN}(?:\\s+skill-template=(\\d+))?\\s*-->`, 'g');
const END_PATTERN = new RegExp(`<!--\\s*${BLOCK_END}\\s*-->`, 'g');

function allMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const scanner = new RegExp(pattern.source, pattern.flags);
  let match = scanner.exec(text);
  while (match) {
    matches.push(match);
    match = scanner.exec(text);
  }

  return matches;
}

/**
 * Classify what the file currently holds.
 *
 * `conflict` and `unterminated` are refusals rather than best-effort repairs,
 * mirroring `removeOwnedEntries`: leaving half of Runestone's changes in place
 * is worse than leaving all of them, and a file with two of our markers is a
 * file we no longer understand.
 */
export function identifyBlock(text: string, currentVersion: number): BlockStatus {
  const begins = allMatches(text, BEGIN_PATTERN);
  if (begins.length === 0) {
    return { kind: 'absent' };
  }
  if (begins.length > 1) {
    return { kind: 'conflict', offsets: begins.map((match) => match.index) };
  }

  const [begin] = begins;
  const ends = allMatches(text, END_PATTERN).filter((match) => match.index > begin.index);
  if (ends.length === 0) {
    return { kind: 'unterminated', offset: begin.index };
  }

  const [end] = ends;
  const bodyStart = begin.index + begin[0].length;
  const span: BlockSpan = {
    start: begin.index,
    end: end.index + end[0].length,
    version: begin[1] === undefined ? undefined : Number(begin[1]),
    body: text.slice(bodyStart, end.index)
  };

  // An unversioned marker counts as stale: it predates versioning, so it cannot
  // be assumed to match what the current template produces.
  return span.version === currentVersion ? { kind: 'matched', span } : { kind: 'stale', span };
}

function renderBlock(body: string, version: number, newline: string): string {
  const trimmed = body.replace(/^\n+|\n+$/g, '');
  return [beginMarker(version), ...trimmed.split('\n'), endMarker()].join(newline);
}

/**
 * The exact guarantee this engine provides, stated once because it is easy to
 * overclaim and the overclaim is what makes a test useless:
 *
 *   Every byte of the user's *content* survives insert, replace and remove.
 *   The file's trailing newline run is normalised to exactly one newline.
 *
 * The second clause is a real change and is not hidden. A file ending with no
 * newline gains one; a file ending with three blank lines comes back with none.
 * Nothing else moves — not indentation, not CRLF, not ordering, not a single
 * character before the last line.
 *
 * The alternative was to reproduce the original trailing whitespace exactly,
 * which needs the engine to remember what it replaced, and remembering is what
 * the marker model exists to avoid. Trailing newlines at the very end of the
 * file are the seam we are splicing at, not content: git, POSIX and every
 * editor's "insert final newline" setting already agree on one.
 */
function endWithSingleNewline(text: string, newline: string): string {
  const stripped = text.replace(/(?:\r?\n)+$/, '');
  return stripped.length === 0 ? '' : `${stripped}${newline}`;
}

/**
 * Append a block to a file that has none, separated by one blank line, and only
 * when there is something to separate from. The file's own newline style is
 * preserved rather than imposed.
 */
export function insertBlock(text: string, body: string, version: number): string {
  const newline = detectNewline(text);
  const block = renderBlock(body, version, newline);
  const base = endWithSingleNewline(text, newline);

  if (base.length === 0) {
    return `${block}${newline}`;
  }

  return `${base}${newline}${block}${newline}`;
}

/**
 * Replace the contents of an existing block, and nothing else.
 *
 * The one guarantee that matters: every byte outside `span` is passed through
 * untouched, including the trailing newline situation and any CRLF the user's
 * editor produced.
 */
export function replaceBlock(text: string, span: BlockSpan, body: string, version: number): string {
  const newline = detectNewline(text);
  return splice(text, span.start, span.end, renderBlock(body, version, newline));
}

/**
 * Remove the block, and exactly the newlines the block introduced.
 *
 * `insertBlock` adds a blank line before the marker, so removal takes it back;
 * without that, install-then-remove would leave a growing gap each cycle. It
 * takes back *only* that: taking a second newline would merge the user's last
 * two lines, which is exactly the bug the first draft of this function had and
 * which the mid-file invariant test exists to catch.
 */
export function removeBlock(text: string, span: BlockSpan): string {
  const newline = detectNewline(text);
  let start = span.start;
  let end = span.end;

  // The newline terminating the end marker's own line.
  if (text.startsWith(newline, end)) {
    end += newline.length;
  }

  // The single blank line `insertBlock` puts before the block. Exactly one —
  // taking a second would eat the newline that ends the user's last line.
  if (start >= newline.length && text.startsWith(newline, start - newline.length)) {
    start -= newline.length;
  }

  const result = splice(text, start, end, '');

  // Whatever followed our block stays; only the seam is normalised, per the
  // guarantee stated above.
  return endWithSingleNewline(result, newline);
}
