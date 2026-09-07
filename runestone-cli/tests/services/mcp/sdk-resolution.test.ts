/**
 * The C1 gate, kept as a permanent test.
 *
 * The SDK publishes only subpath exports, and this project is pinned to node10
 * module resolution because moving to node16 breaks every `@clack/*` import.
 * That combination was expected to need a `tsconfig` `paths` mapping. Measured:
 * it does not. TypeScript walks the directory structure and finds the
 * declarations directly, ignoring the exports map.
 *
 * The catch, and the reason this file exists: the types come from `dist/esm/`
 * and the runtime comes from `dist/cjs/`. Two different trees, reached by two
 * different mechanisms. An SDK release that reorganises either one breaks this,
 * and the runtime half would break silently at run time rather than at compile
 * time — which for a stdio server means a client that simply cannot see
 * Runestone, with nothing in the output to explain why.
 *
 * So this asserts the require, not the import.
 */

describe('the MCP SDK resolves under this project module resolution', () => {
  it.each([
    ['@modelcontextprotocol/sdk/server/mcp.js', 'McpServer'],
    ['@modelcontextprotocol/sdk/server/stdio.js', 'StdioServerTransport'],
    ['@modelcontextprotocol/sdk/inMemory.js', 'InMemoryTransport'],
    ['@modelcontextprotocol/sdk/client/index.js', 'Client']
  ])('loads %s at run time', (specifier, exported) => {
    const loaded = require(specifier) as Record<string, unknown>;

    expect(typeof loaded[exported]).toBe('function');
  });

  it('keeps module and moduleResolution unchanged, which is the whole point', () => {
    const tsconfig = require('../../../tsconfig.json') as {
      compilerOptions: { module: string; moduleResolution: string; paths?: unknown };
    };

    expect(tsconfig.compilerOptions.module).toBe('CommonJS');
    expect(tsconfig.compilerOptions.moduleResolution).toBe('Node');
    // No paths mapping was needed. If a future SDK release forces one, this
    // fails and the change becomes a decision rather than a quiet workaround.
    expect(tsconfig.compilerOptions.paths).toBeUndefined();
  });
});
