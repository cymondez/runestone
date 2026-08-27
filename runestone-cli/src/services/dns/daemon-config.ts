import { detectIndent, detectNewline, lineIndent, scanArray, scanObject, splice } from './json-edit';

/**
 * The daemon ownership model of spec 9, as pure functions over JSON text.
 *
 * The one rule everything here serves: **Runestone recognises only the entries
 * it inserted and recorded. Everything else belongs to the user** — including
 * entries the user added or changed after enabling. So no operation ever moves,
 * deduplicates, reformats or removes an item we do not own, and every operation
 * is a splice that copies the rest of the document through untouched.
 */

export type OwnedEntryRole = 'target' | 'fallback';

/** Owned entries always sit at the front of the array in this order (spec 9.1). */
export const OWNED_ROLE_ORDER: readonly OwnedEntryRole[] = ['target', 'fallback'];

export interface OwnedEntryInput {
  role: OwnedEntryRole;
  value: string;
}

export interface OwnedEntry extends OwnedEntryInput {
  /**
   * Last known position. Used **for identification only, never to restore a
   * position** (spec 7.3): revocation removes items and performs no positional
   * restoration.
   */
  index: number;
}

export type IdentificationStatus = 'matched' | 'removed' | 'conflict';

export interface Identification {
  role: OwnedEntryRole;
  value: string;
  recordedIndex: number;
  status: IdentificationStatus;
  /** Set when `status` is `matched`: where the entry actually is now. */
  index?: number;
  /** Set when `status` is `conflict`. */
  reason?: 'multiple-matches';
  /** Every position whose value equals ours. */
  matches: number[];
  /**
   * Set when `status` is `removed` and something else now occupies the recorded
   * position. Spec 9.5 rule 4 treats a missing value as removed by the user;
   * this is reported so the caller can say what it found instead.
   */
  valueAtRecordedIndex?: string;
}

export const DNS_KEY = 'dns';

function parseObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Daemon configuration is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Daemon configuration must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

/** Validates that the text is a JSON object, and returns the parsed form. */
export function assertDaemonConfig(text: string): Record<string, unknown> {
  return parseObject(text);
}

export interface DnsArrayView {
  /** Whether the `dns` key exists at all. */
  present: boolean;
  /** The array's items, in order. Non-string items are preserved as-is. */
  values: unknown[];
}

export function readDnsArray(text: string): DnsArrayView {
  const parsed = parseObject(text);
  if (!Object.prototype.hasOwnProperty.call(parsed, DNS_KEY)) {
    return { present: false, values: [] };
  }

  const value = parsed[DNS_KEY];
  if (!Array.isArray(value)) {
    throw new Error(`Daemon configuration key "${DNS_KEY}" is not an array`);
  }

  return { present: true, values: value };
}

function stringValues(text: string): Array<string | undefined> {
  return readDnsArray(text).values.map((value) => (typeof value === 'string' ? value : undefined));
}

function dnsKeyEntry(text: string): { valueStart: number } | undefined {
  const scan = scanObject(text, text.indexOf('{'));
  const entry = scan.keys.find((key) => key.name === DNS_KEY);
  return entry ? { valueStart: entry.valueStart } : undefined;
}

/**
 * Identification order of spec 9.5, applied independently per recorded entry:
 *
 * 1. the value at the recorded index still matches — that is the entry;
 * 2. otherwise exactly one item matches the value — that is the entry;
 * 3. several items match and the recorded index does not — ownership conflict,
 *    which the caller must resolve with an explicit `--assume-index`;
 * 4. nothing matches — treat it as removed by the user.
 */
export function identifyOwnedEntries(text: string, recorded: OwnedEntry[]): Identification[] {
  const values = stringValues(text);

  return recorded.map((entry) => {
    const matches = values.reduce<number[]>((found, value, index) => {
      if (value === entry.value) {
        found.push(index);
      }
      return found;
    }, []);

    const base = { role: entry.role, value: entry.value, recordedIndex: entry.index, matches };

    if (values[entry.index] === entry.value) {
      return { ...base, status: 'matched' as const, index: entry.index };
    }

    if (matches.length === 1) {
      return { ...base, status: 'matched' as const, index: matches[0] };
    }

    if (matches.length > 1) {
      return { ...base, status: 'conflict' as const, reason: 'multiple-matches' as const };
    }

    const occupant = values[entry.index];
    return {
      ...base,
      status: 'removed' as const,
      ...(occupant === undefined ? {} : { valueAtRecordedIndex: occupant })
    };
  });
}

/**
 * Whether our entries still occupy the front of the array in role order, which
 * is what makes the Runestone DNS the resolver that is actually consulted first
 * (spec 9.6).
 */
export function ownedEntriesAtFront(identifications: Identification[]): boolean {
  return identifications.every((identification, position) => identification.index === position);
}

