import * as fs from 'fs';
import * as path from 'path';
import {
  identifyBlock,
  insertBlock,
  removeBlock,
  replaceBlock
} from '../../../src/services/skill/marker-block';
import { SKILL_TEMPLATE_VERSION, beginMarker, endMarker } from '../../../src/services/skill/version';

const V = SKILL_TEMPLATE_VERSION;

function withBlock(before: string, body: string, after: string, version = V): string {
  return `${before}${beginMarker(version)}\n${body}\n${endMarker()}${after}`;
}

describe('identifyBlock', () => {
  it('reports absent when there is no marker', () => {
    expect(identifyBlock('', V)).toEqual({ kind: 'absent' });
    expect(identifyBlock('# My rules\n\nSome prose.\n', V)).toEqual({ kind: 'absent' });
  });

  it('reports matched at the current version and reads the body back', () => {
    const status = identifyBlock(withBlock('', '## Runestone\nhello', '\n'), V);

    expect(status.kind).toBe('matched');
    if (status.kind === 'matched') {
      expect(status.span.version).toBe(V);
      expect(status.span.body).toContain('## Runestone');
    }
  });

  it('reports stale at an older version', () => {
    const status = identifyBlock(withBlock('', 'old body', '\n', V - 1), V);
    expect(status.kind).toBe('stale');
  });

  it('treats an unversioned marker as stale rather than current', () => {
    // A marker with no version predates versioning, so nothing can be assumed
    // about whether its body matches what the template produces now.
    const text = `<!-- runestone:begin -->\nbody\n${endMarker()}\n`;
    expect(identifyBlock(text, V).kind).toBe('stale');
  });

  it('refuses on two begin markers rather than guessing which is ours', () => {
    const text = withBlock('', 'a', '\n') + withBlock('', 'b', '\n');
    const status = identifyBlock(text, V);

    expect(status.kind).toBe('conflict');
    if (status.kind === 'conflict') {
      expect(status.offsets).toHaveLength(2);
    }
  });

  it('refuses on a begin with no end, because our extent is unknown', () => {
    const status = identifyBlock(`${beginMarker()}\nbody, and then nothing\n`, V);

    expect(status.kind).toBe('unterminated');
    if (status.kind === 'unterminated') {
      expect(status.offset).toBe(0);
    }
  });

  it('is not fooled by an unrelated HTML comment', () => {
    expect(identifyBlock('<!-- prettier-ignore -->\n<!-- TODO -->\n', V)).toEqual({ kind: 'absent' });
  });
});

