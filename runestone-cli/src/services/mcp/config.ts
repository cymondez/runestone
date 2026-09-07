/**
 * The registration block a user pastes into their client's configuration.
 *
 * Runestone prints it and does not write it. Editing another tool's
 * configuration file on the user's behalf is the same class of act as editing
 * the Docker daemon's, and the DNS feature treats that as the highest risk
 * there is. Printing costs the user one paste and costs us nothing to get
 * wrong.
 *
 * The shapes genuinely differ, and the difference is easy to miss because
 * everything else about them looks the same: **VS Code uses the key `servers`
 * while Claude Code and Cursor use `mcpServers`.** A single "here is the JSON"
 * answer would be wrong for one of them.
 */

export interface McpClient {
  id: string;
  title: string;
  /** Where the user puts it. */
  location: string;
  /** The top-level key. This is the part that differs. */
  key: 'mcpServers' | 'servers';
  /** Where the paths and key were read from. */
  docsUrl: string;
  verifiedOn: string;
  /** Extra guidance the user needs in order not to think it is broken. */
  note?: string;
}

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    id: 'claude-code',
    title: 'Claude Code',
    location: '.mcp.json at the project root',
    key: 'mcpServers',
    docsUrl: 'https://code.claude.com/docs/en/mcp',
    verifiedOn: '2026-09-07',
    note:
      'A project-scoped .mcp.json asks for approval the first time it is used in an interactive session. ' +
      'Non-interactive runs do not prompt. If nothing appears at first, that prompt is what you are waiting for.'
  },
  {
    id: 'cursor',
    title: 'Cursor',
    location: '.cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project',
    key: 'mcpServers',
    docsUrl: 'https://cursor.com/docs/context/mcp',
    verifiedOn: '2026-09-07'
  },
  {
    id: 'vscode',
    title: 'VS Code',
    location: '.vscode/mcp.json in the workspace',
    key: 'servers',
    docsUrl: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
    verifiedOn: '2026-09-07',
    note: 'VS Code uses the key "servers" rather than "mcpServers". The rest of the block is the same.'
  }
] as const;

export function findClient(id: string): McpClient | undefined {
  return MCP_CLIENTS.find((client) => client.id === id);
}

export function clientIds(): string[] {
  return MCP_CLIENTS.map((client) => client.id);
}

export function renderClientConfig(client: McpClient): string {
  return JSON.stringify(
    { [client.key]: { runestone: { type: 'stdio', command: 'runestone', args: ['mcp', 'serve'] } } },
    null,
    2
  );
}