function insertItemsAtFront(text: string, values: string[]): string {
  const entry = dnsKeyEntry(text);
  if (!entry) {
    throw new Error(`Daemon configuration has no "${DNS_KEY}" key to insert into`);
  }

  const array = scanArray(text, entry.valueStart);
  const rendered = values.map((value) => JSON.stringify(value));

  if (array.items.length === 0) {
    return splice(text, array.bodyStart, array.bodyEnd, rendered.join(', '));
  }

  const prefix = text.slice(array.bodyStart, array.items[0].start);
  const gap = prefix.includes('\n') ? '' : ' ';
  const chunk = rendered.map((value) => `${prefix}${value},${gap}`).join('');

  return splice(text, array.bodyStart, array.bodyStart, chunk);
}

function removeItemAt(text: string, itemIndex: number): string {
  const entry = dnsKeyEntry(text);
  if (!entry) {
    throw new Error(`Daemon configuration has no "${DNS_KEY}" key to remove from`);
  }

  const array = scanArray(text, entry.valueStart);
  const items = array.items;
  const item = items[itemIndex];
  if (!item) {
    throw new Error(`Daemon configuration has no "${DNS_KEY}" item at index ${itemIndex}`);
  }

  if (items.length === 1) {
    return splice(text, array.bodyStart, array.bodyEnd, '');
  }

  if (itemIndex < items.length - 1) {
    return splice(text, item.start, items[itemIndex + 1].start, '');
  }

  return splice(text, items[itemIndex - 1].end, item.end, '');
}

