/**
 * The markers, and the version they carry.
 *
 * The markers **are** the state. There is no receipt file and no entry in the
 * tool state, and that is a deliberate choice rather than an omission: the tool
 * state lives in the user's home directory, so recording an installation there
 * would turn every *project-scope* install into a home-directory write, raising
 * that milestone's risk by a whole level to buy a cross-project listing nobody asked
 * for. Rendering is deterministic, so re-rendering and comparing answers every
 * question a receipt could:
 *
 *   stale      the marker's version is below SKILL_TEMPLATE_VERSION
 *   modified   the version matches but re-rendering produces different bytes
 *   drifted    same comparison; the installed file carries older .env values
 *   orphaned   carries our marker, and the current template no longer emits it
 *
 * The DNS engine has to remember what it inserted because an IP address in a
 * JSON array cannot carry a marker. Markdown can. Identify by content, not by a
 * remembered list.
 */

/**
 * Bump when the rendered output changes in a way an installed copy should be
 * told about. It is not the CLI version: a patch release that does not touch
 * the corpus should not mark every installation stale.
 */
export const SKILL_TEMPLATE_VERSION = 1;

/** Opens the span Runestone owns inside a file belonging to the user. */
export const BLOCK_BEGIN = 'runestone:begin';

/** Closes it. */
export const BLOCK_END = 'runestone:end';

/** Marks a whole file as generated, for files Runestone owns outright. */
export const FILE_MARKER = 'runestone:generated';

export function beginMarker(version: number = SKILL_TEMPLATE_VERSION): string {
  return `<!-- ${BLOCK_BEGIN} skill-template=${version} -->`;
}

export function endMarker(): string {
  return `<!-- ${BLOCK_END} -->`;
}

export function fileMarker(version: number = SKILL_TEMPLATE_VERSION): string {
  return `<!-- ${FILE_MARKER} skill-template=${version} -->`;
}

/**
 * The same marker as a YAML comment, for a file whose first bytes have to be
 * `---` because a frontmatter parser is going to read them.
 *
 * A comment rather than a `metadata` key: the Agent Skills specification does
 * define `metadata` as a free-form string map, and the generated skill uses it,
 * but the Cursor rules format is not that specification and its frontmatter has
 * no such field. One marker syntax that every YAML parser is guaranteed to
 * ignore beats two.
 */
export function frontmatterMarker(version: number = SKILL_TEMPLATE_VERSION): string {
  return `# ${FILE_MARKER} skill-template=${version}`;
}
