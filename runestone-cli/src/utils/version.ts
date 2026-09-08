import * as fs from 'fs';
import * as path from 'path';

/**
 * The published version, read from the package manifest beside `dist/`.
 *
 * Extracted from `cli.ts` because the MCP server reports it in the initialize
 * handshake, and duplicating the lookup would let the two drift.
 */
export function packageVersion(): string {
  try {
    const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