function createDnsKey(text: string, values: string[]): string {
  const arrayText = `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
  const objectStart = text.indexOf('{');
  if (objectStart === -1) {
    throw new Error('Daemon configuration must be a JSON object');
  }

  const scan = scanObject(text, objectStart);
  const multiline = text.slice(scan.bodyStart, scan.bodyEnd).includes('\n');

  const newline = detectNewline(text);

  if (scan.keys.length === 0) {
    const indent = detectIndent(text);
    return splice(text, scan.bodyStart, scan.bodyEnd, `${newline}${indent}"${DNS_KEY}": ${arrayText}${newline}`);
  }

  const lastKey = scan.keys[scan.keys.length - 1];
  if (!multiline) {
    return splice(text, lastKey.valueEnd, lastKey.valueEnd, `, "${DNS_KEY}": ${arrayText}`);
  }

  const indent = lineIndent(text, lastKey.entryStart) || detectIndent(text);
  return splice(text, lastKey.valueEnd, lastKey.valueEnd, `,${newline}${indent}"${DNS_KEY}": ${arrayText}`);
}

function removeDnsKey(text: string): string {
  const objectStart = text.indexOf('{');
  const scan = scanObject(text, objectStart);
  const position = scan.keys.findIndex((key) => key.name === DNS_KEY);
  if (position === -1) {
    return text;
  }

  if (scan.keys.length === 1) {
    return splice(text, scan.bodyStart, scan.bodyEnd, '');
  }

  if (position < scan.keys.length - 1) {
    return splice(text, scan.keys[position].entryStart, scan.keys[position + 1].entryStart, '');
  }

  return splice(text, scan.keys[position - 1].valueEnd, scan.keys[position].valueEnd, '');
}

export interface InsertResult {
  text: string;
  entries: OwnedEntry[];
  createdDnsKey: boolean;
  /**
   * Values already present in the array before we inserted ours. **No
   * deduplication happens** (spec 9.1): the pre-existing item belongs to the
   * user or another tool, so moving or removing it would be interference. The
   * caller must disclose that it will remain after disabling.
   */
  duplicates: string[];
}

/**
 * Spec 9.1. Applies only to a first-time enable with no ownership record; when a
 * record exists the caller follows the reconciliation path in 9.5 instead, or it
 * would insert a second entry of our own.
 */
export function insertOwnedEntries(text: string, entries: OwnedEntryInput[]): InsertResult {
  if (entries.length === 0) {
    throw new Error('At least one owned entry is required');
  }

  const view = readDnsArray(text);
  const existing = stringValues(view.present ? text : '{"dns":[]}');
  const duplicates = entries.map((entry) => entry.value).filter((value) => existing.includes(value));
  const values = entries.map((entry) => entry.value);

  const nextText = view.present ? insertItemsAtFront(text, values) : createDnsKey(text, values);

  return {
    text: nextText,
    entries: entries.map((entry, index) => ({ ...entry, index })),
    createdDnsKey: !view.present,
    duplicates
  };
}

export interface RemoveResult {
  text: string;
  /** Entries actually spliced out. */
  removed: OwnedEntry[];
  /** Entries the user had already removed by hand (spec 9.5). */
  alreadyRevoked: OwnedEntry[];
  /**
   * Non-empty means **nothing was removed and `text` is unchanged**. Spec 9.7:
   * if one owned entry is identifiable and another is in conflict, remove
   * neither — the user must never be left holding half of Runestone's changes.
   */
  conflicts: Identification[];
  dnsKeyRemoved: boolean;
  /** Whether the whole object is now empty, which spec 9.2 step 4 acts on. */
  objectEmpty: boolean;
  identifications: Identification[];
}

/** Spec 9.2 steps 1 to 3, over every recorded entry at once. */
export function removeOwnedEntries(
  text: string,
  recorded: OwnedEntry[],
  options?: { createdDnsKey?: boolean }
): RemoveResult {
  const identifications = identifyOwnedEntries(text, recorded);
  const conflicts = identifications.filter((identification) => identification.status === 'conflict');

  const emptyResult = (nextText: string, dnsKeyRemoved: boolean): RemoveResult => ({
    text: nextText,
    removed: [],
    alreadyRevoked: [],
    conflicts,
    dnsKeyRemoved,
    objectEmpty: Object.keys(parseObject(nextText)).length === 0,
    identifications
  });

  if (conflicts.length > 0) {
    return emptyResult(text, false);
  }

  const matched = identifications
    .map((identification, position) => ({ identification, recorded: recorded[position] }))
    .filter((pair) => pair.identification.status === 'matched');

  const alreadyRevoked = identifications
    .map((identification, position) => ({ identification, recorded: recorded[position] }))
    .filter((pair) => pair.identification.status === 'removed')
    .map((pair) => pair.recorded);

  // Highest index first, so the positions of the remaining targets stay valid.
  const descending = [...matched].sort(
    (left, right) => (right.identification.index ?? 0) - (left.identification.index ?? 0)
  );

  let nextText = text;
  for (const pair of descending) {
    nextText = removeItemAt(nextText, pair.identification.index as number);
  }

  let dnsKeyRemoved = false;
  if (options?.createdDnsKey && readDnsArray(nextText).values.length === 0) {
    nextText = removeDnsKey(nextText);
    dnsKeyRemoved = true;
  }

  return {
    text: nextText,
    removed: matched.map((pair) => pair.recorded),
    alreadyRevoked,
    conflicts,
    dnsKeyRemoved,
    objectEmpty: Object.keys(parseObject(nextText)).length === 0,
    identifications
  };
}

export interface ReorderResult {
  text: string;
  entries: OwnedEntry[];
  changed: boolean;
  conflicts: Identification[];
  identifications: Identification[];
}

/**
 * Spec 9.6 `DNS_AUTO_REORDER=true`: move **only the entries we recorded** back to
 * the front in role order, leaving the relative order of everything else
 * untouched. The caller must not restart Docker for this — `up` is a routine
 * command and a restart terminates every container on the machine.
 */
export function moveOwnedEntriesToFront(text: string, recorded: OwnedEntry[]): ReorderResult {
  const identifications = identifyOwnedEntries(text, recorded);
  const conflicts = identifications.filter((identification) => identification.status === 'conflict');

  if (conflicts.length > 0) {
    return { text, entries: recorded, changed: false, conflicts, identifications };
  }

  if (ownedEntriesAtFront(identifications)) {
    return { text, entries: recorded, changed: false, conflicts: [], identifications };
  }

  const present = identifications
    .map((identification, position) => ({ identification, recorded: recorded[position] }))
    .filter((pair) => pair.identification.status === 'matched');

  if (present.length === 0) {
    return { text, entries: recorded, changed: false, conflicts: [], identifications };
  }

  let nextText = text;
  const descending = [...present].sort(
    (left, right) => (right.identification.index ?? 0) - (left.identification.index ?? 0)
  );
  for (const pair of descending) {
    nextText = removeItemAt(nextText, pair.identification.index as number);
  }

  nextText = insertItemsAtFront(
    nextText,
    present.map((pair) => pair.recorded.value)
  );

  const reindexed = new Map(present.map((pair, index) => [pair.recorded.role, index]));

  return {
    text: nextText,
    entries: recorded.map((entry) => {
      const index = reindexed.get(entry.role);
      return index === undefined ? entry : { ...entry, index };
    }),
    changed: true,
    conflicts: [],
    identifications
  };
}

export interface ReconcileResult {
  text: string;
  entries: OwnedEntry[];
  /** Whether the daemon configuration text was modified. */
  changed: boolean;
  conflicts: Identification[];
  identifications: Identification[];
  /** Whether our entries occupy the front of the array in role order. */
  atFront: boolean;
  /** Whether automatic reordering actually moved anything. */
  reordered: boolean;
}

/**
 * The re-entrancy path of spec 9.5: when an ownership record already exists,
 * `up` and `dns enable` come **here** and never to `insertOwnedEntries`, which
 * would add a second entry of our own. This function only ever identifies, and
 * -- when `autoReorder` is on (spec 9.6) -- moves our own entries back to the
 * front. With `autoReorder` off it produces **zero** text changes; warning the
 * user is the caller's job.
 */
export function reconcileOwnedEntries(
  text: string,
  recorded: OwnedEntry[],
  options?: { autoReorder?: boolean }
): ReconcileResult {
  const identifications = identifyOwnedEntries(text, recorded);
  const conflicts = identifications.filter((identification) => identification.status === 'conflict');
  const atFront = ownedEntriesAtFront(identifications);

  if (conflicts.length > 0 || atFront || !options?.autoReorder) {
    return { text, entries: recorded, changed: false, conflicts, identifications, atFront, reordered: false };
  }

  const moved = moveOwnedEntriesToFront(text, recorded);

  return {
    text: moved.text,
    entries: moved.entries,
    changed: moved.changed,
    conflicts: moved.conflicts,
    identifications,
    atFront,
    reordered: moved.changed
  };
}
