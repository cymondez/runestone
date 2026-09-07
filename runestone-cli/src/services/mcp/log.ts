/**
 * Diagnostics for the MCP process. stderr only, gated on DEBUG.
 *
 * This exists because `utils/logger` cannot be used here: its `info`, `success`
 * and `debug` all go through `console.log`, which is stdout, which is the
 * protocol stream. One stray call corrupts the session, and the failure looks
 * to the user like "my agent cannot see Runestone" with nothing to explain it.
 */

const DEBUG = process.env.DEBUG === '1';

export function debug(message: string): void {
  if (DEBUG) {
    process.stderr.write(`[runestone-mcp] ${message}\n`);
  }
}