describe('the invariant: the user content survives, the trailing newline is normalised', () => {
  // The guarantee, stated exactly, because the loose version ("nothing
  // changes") is untestable and the first draft of this engine quietly broke
  // it in two ways: removeBlock consumed two newlines where insertBlock had
  // added one, and a file with no trailing newline was not invertible at all.
  //
  // What holds: every byte of content survives, and the trailing newline run
  // becomes exactly one newline. Each shape below is a way a real file differs
  // from the one a developer happens to have open.
  const shapes: Array<[string, string]> = [
    ['an empty file', ''],
    ['no trailing newline', '# Rules\n\nLast line with no newline'],
    ['CRLF throughout', '# Rules\r\n\r\nWindows editor wrote this.\r\n'],
    ['tab indentation', '# Rules\n\n\t- tabbed item\n\t- another\n'],
    ["the user's own Runestone heading", '# Rules\n\n## Runestone\n\nHand-written by the user.\n'],
    ['an unrelated HTML comment', '# Rules\n\n<!-- keep this comment -->\n\nProse.\n'],
    ['trailing blank lines', '# Rules\n\nProse.\n\n\n'],
    ['a single newline', '\n']
  ];

  /** The original with its trailing newline run collapsed to one. */
  function normalised(original: string): string {
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const stripped = original.replace(/(?:\r?\n)+$/, '');
    return stripped.length === 0 ? '' : `${stripped}${newline}`;
  }

  it.each(shapes)('survives insert then remove: %s', (_label, original) => {
    const inserted = insertBlock(original, '## Runestone\n\nGenerated.', V);
    const status = identifyBlock(inserted, V);

    expect(status.kind).toBe('matched');
    if (status.kind !== 'matched') {
      return;
    }

    expect(removeBlock(inserted, status.span)).toBe(normalised(original));
  });

  it.each(shapes)('survives insert, replace, then remove: %s', (_label, original) => {
    const inserted = insertBlock(original, 'first body', V);
    const first = identifyBlock(inserted, V);
    expect(first.kind).toBe('matched');
    if (first.kind !== 'matched') {
      return;
    }

    const replaced = replaceBlock(inserted, first.span, 'a completely different body\nover two lines', V);
    const second = identifyBlock(replaced, V);
    expect(second.kind).toBe('matched');
    if (second.kind !== 'matched') {
      return;
    }

    expect(removeBlock(replaced, second.span)).toBe(normalised(original));
  });

  it('survives the user editing outside the block between install and update', () => {
    const original = '# Rules\n\nOne rule.\n';
    const inserted = insertBlock(original, 'FIRST-BODY', V);

    // The user appends their own text after our block, which is the realistic
    // case: our span is not necessarily last by the time we come back.
    const edited = `${inserted}\n## My own section\n\nAdded later.\n`;

    const status = identifyBlock(edited, V);
    expect(status.kind).toBe('matched');
    if (status.kind !== 'matched') {
      return;
    }

    const replaced = replaceBlock(edited, status.span, 'SECOND-BODY', V);

    // The user's text on both sides of our span is untouched...
    expect(replaced).toContain('## My own section');
    expect(replaced).toContain('One rule.');
    expect(replaced).toContain('Added later.');
    // ...and the old body is gone. The two bodies are deliberately not
    // substrings of each other: an earlier version of this test used
    // 'generated' and 'regenerated', so the "old body is gone" assertion
    // could never fail.
    expect(replaced).toContain('SECOND-BODY');
    expect(replaced).not.toContain('FIRST-BODY');
  });

  it('preserves CRLF in the block it writes, matching the file', () => {
    const inserted = insertBlock('# Rules\r\n', 'body\nover two lines', V);

    expect(inserted).toContain('\r\n');
    expect(inserted.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });

  it.each(shapes)('leaves the content as an exact prefix: %s', (_label, original) => {
    // The half of the guarantee that admits no normalisation: whatever the user
    // had is still there, byte for byte, at the front. Stated as a prefix
    // rather than a line walk because a line walk gets CRLF wrong — the last
    // content line legitimately regains its carriage return once there is more
    // file after it.
    expect(insertBlock(original, 'generated', V).startsWith(normalised(original))).toBe(true);
  });

  it.each(shapes)('round-trips exactly with the block in the middle of the file: %s', (_label, original) => {
    // Every other shape here puts the block at the end of the file, where the
    // seam normalisation in removeBlock hides an off-by-one: consuming one
    // newline too many still lands on a result that normalises back to the
    // same bytes.
    //
    // This is the case that cannot hide it. With the user's own text after our
    // span, eating an extra newline merges their last two lines, and the
    // equality below fails. Verified by reintroducing that exact bug and
    // watching only this test go red.
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    // The tail must use the file's own newline style, or the fixture itself
    // becomes mixed-ending and the test fails for a reason of its own making.
    const tail = ['## Their section', '', 'Text the user wrote after our block.', ''].join(newline);
    const base = original.replace(/(?:\r?\n)+$/, '');
    const before = base.length === 0 ? tail : `${base}${newline}${newline}${tail}`;

    const inserted = insertBlock(before, 'generated', V);
    // Put our span in the middle by appending the user's tail after it.
    const middled = `${inserted}${newline}${tail}`;

    const status = identifyBlock(middled, V);
    expect(status.kind).toBe('matched');
    if (status.kind !== 'matched') {
      return;
    }

    expect(removeBlock(middled, status.span)).toBe(normalised(`${before}${newline}${tail}`));
  });

  it('does not accumulate blank lines across repeated cycles', () => {
    let text = '# Rules\n\nProse.\n';
    for (let cycle = 0; cycle < 3; cycle += 1) {
      text = insertBlock(text, 'body', V);
      const status = identifyBlock(text, V);
      expect(status.kind).toBe('matched');
      if (status.kind !== 'matched') {
        return;
      }
      text = removeBlock(text, status.span);
    }

    expect(text).toBe('# Rules\n\nProse.\n');
  });
});

describe("this repository's own AGENTS.md", () => {
  // The realistic worst case, and the reason the invariant above is not a
  // theoretical exercise: a long hand-written file whose author would not
  // forgive a reformat.
  const fixture = fs.readFileSync(
    path.join(__dirname, '..', '..', 'fixtures', 'skill', 'agents-md.fixture.md'),
    'utf8'
  );

  it('is a substantial hand-written file, so the test is worth something', () => {
    expect(fixture.split('\n').length).toBeGreaterThan(70);
    expect(fixture).toContain('Interactive Prompt Rules');
  });

  it('comes back byte-identical after insert, replace and remove', () => {
    const inserted = insertBlock(fixture, '## Runestone\n\nGenerated guidance.', V);
    expect(inserted).toContain(fixture);

    const first = identifyBlock(inserted, V);
    expect(first.kind).toBe('matched');
    if (first.kind !== 'matched') {
      return;
    }

    const replaced = replaceBlock(inserted, first.span, '## Runestone\n\nUpdated guidance.', V);
    const second = identifyBlock(replaced, V);
    expect(second.kind).toBe('matched');
    if (second.kind !== 'matched') {
      return;
    }

    expect(removeBlock(replaced, second.span)).toBe(fixture);
  });

  it('leaves every one of its own lines untouched while the block is present', () => {
    const inserted = insertBlock(fixture, 'generated', V);
    const originalLines = fixture.split('\n');
    const insertedLines = inserted.split('\n');

    for (let i = 0; i < originalLines.length; i += 1) {
      expect(insertedLines[i]).toBe(originalLines[i]);
    }
  });
});

describe('the engine is pure', () => {
  it('touches no filesystem API', () => {
    // B1 is risk 0: the engine is text in, text out, so it cannot damage
    // anything and reverts in one commit. The impure layer arrives in B3.
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'services', 'skill', 'marker-block.ts'),
      'utf8'
    );

    expect(source).not.toMatch(/from 'fs'|require\('fs'\)/);
    expect(source).not.toMatch(/child_process|spawnSync|execSync/);
  });

  it('reuses the DNS engine text primitives rather than reimplementing them', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'services', 'skill', 'marker-block.ts'),
      'utf8'
    );

    expect(source).toContain("from '../dns/json-edit'");
  });
});
