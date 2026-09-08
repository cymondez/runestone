/**
 * The registration block a user pastes into their client's configuration.
 *
 * Runestone prints it and does not write it. Editing another tool's
 * configuration file on the user's behalf is the same class of act as editing
 * the Docker daemon's, and the DNS feature treats that as the highest risk
 * there is. Printing costs the user one paste and costs us nothing to get
 * wrong.
 *
 * The shapes genuinely differ, and every difference here is one that produces a
 * silently non-working configuration rather than an error:
 *
 *   - **Codex is TOML**, not JSON. A JSON block pasted into `config.toml` is
 *     simply not a configuration.
 *   - **VS Code uses `servers`**; almost everyone else uses `mcpServers`.
 *   - **Zed uses `context_servers`.**
 *
 * So the table carries the format and the key per client, and every row cites
 * the documentation it came from and the date it was checked — the install-path
 * landscape moves, and a row nobody can check is a row nobody can trust.
 */

export type ConfigFormat = 'json' | 'toml';

export interface McpClient {
  id: string;
  title: string;
  /** Where the user puts it. */
  location: string;
  format: ConfigFormat;
  /** The top-level key or TOML table prefix. */
  key: string;
  /** Where the path, format and key were read from. */
  docsUrl: string;
  verifiedOn: string;
  /**
   * A command that registers the server without any pasting. Printed in
   * preference to the block when the client has one, because a command the
   * user runs cannot be pasted into the wrong file.
   */
  addCommand?: string;
  /**
   * The value this client's own documentation gives for `type`, or undefined
   * where it shows none.
   *
   * Not a boolean, because the answer is not yes-or-no: VS Code documents
   * `"stdio"`, **Copilot CLI documents `"local"`**, and Gemini, Windsurf and Zed
   * show `command` and `args` alone. Emitting a field — or a value — a vendor
   * does not document is a guess, and one a schema validator may reject.
   */
  typeValue?: string;
  /** Anything else the vendor's own example carries. */
  extraFields?: Record<string, unknown>;
  /** Anything the user needs in order not to think it is broken. */
  note?: string;
}

export const SERVER_NAME = 'runestone';
const COMMAND = 'runestone';
const ARGS = ['mcp', 'serve'];

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    id: 'claude',
    typeValue: 'stdio',
    title: 'Claude Code',
    location: '.mcp.json at the project root',
    format: 'json',
    key: 'mcpServers',
    docsUrl: 'https://code.claude.com/docs/en/mcp',
    verifiedOn: '2026-09-08',
    addCommand: `claude mcp add ${SERVER_NAME} -- ${COMMAND} ${ARGS.join(' ')}`,
    note:
      'A project-scoped .mcp.json asks for approval the first time it is used in an interactive session. ' +
      'Non-interactive runs do not prompt. If nothing appears at first, that prompt is what you are waiting for.'
  },
  {
    id: 'codex',
    title: 'Codex CLI',
    location: '~/.codex/config.toml, or .codex/config.toml for one project',
    format: 'toml',
    key: 'mcp_servers',
    docsUrl: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    verifiedOn: '2026-09-08',
    addCommand: `codex mcp add ${SERVER_NAME} -- ${COMMAND} ${ARGS.join(' ')}`,
    note: 'Codex configuration is TOML, not JSON. The block below is not interchangeable with the others.'
  },
  {
    id: 'cursor',
    typeValue: 'stdio',
    title: 'Cursor',
    location: '.cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project',
    format: 'json',
    key: 'mcpServers',
    docsUrl: 'https://cursor.com/docs/context/mcp',
    verifiedOn: '2026-09-07'
  },
  {
    id: 'vscode',
    typeValue: 'stdio',
    title: 'VS Code',
    location: '.vscode/mcp.json in the workspace',
    format: 'json',
    key: 'servers',
    docsUrl: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
    verifiedOn: '2026-09-07',
    note:
      'VS Code uses the key "servers" rather than "mcpServers". This is the editor only — GitHub Copilot CLI is a ' +
      'separate client with its own file; see --client copilot.'
  },
  {
    id: 'copilot',
    typeValue: 'local',
    extraFields: { tools: ['*'] },
    title: 'GitHub Copilot CLI',
    location: '~/.copilot/mcp-config.json',
    format: 'json',
    key: 'mcpServers',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
    verifiedOn: '2026-09-08',
    addCommand: `copilot mcp add ${SERVER_NAME} -- ${COMMAND} ${ARGS.join(' ')}`,
    note:
      'This is not the same as VS Code. Copilot CLI reads its own file, uses the key "mcpServers" rather than ' +
      '"servers", and writes "type": "local" rather than "stdio". VS Code documentation states the Agent Host does ' +
      'not read .vscode/mcp.json directly.'
  },
  {
    id: 'gemini',
    title: 'Gemini CLI',
    location: '~/.gemini/settings.json, or .gemini/settings.json for one project',
    format: 'json',
    key: 'mcpServers',
    docsUrl: 'https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html',
    verifiedOn: '2026-09-08'
  },
  {
    id: 'windsurf',
    title: 'Windsurf',
    location: '~/.codeium/windsurf/mcp_config.json',
    format: 'json',
    key: 'mcpServers',
    docsUrl: 'https://docs.devin.ai/desktop/cascade/mcp',
    verifiedOn: '2026-09-08'
  },
  {
    id: 'zed',
    title: 'Zed',
    location: 'the Zed settings file, via the "zed: open settings file" command',
    format: 'json',
    key: 'context_servers',
    docsUrl: 'https://zed.dev/docs/ai/mcp',
    verifiedOn: '2026-09-08',
    note: 'Zed uses the key "context_servers" rather than "mcpServers".'
  }
] as const;

export function findClient(id: string): McpClient | undefined {
  return MCP_CLIENTS.find((client) => client.id === id);
}

export function clientIds(): string[] {
  return MCP_CLIENTS.map((client) => client.id);
}

/**
 * Hand-written TOML rather than a dependency.
 *
 * The value being serialised is fixed and tiny — one table, one string, one
 * array of strings — so a library would be several hundred kilobytes to render
 * four lines. Note the shape difference: TOML nests through the table header,
 * `[mcp_servers.runestone]`, where JSON nests through braces.
 */
function renderToml(client: McpClient): string {
  const args = ARGS.map((arg) => JSON.stringify(arg)).join(', ');
  return [`[${client.key}.${SERVER_NAME}]`, `command = ${JSON.stringify(COMMAND)}`, `args = [${args}]`].join('\n');
}

function renderJson(client: McpClient): string {
  const entry = {
    ...(client.typeValue ? { type: client.typeValue } : {}),
    command: COMMAND,
    args: ARGS,
    ...(client.extraFields ?? {})
  };

  return JSON.stringify({ [client.key]: { [SERVER_NAME]: entry } }, null, 2);
}

export function renderClientConfig(client: McpClient): string {
  return client.format === 'toml' ? renderToml(client) : renderJson(client);
}
