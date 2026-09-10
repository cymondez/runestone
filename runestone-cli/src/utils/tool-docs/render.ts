/**
 * Substitution for the agent-facing corpus. Pure: no filesystem, no process.
 *
 * Two constructs and no template language (spec 5.3):
 *   {{NAME}}              a scalar
 *   {{BLOCK:NAME}}        alone on a line, replaced by a rendered block
 *
 * The delimiter is `{{...}}` rather than `${...}` because the corpus is full of
 * Compose and shell interpolation that must survive verbatim — `compose.md`
 * carries a literal `${PREFIX:-runestone}` a few lines from a placeholder.
 *
 * Every replacement goes through a *function* replacer. Passing a value as
 * `String.prototype.replace`'s replacement string would make `$&`, `$1`, `$'`
 * and `$$` inside it act as patterns, which was a live defect in the renderer
 * this file replaces: harmless for the four env scalars it handled, and not
 * harmless at all once a service URL or a certificate SAN is substituted.
 */

/** Block name to the text it expands to. Called only when the block is used. */
export type BlockRenderers = Record<string, () => string>;

const VAR_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;
const BLOCK_LINE_PATTERN = /^[ \t]*\{\{BLOCK:([A-Za-z0-9_]+)\}\}[ \t]*$/gm;

export class TemplateError extends Error {}

function fail(message: string): never {
  throw new TemplateError(message);
}

/**
 * Expand `template`. Unknown names are a hard error rather than a silent
 * passthrough: a placeholder that reaches an agent verbatim is an instruction
 * the agent cannot follow, and it is cheaper to fail here than to debug the
 * behaviour it produces.
 */
export function substitute(
  template: string,
  vars: Record<string, string>,
  blocks: BlockRenderers = {}
): string {
  const withBlocks = template.replace(BLOCK_LINE_PATTERN, (_match, name: string) => {
    const render = blocks[name];
    if (!render) {
      fail(`Unknown block '${name}' in the agent context template.`);
    }

    return render();
  });

  const expanded = withBlocks.replace(VAR_PATTERN, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      fail(`Unknown placeholder '${name}' in the agent context template.`);
    }

    return value;
  });

  // Catches a {{BLOCK:...}} that was not alone on its line, and any other
  // malformed placeholder the two patterns above cannot match. Without this,
  // such a token would ship to the agent as literal text.
  const leftover = expanded.indexOf('{{');
  if (leftover !== -1) {
    fail(`Unexpanded placeholder at offset ${leftover}: ${expanded.slice(leftover, leftover + 40)}`);
  }

  return expanded;
}
