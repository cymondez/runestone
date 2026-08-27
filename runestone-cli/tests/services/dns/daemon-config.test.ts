import * as fs from 'fs';
import * as path from 'path';
import {
  OwnedEntry,
  assertDaemonConfig,
  identifyOwnedEntries,
  insertOwnedEntries,
  moveOwnedEntriesToFront,
  ownedEntriesAtFront,
  readDnsArray,
  reconcileOwnedEntries,
  removeOwnedEntries
} from '../../../src/services/dns/daemon-config';

const TARGET = '192.168.65.254';
const FALLBACK = '1.1.1.1';

/** What Docker Desktop actually writes, including a nested inline object. */
const DESKTOP = `{
  "builder": {
    "gc": {
      "defaultKeepStorage": "20GB",
      "enabled": true
    }
  },
  "experimental": false
}
`;

const WITH_DNS = `{
  "dns": [
    "192.168.1.1",
    "8.8.8.8"
  ],
  "experimental": false
}
`;

const INLINE = '{"experimental": false, "dns": ["8.8.8.8"]}';
const INLINE_NO_DNS = '{"experimental": false}';
const TABS = '{\n\t"dns": [\n\t\t"8.8.8.8"\n\t]\n}\n';
const EMPTY_OBJECT = '{}';
const EMPTY_ARRAY = '{\n  "dns": []\n}\n';
const CRLF = '{\r\n  "experimental": false\r\n}\r\n';

function values(text: string): string[] {
  return readDnsArray(text).values as string[];
}

function targetOnly(): Array<{ role: 'target'; value: string }> {
  return [{ role: 'target', value: TARGET }];
}

function withFallback(): Array<{ role: 'target' | 'fallback'; value: string }> {
  return [
    { role: 'target', value: TARGET },
    { role: 'fallback', value: FALLBACK }
  ];
}

/** Rewrites the whole file the way a user editing by hand would. */
function daemonWithDns(dns: string[]): string {
  const rendered =
    dns.length === 0 ? '[]' : `[\n${dns.map((value) => `    ${JSON.stringify(value)}`).join(',\n')}\n  ]`;
  return `{\n  "dns": ${rendered},\n  "experimental": false\n}\n`;
}

