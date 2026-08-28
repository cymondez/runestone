/**
 * Terminal text measurement.
 *
 * `String.length` is the wrong ruler for aligning columns in a CLI that ships
 * three locales: one CJK character occupies two terminal cells, so a label of
 * two Chinese characters is four columns wide while `length` reports two.
 * Padding by `length` leaves the Chinese and Japanese output visibly ragged
 * where the English output looks fine.
 */

function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/** Width in terminal cells, counting CJK characters as two. */
export function displayWidth(text: string): number {
  let total = 0;
  for (const character of text) {
    total += isFullWidth(character.codePointAt(0) ?? 0) ? 2 : 1;
  }

  return total;
}

/** Pads with spaces to a width in cells. Never truncates. */
export function padToWidth(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? `${text}${' '.repeat(gap)}` : text;
}
