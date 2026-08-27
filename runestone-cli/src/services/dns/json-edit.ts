/**
 * A structural scanner for JSON text, used to edit one key of a daemon
 * configuration file without rewriting the rest of it.
 *
 * `JSON.parse` followed by `JSON.stringify` would be far shorter, and wrong:
 * it re-renders the whole document, so a user's inline object, their key order
 * under a numeric-looking name, or their two-space-versus-tab choice would all
 * be silently rewritten. Spec 9.5 forbids exactly that — "rewriting the
 * formatting is itself a way of damaging the user's edits" — and spec 16.3
 * requires the file to be byte-identical after an enable followed by a disable.
 *
 * So every operation here is a splice on the original text: the bytes we do not
 * own are copied through untouched, because they are never re-rendered.
 */

/** A half-open range `[start, end)` into the document text. */
export interface Span {
  start: number;
  end: number;
}

export interface KeyEntry {
  name: string;
  /** First character of the `"key"` token. */
  entryStart: number;
  /** First character of the value. */
  valueStart: number;
  /** One past the last character of the value. */
  valueEnd: number;
}

export interface ObjectScan {
  /** One past the `{`. */
  bodyStart: number;
  /** Index of the `}`. */
  bodyEnd: number;
  keys: KeyEntry[];
}

export interface ArrayScan {
  /** One past the `[`. */
  bodyStart: number;
  /** Index of the `]`. */
  bodyEnd: number;
  items: Span[];
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && WHITESPACE.has(text[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function scanString(text: string, index: number): number {
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }

    if (char === '"') {
      return cursor + 1;
    }

    cursor += 1;
  }

  throw new Error('Unterminated string in JSON document');
}

function scanValue(text: string, index: number): number {
  const start = skipWhitespace(text, index);
  const char = text[start];

  if (char === '"') {
    return scanString(text, start);
  }

  if (char === '{') {
    return scanObject(text, start).bodyEnd + 1;
  }

  if (char === '[') {
    return scanArray(text, start).bodyEnd + 1;
  }

  let cursor = start;
  while (cursor < text.length && !WHITESPACE.has(text[cursor]) && !',}]'.includes(text[cursor])) {
    cursor += 1;
  }

  if (cursor === start) {
    throw new Error(`Unexpected character in JSON document at offset ${start}`);
  }

  return cursor;
}

export function scanObject(text: string, index: number): ObjectScan {
  if (text[index] !== '{') {
    throw new Error(`Expected an object at offset ${index}`);
  }

  const bodyStart = index + 1;
  const keys: KeyEntry[] = [];
  let cursor = skipWhitespace(text, bodyStart);

  while (cursor < text.length && text[cursor] !== '}') {
    const entryStart = cursor;
    const keyEnd = scanString(text, cursor);
    const name = JSON.parse(text.slice(entryStart, keyEnd)) as string;

    cursor = skipWhitespace(text, keyEnd);
    if (text[cursor] !== ':') {
      throw new Error(`Expected ':' after key "${name}"`);
    }

    const valueStart = skipWhitespace(text, cursor + 1);
    const valueEnd = scanValue(text, valueStart);
    keys.push({ name, entryStart, valueStart, valueEnd });

    cursor = skipWhitespace(text, valueEnd);
    if (text[cursor] === ',') {
      cursor = skipWhitespace(text, cursor + 1);
    }
  }

  if (text[cursor] !== '}') {
    throw new Error('Unterminated object in JSON document');
  }

  return { bodyStart, bodyEnd: cursor, keys };
}

export function scanArray(text: string, index: number): ArrayScan {
  if (text[index] !== '[') {
    throw new Error(`Expected an array at offset ${index}`);
  }

  const bodyStart = index + 1;
  const items: Span[] = [];
  let cursor = skipWhitespace(text, bodyStart);

  while (cursor < text.length && text[cursor] !== ']') {
    const start = cursor;
    const end = scanValue(text, start);
    items.push({ start, end });

    cursor = skipWhitespace(text, end);
    if (text[cursor] === ',') {
      cursor = skipWhitespace(text, cursor + 1);
    }
  }

  if (text[cursor] !== ']') {
    throw new Error('Unterminated array in JSON document');
  }

  return { bodyStart, bodyEnd: cursor, items };
}

/**
 * The document's indentation unit, taken from the first indented line. Used only
 * when creating a key or a file that did not exist; existing lines keep their
 * own indentation because they are never re-rendered.
 */
export function detectIndent(text: string): string {
  const match = /\n([ \t]+)(?=")/.exec(text);
  return match ? match[1] : '  ';
}

/** The whitespace at the start of the line that `offset` falls on. */
export function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const indent = text.slice(lineStart, offset);
  return /^[ \t]*$/.test(indent) ? indent : '';
}

/**
 * The document's newline style. Docker Desktop on Windows writes CRLF, and
 * mixing endings into a file we only partly own is its own kind of damage.
 */
export function detectNewline(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splice(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}
