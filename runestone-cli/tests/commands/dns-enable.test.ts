import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { spawnCommand } from '../../src/utils/spawn';
import { composeService } from '../../src/services/docker-compose';
import { DAEMON_PATH_OVERRIDE_ENV } from '../../src/services/dns/daemon-target';
import * as p from '@clack/prompts';
import { toolState } from '../../src/utils/tool-state';

const TARGET = '192.168.65.254';

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: {
    ps: jest.fn(() => []),
    up: jest.fn(),
    removeServices: jest.fn(),
    restart: jest.fn()
  }
}));

// Intercepting at spawnCommand rather than at the probe module: the probes call
// each other inside their own module, where a module mock does not reach.
jest.mock('../../src/utils/spawn', () => ({
  spawnCommand: jest.fn()
}));

jest.mock('@clack/prompts', () => ({
  ...jest.requireActual('@clack/prompts'),
  confirm: jest.fn(async () => true),
  select: jest.fn(async () => 'keep'),
  text: jest.fn(async () => ''),
  isCancel: jest.fn(() => false)
}));

const spawnMock = spawnCommand as jest.MockedFunction<typeof spawnCommand>;
const confirmMock = p.confirm as jest.MockedFunction<typeof p.confirm>;
const selectMock = p.select as jest.MockedFunction<typeof p.select>;
const textMock = p.text as jest.MockedFunction<typeof p.text>;
const isCancelMock = p.isCancel as jest.MockedFunction<typeof p.isCancel>;

interface DockerReplies {
  osType: string;
  context: string;
  /** Answers for the throwaway containers, in call order. */
  containerOutputs: string[];
}

const replies: DockerReplies = { osType: 'linux', context: '', containerOutputs: [] };

function spawnResult(stdout: string, status = 0) {
  return { status, stdout, stderr: '', pid: 1, output: [null, stdout, ''], signal: null } as never;
}

const upMock = composeService.up as jest.MockedFunction<typeof composeService.up>;
const removeServicesMock = composeService.removeServices as jest.MockedFunction<typeof composeService.removeServices>;

