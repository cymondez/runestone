import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';
import { createProgram } from '../../src/cli';

jest.mock('@clack/prompts', () => ({
  text: jest.fn(),
  confirm: jest.fn(),
  isCancel: jest.fn(() => false),
  cancel: jest.fn()
}));

const textMock = p.text as jest.Mock;
const confirmMock = p.confirm as jest.Mock;

describe('resource command', () => {
  const originalIsTTY = process.stdin.isTTY;
  let tempDir: string;
  let logs: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-resource-'));
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(tempDir, 'runestone.config.json');
    process.env.RUNESTONE_LANG = 'en';
    process.exitCode = undefined;
    logs = [];
    for (const stream of ['log', 'error', 'warn'] as const) {
      jest.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    jest.restoreAllMocks();
    textMock.mockReset();
    confirmMock.mockReset();
    delete process.env.RUNESTONE_TOOL_STATE_PATH;
    delete process.env.RUNESTONE_LANG;
    process.exitCode = undefined;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function run(...args: string[]) {
    await createProgram().parseAsync(['node', 'runestone', 'resource', ...args]);
  }

  function stored(): unknown[] {
    const file = process.env.RUNESTONE_TOOL_STATE_PATH as string;
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).resources ?? []) : [];
  }

  const full = ['add', 'shared-pg', '--kind', 'postgres', '--host', 'localhost:5432', '--container', 'host.docker.internal:5432'];

  it('declares a resource given every value, without asking', async () => {
    await run(...full, '--notes', 'One database per project');

    expect(stored()).toEqual([
      {
        name: 'shared-pg',
        kind: 'postgres',
        hostAccess: 'localhost:5432',
        containerAccess: 'host.docker.internal:5432',
        notes: 'One database per project'
      }
    ]);
    expect(textMock).not.toHaveBeenCalled();
  });

  it('without a terminal, reports every bad value at once, names the flags, and writes nothing', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    await run('add', 'shared-pg', '--host', 'app:secret@localhost:5432', '--container', 'db');

    const text = logs.join('\n');
    expect(text).toContain('Kind: missing');
    expect(text).toContain('must not contain user@ or a password');
    expect(text).toContain('must be host:port');
    expect(text).toContain('--kind <kind>');
    expect(process.exitCode).toBe(1);
    expect(stored()).toEqual([]);
  });

  it('refuses a name that is already declared, before asking for anything else', async () => {
    await run(...full);
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    await run(...full);

    expect(logs.join('\n')).toContain('already declared');
    expect(process.exitCode).toBe(1);
    expect(stored()).toHaveLength(1);
  });

  it('in a terminal, asks only for what is missing, and keeps a bad answer on the same prompt', async () => {
    // The prompt rule in AGENTS.md: a correctable error stays on the prompt
    // that caused it. clack's validate does that; this checks the validator
    // handed to it is the field's own.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    textMock.mockResolvedValueOnce('host.docker.internal:5432');

    await run('add', 'shared-pg', '--kind', 'postgres', '--host', 'localhost:5432');

    expect(textMock).toHaveBeenCalledTimes(1);
    const { validate } = textMock.mock.calls[0][0] as { validate: (value: string) => string | undefined };
    expect(validate('postgres://db:5432')).toContain('must be host:port');
    expect(validate('host.docker.internal:5432')).toBeUndefined();
    expect(stored()).toHaveLength(1);
  });

  it('offers a bad flag value again with its reason, instead of failing at the end', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    textMock.mockResolvedValueOnce('localhost:5432');

    await run('add', 'shared-pg', '--kind', 'postgres', '--host', 'localhost', '--container', 'host.docker.internal:5432');

    const options = textMock.mock.calls[0][0] as { message: string; initialValue: string };
    expect(options.initialValue).toBe('localhost');
    expect(options.message).toContain('must be host:port');
    expect(stored()).toEqual([expect.objectContaining({ hostAccess: 'localhost:5432' })]);
  });

  it('lists declared resources, says what an empty list means, and prints JSON', async () => {
    await run('list');
    expect(logs.join('\n')).toContain('No shared resources are declared');

    await run(...full);
    logs = [];
    await run('list');
    expect(logs.join('\n')).toContain('shared-pg  postgres  localhost:5432  host.docker.internal:5432');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await run('list', '--json');
    const rows = JSON.parse(stdout.mock.calls.map((call) => String(call[0])).join(''));
    stdout.mockRestore();
    expect(rows).toHaveLength(1);
  });

  it('changes only the fields given', async () => {
    await run(...full);
    await run('modify', 'shared-pg', '--notes', 'Ask the user for credentials');

    expect(stored()).toEqual([expect.objectContaining({ kind: 'postgres', notes: 'Ask the user for credentials' })]);
  });

  it('removes only with --force when there is no terminal to confirm in', async () => {
    await run(...full);
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    await run('rm', 'shared-pg');
    expect(logs.join('\n')).toContain('add --force');
    expect(stored()).toHaveLength(1);

    await run('rm', 'shared-pg', '--force');
    expect(stored()).toEqual([]);
  });
});
