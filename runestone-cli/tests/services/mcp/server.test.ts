import * as fs from 'fs';
import * as path from 'path';
import { PassThrough } from 'stream';
import { MCP_CLIENTS, McpClient, findClient, renderClientConfig } from '../../../src/services/mcp/config';
import { ERROR, PROTOCOL_VERSION, handleLine } from '../../../src/services/mcp/jsonrpc';
import { SERVER_INFO, TOOLS, createHandlers, serveStdio } from '../../../src/services/mcp/server';
import { listDomainCertificates } from '../../../src/services/cert-manager';
import { RunestoneEnv } from '../../../src/utils/env-loader';
import { testEnv } from '../../helpers/env';

jest.mock('../../../src/services/cert-manager', () => ({
  ...jest.requireActual('../../../src/services/cert-manager'),
  listDomainCertificates: jest.fn()
}));

const info = { ...SERVER_INFO, version: '2.0.0' };

function config(overrides: Partial<RunestoneEnv> = {}) {
  return testEnv('/tmp/runestone-mcp', { HOST_DOMAIN: 'example.test', PREFIX: 'mylab', ...overrides });
}

function handlers(configured = true) {
  return createHandlers({ loadConfig: () => config(), isConfigured: () => configured });
}

async function call(name: string, args: Record<string, unknown> = {}, configured = true) {
  const response = await handleLine(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    info,
    handlers(configured)
  );

  return (response as { result: { content: Array<{ text: string }>; isError?: boolean; structuredContent?: unknown } })
    .result;
}

beforeEach(() => {
  (listDomainCertificates as jest.Mock).mockReturnValue([]);
});