describe('daemon dns ownership engine', () => {
  it('cannot restart Docker or touch a file, whatever the caller asks for', () => {
    // Spec 9.6: automatic reordering must never restart Docker on its own, since
    // `up` is a routine command and a restart terminates every container on the
    // machine. The engine having no way to do either is stronger than a test that
    // asserts it did not happen this time.
    const sources = ['daemon-config.ts', 'json-edit.ts'].map((file) =>
      fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'services', 'dns', file), 'utf8')
    );

    for (const source of sources) {
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/child_process|spawn|require\(|from '(fs|path|os)'/);
    }
  });

  describe('9.1 insertion', () => {
    it('creates the dns key when there is none, leaving every other key byte-identical', () => {
      const result = insertOwnedEntries(DESKTOP, targetOnly());

      expect(result.createdDnsKey).toBe(true);
      expect(result.entries).toEqual([{ role: 'target', value: TARGET, index: 0 }]);
      expect(values(result.text)).toEqual([TARGET]);
      expect(result.text).toContain('"defaultKeepStorage": "20GB",\n      "enabled": true');
      expect(result.text.slice(0, result.text.indexOf('"dns"'))).toBe(
        DESKTOP.slice(0, DESKTOP.indexOf('"experimental": false') + '"experimental": false'.length) + ',\n  '
      );
    });

    it('inserts at the front of an existing array without touching the existing items', () => {
      const result = insertOwnedEntries(WITH_DNS, targetOnly());

      expect(result.createdDnsKey).toBe(false);
      expect(values(result.text)).toEqual([TARGET, '192.168.1.1', '8.8.8.8']);
      expect(result.text).toContain('    "192.168.1.1",\n    "8.8.8.8"');
    });

    it('inserts the 9.7 fallback immediately after the target, with its own role', () => {
      const result = insertOwnedEntries(WITH_DNS, withFallback());

      expect(values(result.text)).toEqual([TARGET, FALLBACK, '192.168.1.1', '8.8.8.8']);
      expect(result.entries).toEqual([
        { role: 'target', value: TARGET, index: 0 },
        { role: 'fallback', value: FALLBACK, index: 1 }
      ]);
    });

    it('does not deduplicate when the same target IP is already there, and reports it', () => {
      const existing = daemonWithDns(['8.8.8.8', TARGET]);

      const result = insertOwnedEntries(existing, targetOnly());

      expect(result.duplicates).toEqual([TARGET]);
      expect(values(result.text)).toEqual([TARGET, '8.8.8.8', TARGET]);
    });

    it('fills an existing empty array', () => {
      const result = insertOwnedEntries(EMPTY_ARRAY, targetOnly());

      expect(result.createdDnsKey).toBe(false);
      expect(values(result.text)).toEqual([TARGET]);
    });

    it('inserts inline when the document is inline', () => {
      expect(insertOwnedEntries(INLINE, targetOnly()).text).toBe(
        `{"experimental": false, "dns": ["${TARGET}", "8.8.8.8"]}`
      );
      expect(insertOwnedEntries(INLINE_NO_DNS, targetOnly()).text).toBe(
        `{"experimental": false, "dns": ["${TARGET}"]}`
      );
    });

    it('refuses to insert nothing', () => {
      expect(() => insertOwnedEntries(DESKTOP, [])).toThrow('At least one owned entry');
    });

    it('aborts on invalid JSON rather than writing', () => {
      expect(() => insertOwnedEntries('{"dns": [', targetOnly())).toThrow('not valid JSON');
      expect(() => assertDaemonConfig('[]')).toThrow('must be a JSON object');
      expect(() => readDnsArray('{"dns": "8.8.8.8"}')).toThrow('is not an array');
    });
  });

  describe('write fidelity', () => {
    it.each([
      ['Docker Desktop multiline', DESKTOP],
      ['existing dns array', WITH_DNS],
      ['inline object', INLINE],
      ['inline object without dns', INLINE_NO_DNS],
      ['tab indented', TABS],
      ['empty object', EMPTY_OBJECT],
      ['empty array', EMPTY_ARRAY],
      ['no trailing newline', DESKTOP.trimEnd()],
      ['CRLF', CRLF]
    ])('enable then disable leaves %s byte-identical', (_label, original) => {
      const inserted = insertOwnedEntries(original, targetOnly());
      const removed = removeOwnedEntries(inserted.text, inserted.entries, {
        createdDnsKey: inserted.createdDnsKey
      });

      expect(removed.conflicts).toEqual([]);
      expect(removed.text).toBe(original);
    });

    it('keeps the document indentation style when creating the key', () => {
      const tabbedWithoutDns = '{\n\t"experimental": false\n}\n';

      expect(insertOwnedEntries(tabbedWithoutDns, targetOnly()).text).toBe(
        `{\n\t"experimental": false,\n\t"dns": ["${TARGET}"]\n}\n`
      );
    });

    it('keeps the CRLF newline style when creating the key', () => {
      expect(insertOwnedEntries(CRLF, targetOnly()).text).toBe(
        `{\r\n  "experimental": false,\r\n  "dns": ["${TARGET}"]\r\n}\r\n`
      );
    });

    it('never reorders unrelated keys', () => {
      const result = insertOwnedEntries(DESKTOP, targetOnly());

      expect(Object.keys(assertDaemonConfig(result.text))).toEqual(['builder', 'experimental', 'dns']);
    });
  });

  describe('9.5 user edits made while enabled', () => {
    function enable(original: string, entries = targetOnly()) {
      const inserted = insertOwnedEntries(original, entries);
      return { text: inserted.text, entries: inserted.entries, createdDnsKey: inserted.createdDnsKey };
    }

    it('preserves entries the user added after ours', () => {
      const enabled = enable(WITH_DNS);
      const edited = daemonWithDns([...values(enabled.text), '9.9.9.9']);

      const removed = removeOwnedEntries(edited, enabled.entries);

      expect(values(removed.text)).toEqual(['192.168.1.1', '8.8.8.8', '9.9.9.9']);
    });

    it('identifies us after the user inserted their own entry before ours, and removes only ours', () => {
      const enabled = enable(WITH_DNS);
      const edited = daemonWithDns(['10.0.0.1', ...values(enabled.text)]);

      const identifications = identifyOwnedEntries(edited, enabled.entries);
      expect(identifications[0]).toMatchObject({ status: 'matched', index: 1 });
      expect(ownedEntriesAtFront(identifications)).toBe(false);

      const removed = removeOwnedEntries(edited, enabled.entries);
      expect(values(removed.text)).toEqual(['10.0.0.1', '192.168.1.1', '8.8.8.8']);
    });

    it('keeps the user duplicate of the target IP when our recorded index still matches', () => {
      const enabled = enable(WITH_DNS);
      const edited = daemonWithDns([...values(enabled.text), TARGET]);

      const removed = removeOwnedEntries(edited, enabled.entries);

      expect(removed.conflicts).toEqual([]);
      expect(values(removed.text)).toEqual(['192.168.1.1', '8.8.8.8', TARGET]);
    });

    it('is an ownership conflict when the target IP is duplicated and we were pushed down', () => {
      const enabled = enable(WITH_DNS);
      const edited = daemonWithDns(['10.0.0.1', ...values(enabled.text), TARGET]);

      const removed = removeOwnedEntries(edited, enabled.entries);

      expect(removed.conflicts).toHaveLength(1);
      expect(removed.conflicts[0]).toMatchObject({ status: 'conflict', reason: 'multiple-matches', matches: [1, 4] });
      expect(removed.removed).toEqual([]);
      expect(removed.text).toBe(edited);
    });

    it('treats an entry the user removed by hand as already revoked, changing nothing', () => {
      const enabled = enable(WITH_DNS);
      const edited = daemonWithDns(values(enabled.text).filter((value) => value !== TARGET));

      const removed = removeOwnedEntries(edited, enabled.entries);

      expect(removed.alreadyRevoked).toEqual(enabled.entries);
      expect(removed.removed).toEqual([]);
      expect(removed.text).toBe(edited);
      expect(removed.conflicts).toEqual([]);
    });

    it('reports what replaced our entry when the user changed its value', () => {
      const enabled = enable(WITH_DNS);
      const edited = daemonWithDns(['10.0.0.9', '192.168.1.1', '8.8.8.8']);

      const identifications = identifyOwnedEntries(edited, enabled.entries);

      // Spec 9.5 rule 4: nothing matches our value, so it counts as removed by
      // the user. A changed value and a removed entry are observationally the
      // same thing, so the occupant of the recorded position is reported rather
      // than guessed at.
      expect(identifications[0]).toMatchObject({ status: 'removed', valueAtRecordedIndex: '10.0.0.9' });
      expect(removeOwnedEntries(edited, enabled.entries).text).toBe(edited);
    });

    it('keeps a dns key we created once the user has added their own entries to it', () => {
      const enabled = enable(DESKTOP);
      expect(enabled.createdDnsKey).toBe(true);
      const edited = enabled.text.replace(`["${TARGET}"]`, `["${TARGET}", "8.8.8.8"]`);

      const removed = removeOwnedEntries(edited, enabled.entries, { createdDnsKey: true });

      expect(removed.dnsKeyRemoved).toBe(false);
      expect(values(removed.text)).toEqual(['8.8.8.8']);
    });

    it('reports that the object is not empty once the user added other settings to a file we created', () => {
      const enabled = enable(EMPTY_OBJECT);
      const edited = enabled.text.replace('{\n', '{\n  "experimental": false,\n');

      const removed = removeOwnedEntries(edited, enabled.entries, { createdDnsKey: true });

      expect(removed.dnsKeyRemoved).toBe(true);
      expect(removed.objectEmpty).toBe(false);
      expect(removed.text).toBe('{\n  "experimental": false\n}');
    });

    it('reports an empty object when we created the file and nothing else was added', () => {
      const enabled = enable(EMPTY_OBJECT);

      const removed = removeOwnedEntries(enabled.text, enabled.entries, { createdDnsKey: true });

      expect(removed.objectEmpty).toBe(true);
      expect(removed.text).toBe(EMPTY_OBJECT);
    });

    it('still identifies our entry after the file was reformatted', () => {
      const enabled = enable(WITH_DNS);
      const reformatted = JSON.stringify(assertDaemonConfig(enabled.text), null, 4);

      const removed = removeOwnedEntries(reformatted, enabled.entries);

      expect(removed.removed).toEqual(enabled.entries);
      expect(values(removed.text)).toEqual(['192.168.1.1', '8.8.8.8']);
    });
  });

  describe('explicit assumptions from the user (spec 9.3)', () => {
    // `--assume-index` and `--assume-entry` need no engine support of their own:
    // both simply state the recorded entry the user asserts, and identification
    // rule 1 — the value at the recorded index — is checked first, so an explicit
    // statement always wins over the ambiguity that made it necessary.
    it('resolves a multiple-match conflict when the user names the index', () => {
      const conflicting = daemonWithDns(['10.0.0.1', TARGET, '8.8.8.8', TARGET]);

      const conflict = removeOwnedEntries(conflicting, [{ role: 'target', value: TARGET, index: 0 }]);
      expect(conflict.conflicts).toHaveLength(1);

      const assumed = removeOwnedEntries(conflicting, [{ role: 'target', value: TARGET, index: 3 }]);

      expect(assumed.conflicts).toEqual([]);
      expect(values(assumed.text)).toEqual(['10.0.0.1', TARGET, '8.8.8.8']);
    });

    it('revokes an entry whose value the user changed when they name the value', () => {
      const changed = daemonWithDns(['10.0.0.9', '8.8.8.8']);

      const assumed = removeOwnedEntries(changed, [{ role: 'target', value: '10.0.0.9', index: 0 }]);

      expect(assumed.removed).toHaveLength(1);
      expect(values(assumed.text)).toEqual(['8.8.8.8']);
    });
  });

  describe('9.6 automatic reordering', () => {
    const enabled = insertOwnedEntries(WITH_DNS, targetOnly());
    const pushedDown = daemonWithDns(['10.0.0.1', TARGET, '192.168.1.1', '8.8.8.8']);

    it('changes nothing at all when reordering is off', () => {
      const result = reconcileOwnedEntries(pushedDown, enabled.entries, { autoReorder: false });

      expect(result.changed).toBe(false);
      expect(result.reordered).toBe(false);
      expect(result.atFront).toBe(false);
      expect(result.text).toBe(pushedDown);
      expect(result.entries).toEqual(enabled.entries);
    });

    it('moves only our own entry when reordering is on', () => {
      const result = reconcileOwnedEntries(pushedDown, enabled.entries, { autoReorder: true });

      expect(result.reordered).toBe(true);
      expect(values(result.text)).toEqual([TARGET, '10.0.0.1', '192.168.1.1', '8.8.8.8']);
      expect(result.entries).toEqual([{ role: 'target', value: TARGET, index: 0 }]);
    });

    it('restores both owned entries to the front in role order', () => {
      const both = insertOwnedEntries(WITH_DNS, withFallback());
      const scrambled = daemonWithDns(['10.0.0.1', '192.168.1.1', TARGET, '8.8.8.8', FALLBACK]);

      const result = moveOwnedEntriesToFront(scrambled, both.entries);

      expect(values(result.text)).toEqual([TARGET, FALLBACK, '10.0.0.1', '192.168.1.1', '8.8.8.8']);
      expect(result.entries).toEqual(both.entries);
    });

    it('leaves the relative order of items we do not own untouched', () => {
      const scrambled = daemonWithDns(['a.a.a.a', 'b.b.b.b', TARGET, 'c.c.c.c']);

      const result = moveOwnedEntriesToFront(scrambled, enabled.entries);

      expect(values(result.text).filter((value) => value !== TARGET)).toEqual(['a.a.a.a', 'b.b.b.b', 'c.c.c.c']);
    });

    it('does nothing when our entry is already at the front', () => {
      const result = moveOwnedEntriesToFront(enabled.text, enabled.entries);

      expect(result.changed).toBe(false);
      expect(result.text).toBe(enabled.text);
    });

    it('is idempotent', () => {
      const once = moveOwnedEntriesToFront(pushedDown, enabled.entries);
      const twice = moveOwnedEntriesToFront(once.text, once.entries);

      expect(twice.changed).toBe(false);
      expect(twice.text).toBe(once.text);
    });

    it('refuses to reorder while an ownership conflict stands', () => {
      const conflicting = daemonWithDns(['10.0.0.1', TARGET, TARGET]);

      const result = moveOwnedEntriesToFront(conflicting, enabled.entries);

      expect(result.conflicts).toHaveLength(1);
      expect(result.changed).toBe(false);
      expect(result.text).toBe(conflicting);
    });
  });

  describe('9.7 optional fallback entry', () => {
    it('revokes both owned entries together', () => {
      const enabled = insertOwnedEntries(WITH_DNS, withFallback());

      const removed = removeOwnedEntries(enabled.text, enabled.entries);

      expect(removed.removed).toHaveLength(2);
      expect(values(removed.text)).toEqual(['192.168.1.1', '8.8.8.8']);
    });

    it('removes neither when one is identifiable and the other is in conflict', () => {
      const enabled = insertOwnedEntries(WITH_DNS, withFallback());
      const edited = daemonWithDns(['10.0.0.1', TARGET, FALLBACK, '192.168.1.1', FALLBACK]);

      const removed = removeOwnedEntries(edited, enabled.entries);

      expect(removed.conflicts).toHaveLength(1);
      expect(removed.conflicts[0].role).toBe('fallback');
      expect(removed.removed).toEqual([]);
      expect(removed.text).toBe(edited);
      expect(values(removed.text)).toContain(TARGET);
    });

    it('removes only the fallback when the fallback alone is turned off', () => {
      const enabled = insertOwnedEntries(WITH_DNS, withFallback());
      const fallbackEntry = enabled.entries.filter((entry) => entry.role === 'fallback');

      const removed = removeOwnedEntries(enabled.text, fallbackEntry);

      expect(removed.removed).toEqual(fallbackEntry);
      expect(values(removed.text)).toEqual([TARGET, '192.168.1.1', '8.8.8.8']);
    });
  });

  describe('re-entrancy', () => {
    it('reconciling an existing record never inserts a second entry of ours', () => {
      const enabled = insertOwnedEntries(WITH_DNS, withFallback());

      let text = enabled.text;
      let entries: OwnedEntry[] = enabled.entries;
      for (let run = 0; run < 3; run += 1) {
        const result = reconcileOwnedEntries(text, entries, { autoReorder: true });
        text = result.text;
        entries = result.entries;
      }

      expect(values(text)).toEqual([TARGET, FALLBACK, '192.168.1.1', '8.8.8.8']);
      expect(text).toBe(enabled.text);
    });
  });

  describe('invariant: entries we do not own are never disturbed', () => {
    // `expected` is written out by hand rather than derived from the engine, so
    // that the invariant is checked against an independent statement of what the
    // user's own array should look like afterwards.
    const edits: Array<{
      name: string;
      apply: (dns: string[]) => string[];
      expected: string[];
      conflict?: boolean;
    }> = [
      { name: 'no edit', apply: (dns) => dns, expected: ['user-a', 'user-b'] },
      { name: 'appended their own entry', apply: (dns) => [...dns, 'user-c'], expected: ['user-a', 'user-b', 'user-c'] },
      {
        name: 'inserted their own entry before ours',
        apply: (dns) => ['user-0', ...dns],
        expected: ['user-0', 'user-a', 'user-b']
      },
      {
        name: 'removed one of their own entries',
        apply: (dns) => dns.filter((value) => value !== 'user-b'),
        expected: ['user-a']
      },
      { name: 'reordered their own entries', apply: (dns) => [...dns].reverse(), expected: ['user-b', 'user-a'] },
      {
        name: 'removed our entry by hand',
        apply: (dns) => dns.filter((value) => value !== TARGET && value !== FALLBACK),
        expected: ['user-a', 'user-b']
      },
      {
        // Spec 9.5: our recorded index still matches, so only our entry goes and
        // the user's duplicate stays — it is theirs now.
        name: 'duplicated our target IP after ours',
        apply: (dns) => [...dns, TARGET],
        expected: ['user-a', 'user-b', TARGET]
      },
      {
        name: 'duplicated our target IP and pushed us down',
        apply: (dns) => ['user-0', ...dns, TARGET],
        expected: ['user-0', 'user-a', 'user-b'],
        conflict: true
      }
    ];

    for (const fallbackEnabled of [false, true]) {
      const owned = fallbackEnabled ? withFallback() : targetOnly();

      describe(`with the 9.7 fallback ${fallbackEnabled ? 'on' : 'off'}`, () => {
        it.each(edits.map((edit) => [edit.name, edit] as const))('survives: %s', (_name, edit) => {
          const before = daemonWithDns(['user-a', 'user-b']);
          const enabled = insertOwnedEntries(before, owned);
          const edited = daemonWithDns(edit.apply(values(enabled.text)));

          const removed = removeOwnedEntries(edited, enabled.entries, {
            createdDnsKey: enabled.createdDnsKey
          });

          const remaining = values(removed.text);
          const userItems = remaining.filter((value) => value.startsWith('user-'));

          // The values, the count and the relative order of entries we do not
          // own are unchanged.
          expect(userItems).toEqual(edit.expected.filter((value) => value.startsWith('user-')));

          if (edit.conflict) {
            // Nothing removed at all, so the user is never left holding half of
            // Runestone's changes (spec 9.7).
            expect(removed.conflicts.length).toBeGreaterThan(0);
            expect(removed.text).toBe(edited);
          } else {
            expect(removed.conflicts).toEqual([]);
            expect(remaining).toEqual(edit.expected);
          }
        });
      });
    }
  });
});