describe('dns enable command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let errorSpy: jest.SpyInstance<void, Parameters<typeof console.error>>;
  let exitSpy: jest.SpyInstance;
  let directory: string;
  let projectDir: string;
  let daemonDir: string;
  let daemonPath: string;
  const saved: Record<string, string | undefined> = {};
  const tracked = [DAEMON_PATH_OVERRIDE_ENV, 'RUNESTONE_TOOL_STATE_PATH', 'RUNESTONE_LANG'];

  function writeDaemon(dns?: string[]): string {
    const text = `${JSON.stringify(dns === undefined ? { experimental: false } : { dns, experimental: false }, null, 2)}\n`;
    fs.writeFileSync(daemonPath, text, 'utf8');
    return text;
  }

  function output(): string {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(' ')).join('\n');
  }

  async function enable(...args: string[]): Promise<void> {
    await createProgram().parseAsync(['node', 'runestone', 'dns', 'enable', ...args]);
  }

  async function disable(...args: string[]): Promise<void> {
    await createProgram().parseAsync(['node', 'runestone', 'dns', 'disable', ...args]);
  }

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    replies.osType = 'linux';
    replies.context = 'desktop-linux|npipe:////./pipe/dockerDesktopLinuxEngine';
    // Both the Target IP lookup and the verification query run a throwaway
    // container; the Target IP answer doubles as a correct verification answer.
    replies.containerOutputs = [];
    spawnMock.mockImplementation((command, args) => {
      const joined = args.join(' ');
      if (joined.startsWith('info ')) {
        return spawnResult(replies.osType);
      }
      if (joined.startsWith('context inspect')) {
        return spawnResult(replies.context);
      }
      if (joined.startsWith('run ')) {
        return spawnResult(replies.containerOutputs.shift() ?? TARGET);
      }
      return spawnResult('');
    });

    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-enable-cmd-'));
    projectDir = path.join(directory, 'project');
    daemonDir = path.join(directory, 'docker');
    fs.mkdirSync(projectDir);
    fs.mkdirSync(daemonDir);
    daemonPath = path.join(daemonDir, 'daemon.json');

    for (const name of tracked) {
      saved[name] = process.env[name];
    }
    process.env[DAEMON_PATH_OVERRIDE_ENV] = daemonPath;
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(directory, 'runestone.config.json');
    process.env.RUNESTONE_LANG = 'en';

    fs.writeFileSync(
      path.join(projectDir, '.env'),
      `${['HOST_DOMAIN=example.test', 'PREFIX=runestone'].join('\n')}\n`,
      'utf8'
    );
    fs.writeFileSync(
      process.env.RUNESTONE_TOOL_STATE_PATH,
      JSON.stringify({ runestonePath: projectDir, locale: 'en' }, null, 2),
      'utf8'
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    for (const name of tracked) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name] as string;
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('inserts our entry and stops at prepared, having restarted nothing', async () => {
    writeDaemon(['8.8.8.8']);

    await enable('--yes', '--no-restart');

    expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual([TARGET, '8.8.8.8']);
    expect(toolState.readDnsState()).toMatchObject({ phase: 'prepared', targetIp: TARGET });
    expect(output()).toContain('restart Docker');
    expect(upMock).toHaveBeenCalledWith(expect.any(String), { profiles: ['dns'], services: ['dns'] });
  });

  describe('the disclosure carries real values, not placeholders (spec 11.3)', () => {
    it('names the file, the addresses and the upstreams actually in effect', async () => {
      writeDaemon(['9.9.9.9']);

      await enable('--dry-run');

      const printed = output();
      expect(printed).toContain(daemonPath);
      expect(printed).toContain(TARGET);
      expect(printed).toContain('0.0.0.0:53');
      expect(printed).toContain('9.9.9.9');
      expect(printed).not.toMatch(/<[a-z ]+>/);
    });

    it('gives both directions of the daemon fallback', async () => {
      fs.appendFileSync(path.join(projectDir, '.env'), 'DNS_DAEMON_FALLBACK=1.1.1.1\n', 'utf8');
      writeDaemon(['8.8.8.8']);

      await enable('--dry-run');

      // Spec 9.7: stating only the benefit hides the cost, and stating only the
      // cost hides the benefit. Both are unacceptable.
      expect(output()).toContain('keeps resolving ordinary internet names');
      expect(output()).toContain('127.0.0.1');
    });

    it('warns that the web UI has no authentication', async () => {
      writeDaemon(['8.8.8.8']);

      await enable('--dry-run');

      expect(output()).toContain('has no authentication');
      expect(output()).toContain('https://dns.example.test');
    });
  });

  describe('--dry-run', () => {
    it('changes not one byte and starts nothing', async () => {
      const before = writeDaemon(['8.8.8.8']);
      const envBefore = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');

      await enable('--dry-run');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).toBe(envBefore);
      expect(upMock).not.toHaveBeenCalled();
      expect(toolState.readDnsState()).toBeUndefined();
    });
  });

  describe('preflight refusals leave nothing behind', () => {
    it('refuses a remote context', async () => {
      const before = writeDaemon(['8.8.8.8']);
      replies.context = 'remote|tcp://10.0.0.5:2376';

      await enable('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(upMock).not.toHaveBeenCalled();
      expect(output()).toContain('not this machine');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('refuses Windows container mode', async () => {
      const before = writeDaemon(['8.8.8.8']);
      replies.osType = 'windows';

      await enable('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('never opens the daemon file when the service does not answer', async () => {
    const before = writeDaemon(['8.8.8.8']);
    // First call resolves the Target IP, the second is the verification query.
    replies.containerOutputs = [TARGET, ''];

    await enable('--yes', '--no-restart');

    expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
    expect(removeServicesMock).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).toContain('DNS_ENABLE=false');
    expect(toolState.readDnsState()).toBeUndefined();
    expect(output()).toContain('never opened');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe('the M5 gate: enable then disable is byte-identical', () => {
    it.each([
      ['an existing array', ['8.8.8.8']],
      ['a user entry the array already had', ['10.0.0.1', '8.8.8.8']],
      ['no dns key at all', undefined]
    ])('%s', async (_label, dns) => {
      const before = writeDaemon(dns as string[] | undefined);

      await enable('--yes', '--no-restart');
      expect(fs.readFileSync(daemonPath, 'utf8')).not.toBe(before);

      await disable('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(toolState.readDnsState()).toBeUndefined();
    });
  });

  it('does not insert a second entry when run twice', async () => {
    writeDaemon(['8.8.8.8']);

    await enable('--yes', '--no-restart');
    const afterFirst = fs.readFileSync(daemonPath, 'utf8');
    await enable('--yes', '--no-restart');

    expect(fs.readFileSync(daemonPath, 'utf8')).toBe(afterFirst);
    expect(JSON.parse(afterFirst).dns).toEqual([TARGET, '8.8.8.8']);
  });
  describe('the daemon fallback (spec 9.7) from the command line', () => {
    // Before this, the only way to set it was `runestone setup` or editing
    // `.env` by hand: `--upstream` had a flag and the fallback had none.
    it('adds the entry named by --fallback at dns[1]', async () => {
      writeDaemon(['8.8.8.8']);

      await enable('--dry-run', '--fallback', '10.0.0.53');

      expect(output()).toContain('10.0.0.53 is added at dns[1]');
      expect(output()).toContain('+ 10.0.0.53');
    });

    it('shows the removal when --no-fallback takes one away', async () => {
      const before = writeDaemon(['8.8.8.8']);

      await enable('--yes', '--no-restart', '--fallback', '1.1.1.1');
      expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual([TARGET, '1.1.1.1', '8.8.8.8']);

      await enable('--dry-run', '--no-fallback');

      // A plan that takes an entry out of the user's daemon file has to say so.
      expect(output()).toContain('- 1.1.1.1');

      // And the whole round trip still lands back on the untouched original.
      await disable('--yes');
      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
    });

    it('writes nothing at all on a dry run, whichever flag was given', async () => {
      const before = writeDaemon([TARGET, '1.1.1.1']);

      await enable('--dry-run', '--fallback', '9.9.9.9');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
    });
  });

  describe('the settings can be answered here, not only passed as flags', () => {
    // The flags are the non-interactive form, not the only form. Reaching
    // `dns enable` without them has to offer the same two questions setup asks,
    // or re-running setup is the only way to change the daemon fallback.
    beforeEach(() => {
      // Jest's stdin is not a TTY, which is exactly what the guard below
      // refuses; these tests are about the terminal case.
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      confirmMock.mockReset().mockResolvedValue(true as never);
      selectMock.mockReset().mockResolvedValue('keep' as never);
      textMock.mockReset().mockResolvedValue('' as never);
      isCancelMock.mockReset().mockReturnValue(false);
    });

    afterEach(() => {
      // Jest workers share one process, so a faked TTY must not outlive this
      // block.
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
    });

    it('applies both answers, to the daemon file and to .env', async () => {
      writeDaemon(['8.8.8.8']);
      selectMock.mockResolvedValue('replace' as never);
      // First text prompt is the upstream list, second the fallback address.
      textMock.mockResolvedValueOnce('10.0.0.1,10.0.0.2' as never).mockResolvedValueOnce('10.0.0.9' as never);

      await enable('--no-restart');

      expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual([TARGET, '10.0.0.9', '8.8.8.8']);

      const env = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');
      expect(env).toContain('DNS_UPSTREAM=10.0.0.1,10.0.0.2');
      expect(env).toContain('DNS_DAEMON_FALLBACK=10.0.0.9');
    });

    it('takes no fallback entry when that answer is no', async () => {
      writeDaemon(['8.8.8.8']);
      confirmMock.mockResolvedValueOnce(false as never).mockResolvedValue(true as never);

      await enable('--no-restart');

      expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual([TARGET, '8.8.8.8']);
      expect(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).toMatch(
        /DNS_DAEMON_FALLBACK=\s*$/m
      );
    });

    it('does not ask again about anything a flag already answered', async () => {
      writeDaemon(['8.8.8.8']);

      await enable('--no-restart', '--upstream', '10.0.0.1', '--no-fallback');

      expect(selectMock).not.toHaveBeenCalled();
      expect(textMock).not.toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual([TARGET, '8.8.8.8']);
    });

    it('asks nothing under --yes, so a script is never left waiting', async () => {
      writeDaemon(['8.8.8.8']);

      await enable('--yes', '--no-restart');

      expect(selectMock).not.toHaveBeenCalled();
      expect(textMock).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it('asks nothing under --dry-run either', async () => {
      writeDaemon(['8.8.8.8']);

      await enable('--dry-run');

      expect(selectMock).not.toHaveBeenCalled();
      expect(textMock).not.toHaveBeenCalled();
    });

    it('writes nothing at all when the question is cancelled', async () => {
      const before = writeDaemon(['8.8.8.8']);
      isCancelMock.mockReturnValueOnce(true);

      await enable('--no-restart');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(toolState.readDnsState()).toBeUndefined();
      expect(upMock).not.toHaveBeenCalled();
    });

    it('refuses off a terminal instead of dying inside a prompt', async () => {
      const before = writeDaemon(['8.8.8.8']);
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

      await enable('--no-restart');

      expect(output()).toContain('--yes');
      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(selectMock).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

});