describe('the protocol layer', () => {
  it('echoes the protocol version the client asked for', async () => {
    const response = await handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'x', version: '1' } }
      }),
      info,
      handlers()
    );

    const result = (response as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual(info);
  });

  it('never answers a notification', async () => {
    // The classic hand-rolled bug: replying to notifications/initialized leaves
    // an unmatched response that some clients treat as a protocol error.
    for (const method of ['notifications/initialized', 'notifications/cancelled']) {
      expect(await handleLine(JSON.stringify({ jsonrpc: '2.0', method }), info, handlers())).toBeUndefined();
    }
  });

  it('does not answer an unknown notification either', async () => {
    expect(
      await handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/whatever' }), info, handlers())
    ).toBeUndefined();
  });

  it('reports the standard error codes', async () => {
    const errorOf = async (line: string) =>
      ((await handleLine(line, info, handlers())) as { error: { code: number } }).error;

    expect((await errorOf('{not json')).code).toBe(ERROR.parse);
    expect((await errorOf('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).code).toBe(ERROR.invalidRequest);
    expect((await errorOf('{"jsonrpc":"1.0","id":1,"method":"ping"}')).code).toBe(ERROR.invalidRequest);
    expect((await errorOf('{"jsonrpc":"2.0","id":1,"method":"nope"}')).code).toBe(ERROR.methodNotFound);
    expect((await errorOf('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}')).code).toBe(
      ERROR.invalidParams
    );
  });

  it('carries a null id when the input was unparseable', async () => {
    // No id can be recovered from broken JSON, and the specification requires
    // null rather than a guess.
    const response = await handleLine('{oops', info, handlers());
    expect((response as { id: unknown }).id).toBeNull();
  });

  it('answers ping', async () => {
    const response = await handleLine('{"jsonrpc":"2.0","id":7,"method":"ping"}', info, handlers());
    expect(response).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });
});

describe('the tools', () => {
  it('lists exactly three, all annotated read-only', async () => {
    const response = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', info, handlers());
    const tools = (response as { result: { tools: typeof TOOLS } }).result.tools;

    expect(tools.map((tool) => tool.name)).toEqual([
      'runestone_context',
      'runestone_status',
      'runestone_check_name'
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.inputSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('treats an unconfigured Runestone as a successful result, not an error', async () => {
    // The opposite of the CLI contract, deliberately. A failed tool call gives
    // the model an error to route around; a successful one that says what to do
    // gives it something actionable.
    const result = await call('runestone_context', {}, false);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('runestone setup');
    expect(result.structuredContent).toEqual({ configured: false });
  });

  it('reports an unknown topic as a correctable result rather than a JSON-RPC error', async () => {
    const result = await call('runestone_context', { topic: 'nope', offline: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Available topics');
  });

  it('reports an unknown tool the same way', async () => {
    const result = await call('runestone_nope', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('runestone_context');
  });

  it('requires at least one argument for check_name', async () => {
    const result = await call('runestone_check_name', { offline: true });

    expect(result.isError).toBe(true);
  });

  it('rejects a route that carries a scheme, and says why', async () => {
    const result = await call('runestone_check_name', { route: 'http://api.example.test', offline: true });
    const verdict = (result.structuredContent as { route: { available: boolean; reason: string } }).route;

    expect(verdict.available).toBe(false);
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it('names the certs command when nothing covers the route', async () => {
    const result = await call('runestone_check_name', { route: 'api.example.test', offline: true });
    const verdict = (result.structuredContent as {
      route: { coveringCertificate: string | null; certificateCommand?: string };
    }).route;

    expect(verdict.coveringCertificate).toBeNull();
    expect(verdict.certificateCommand).toBe('runestone certs create example.test');
  });

  it('warns that an available verdict is unverified when Traefik was not queried', async () => {
    // Silence here is the dangerous option: an agent reads it as "free" and
    // picks a name another project already registered.
    const result = await call('runestone_check_name', { serviceName: 'api', offline: true });
    const verdict = result.structuredContent as { caveat?: string };

    expect(verdict.caveat).toContain('not checked');
  });

  it('never throws out of a tool call, whatever the certificate reader does', async () => {
    (listDomainCertificates as jest.Mock).mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = await call('runestone_check_name', { route: 'api.example.test', offline: true });

    expect(result.content[0].text.length).toBeGreaterThan(0);
  });
});

describe('the stdio loop', () => {
  it('writes one frame per request and none for a notification', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    const done = serveStdio(info, handlers(), input, output);
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    input.write('\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    input.end();
    await done;

    const frames = chunks.join('').trim().split('\n').filter(Boolean);
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => JSON.parse(frame).id)).toEqual([1, 2]);
  });

  it('resolves on an immediate end of input without hanging', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const done = serveStdio(info, handlers(), input, output);
    input.end();

    await expect(done).resolves.toBeUndefined();
  });

  it('writes every in-flight answer before it resolves', async () => {
    // A client that closes promptly must not lose the reply it was waiting for.
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    const done = serveStdio(info, handlers(), input, output);
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    input.end();
    await done;

    expect(chunks.join('')).toContain('runestone_context');
  });
});

describe('stdout purity', () => {
  const mcpSources = () => {
    const dir = path.resolve(__dirname, '..', '..', '..', 'src', 'services', 'mcp');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.ts')).map((name) => path.join(dir, name));
    files.push(path.resolve(__dirname, '..', '..', '..', 'src', 'commands', 'mcp.ts'));

    return files;
  };

  /**
   * Comments are stripped before scanning, because the rule is about code.
   *
   * The first version of this suite matched raw file text and failed on three
   * places — two of them comments *explaining* the rule, and one of them
   * `process.stdout` as the transport's default output parameter, which is not
   * a violation but the entire point of the transport. A rule stated as "the
   * string never appears" was simply the wrong rule.
   */
  const code = (file: string): string =>
    fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each([
    ['a console write, which goes to stdout', /console\s*\./],
    ['an import of the logger, whose info and success go to stdout', /from '[^']*utils\/logger'/],
    ['an import of a prompt library, which also writes to stdout', /from '@clack/]
  ])('contains no %s', (_label, pattern) => {
    for (const file of mcpSources()) {
      expect(code(file)).not.toMatch(pattern);
    }
  });

  it('touches process.stdout only where writing to it is the job', () => {
    // The rule is scoped to the *server*, not to every file with "mcp" in its
    // path. `mcp config` exists to put a block on stdout so the user can pipe
    // or copy it, so forbidding stdout there would forbid the feature.
    //
    // Within the server, exactly one place may name it: the transport's default
    // output parameter. Everything else takes the stream as an argument, which
    // is what makes the loop testable and leaves a stray write nowhere to go.
    const occurrences = mcpSources().flatMap((file) =>
      [...code(file).matchAll(/process\.stdout/g)].map(() => path.basename(file))
    );

    expect(occurrences.sort()).toEqual(['mcp.ts', 'server.ts']);
  });

  it('keeps the serving path itself free of stdout, apart from the frame write', () => {
    // The assertion that actually protects the protocol stream: `serve` must
    // reach stdout only through the transport it hands the stream to.
    const command = code(path.resolve(__dirname, '..', '..', '..', 'src', 'commands', 'mcp.ts'));
    const serveAction = command.slice(command.indexOf("createCommand('serve')"), command.indexOf("createCommand('config')"));

    expect(serveAction).not.toMatch(/process\.stdout/);
    expect(serveAction).not.toMatch(/console\s*\./);
  });

  it('contains none of the spawn strings, even inside a comment', () => {
    // This one really is about raw text: the repository's acceptance test
    // matches file contents rather than parsing them, so a comment mentioning
    // any of these fails the build.
    for (const file of mcpSources()) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/child_process|spawnSync|execSync/);
    }
  });
});

describe('the registration block', () => {
  // Every difference below produces a configuration that silently does not
  // work rather than one that errors, which is why each is asserted rather
  // than assumed to follow the others.
  it.each([
    ['claude', 'json', 'mcpServers'],
    ['codex', 'toml', 'mcp_servers'],
    ['cursor', 'json', 'mcpServers'],
    ['vscode', 'json', 'servers'],
    ['copilot', 'json', 'mcpServers'],
    ['gemini', 'json', 'mcpServers'],
    ['windsurf', 'json', 'mcpServers'],
    ['zed', 'json', 'context_servers']
  ])('renders %s as %s under the key %s', (id, format, key) => {
    const client = findClient(id) as McpClient;
    expect(client.format).toBe(format);
    expect(client.key).toBe(key);

    const block = renderClientConfig(client);
    if (format === 'toml') {
      // A JSON block pasted into config.toml is simply not a configuration, so
      // this is the assertion that keeps Codex working at all.
      expect(block).toContain(`[${key}.runestone]`);
      expect(block).not.toContain('{');
    } else {
      expect(JSON.parse(block)).toHaveProperty(key);
    }
  });

  it('names the command the handshake test actually drives, in both formats', () => {
    for (const client of MCP_CLIENTS) {
      const block = renderClientConfig(client);

      if (client.format === 'toml') {
        expect(block).toContain('command = "runestone"');
        expect(block).toContain('args = ["mcp", "serve"]');
        continue;
      }

      const parsed = JSON.parse(block) as Record<string, Record<string, unknown>>;
      const entry = parsed[client.key].runestone as { command: string; args: string[] };
      expect(entry.command).toBe('runestone');
      expect(entry.args).toEqual(['mcp', 'serve']);
    }
  });

  it('emits the type value each vendor documents, and none where they show none', () => {
    // Not a yes-or-no question: VS Code documents "stdio", Copilot CLI
    // documents "local", and Gemini, Windsurf and Zed show `command` and `args`
    // alone. Emitting a field, or a value, a vendor does not document is a
    // guess that a schema validator may reject.
    for (const client of MCP_CLIENTS.filter((candidate) => candidate.format === 'json')) {
      const parsed = JSON.parse(renderClientConfig(client)) as Record<string, Record<string, unknown>>;
      const entry = parsed[client.key].runestone as { type?: string };

      expect(entry.type).toBe(client.typeValue);
    }

    expect((findClient('vscode') as McpClient).typeValue).toBe('stdio');
    expect((findClient('copilot') as McpClient).typeValue).toBe('local');
    expect((findClient('zed') as McpClient).typeValue).toBeUndefined();
  });

  it('keeps VS Code and Copilot CLI apart, because they are different tools', () => {
    // They are routinely assumed to share configuration and do not: different
    // file, different key, different type value. VS Code's own documentation
    // states the Agent Host does not read .vscode/mcp.json.
    const vscode = findClient('vscode') as McpClient;
    const copilot = findClient('copilot') as McpClient;

    expect(vscode.location).not.toBe(copilot.location);
    expect(vscode.key).not.toBe(copilot.key);
    expect(vscode.typeValue).not.toBe(copilot.typeValue);
    expect(vscode.note).toContain('copilot');
    expect(copilot.note).toContain('not the same as VS Code');
  });

  it('carries the provenance of every row', () => {
    // The configuration landscape moves. A row without a source and a date is
    // a row nobody can check.
    for (const client of MCP_CLIENTS) {
      expect(client.docsUrl).toMatch(/^https:\/\//);
      expect(client.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(client.location.length).toBeGreaterThan(0);
    }
  });

  it('offers a registration command wherever the client has one', () => {
    // A command the user runs cannot be pasted into the wrong file.
    for (const id of ['claude', 'codex', 'copilot']) {
      const client = findClient(id) as McpClient;
      expect(client.addCommand).toContain('mcp add runestone');
      expect(client.addCommand).toContain('runestone mcp serve');
    }
  });

  it('warns where a client would otherwise look broken', () => {
    expect((findClient('claude') as McpClient).note).toContain('approval');
    // Pasting JSON into a TOML file fails in a way that gives no clue.
    expect((findClient('codex') as McpClient).note).toContain('TOML');
    expect((findClient('vscode') as McpClient).note).toContain('servers');
    expect((findClient('zed') as McpClient).note).toContain('context_servers');
  });

  it('covers the mainstream agents rather than only the ones I happened to know', () => {
    expect(MCP_CLIENTS.map((client) => client.id).sort()).toEqual([
      'claude',
      'codex',
      'copilot',
      'cursor',
      'gemini',
      'vscode',
      'windsurf',
      'zed'
    ]);
  });
});
