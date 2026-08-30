import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { composeService } from '../../src/services/docker-compose';
import { restartDocker } from '../../src/services/dns/docker-restart';
import {
  DAEMON_PATH_OVERRIDE_ENV,
  detectDaemonEnvironment,
  platformDaemonPath
} from '../../src/services/dns/daemon-target';
import { DNS_STATE_SCHEMA_VERSION, DnsOwnershipState, toolState } from '../../src/utils/tool-state';

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: {
    ps: jest.fn(() => []),
    removeServices: jest.fn(),
    restart: jest.fn()
  }
}));

jest.mock('../../src/services/dns/docker-restart', () => ({
  ...jest.requireActual('../../src/services/dns/docker-restart'),
  restartDocker: jest.fn(() => ({ status: 'restarted', waitedMs: 3000 }))
}));

jest.mock('@clack/prompts', () => ({
  ...jest.requireActual('@clack/prompts'),
  confirm: jest.fn(async () => true),
  isCancel: jest.fn(() => false)
}));

const TARGET = '192.168.65.254';
const restartMock = restartDocker as jest.MockedFunction<typeof restartDocker>;
const removeServicesMock = composeService.removeServices as jest.MockedFunction<typeof composeService.removeServices>;

describe('dns disable command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let errorSpy: jest.SpyInstance<void, Parameters<typeof console.error>>;
  let exitSpy: jest.SpyInstance;
  let directory: string;
  let projectDir: string;
  let daemonDir: string;
  let daemonPath: string;
  const saved: Record<string, string | undefined> = {};
  const tracked = [DAEMON_PATH_OVERRIDE_ENV, 'RUNESTONE_TOOL_STATE_PATH', 'RUNESTONE_LANG'];

  function writeDaemon(dns: string[]): string {
    const text = `${JSON.stringify({ dns, experimental: false }, null, 2)}\n`;
    fs.writeFileSync(daemonPath, text, 'utf8');
    return text;
  }

  function writeRecord(overrides: Partial<DnsOwnershipState> = {}): void {
    const state: DnsOwnershipState = {
      schemaVersion: DNS_STATE_SCHEMA_VERSION,
      phase: 'applied',
      contextName: 'desktop-linux',
      daemonPath,
      targetIp: TARGET,
      insertedEntries: [{ role: 'target', value: TARGET, index: 0 }],
      createdDnsKey: false,
      createdDaemonFile: false,
      upstreams: ['8.8.8.8'],
      updatedAt: '2026-08-27T10:00:00.000Z',
      ...overrides
    };

    fs.writeFileSync(
      process.env.RUNESTONE_TOOL_STATE_PATH as string,
      JSON.stringify({ runestonePath: projectDir, locale: 'en', dns: state }, null, 2),
      'utf8'
    );
  }

  function output(): string {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(' ')).join('\n');
  }

  async function run(...args: string[]): Promise<void> {
    await createProgram().parseAsync(['node', 'runestone', 'dns', 'disable', ...args]);
  }

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-disable-'));
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
      `${['HOST_DOMAIN=example.test', 'PREFIX=runestone', 'DNS_ENABLE=true', `DNS_HOST_IP=${TARGET}`].join('\n')}\n`,
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

  it('removes our recorded entry, keeps the rest, and restarts Docker', async () => {
    writeDaemon([TARGET, '8.8.8.8']);
    writeRecord();

    await run('--yes');

    expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual(['8.8.8.8']);
    expect(restartMock).toHaveBeenCalledTimes(1);
    expect(removeServicesMock).toHaveBeenCalledWith(expect.any(String), ['dns'], { profiles: ['dns'] });
    expect(toolState.readDnsState()).toBeUndefined();
    expect(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).toContain('DNS_ENABLE=false');
  });

  it('revokes an entry planted by hand with no ownership record', async () => {
    // The escape hatch M4 exists for: someone put an entry there, Runestone has
    // no record of it, and the user states which one is theirs to remove.
    writeDaemon(['10.0.0.9', '8.8.8.8']);

    await run('--assume-entry', '10.0.0.9', '--yes');

    expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual(['8.8.8.8']);
    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it('resolves an ownership conflict when the user names the position', async () => {
    writeDaemon(['10.0.0.1', TARGET, TARGET]);
    writeRecord();

    await run('--assume-index', '2', '--yes');

    expect(JSON.parse(fs.readFileSync(daemonPath, 'utf8')).dns).toEqual(['10.0.0.1', TARGET]);
  });

  describe('aborting without writing', () => {
    it('refuses when there is no record and nothing was asserted', async () => {
      const before = writeDaemon([TARGET, '8.8.8.8']);

      await run('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(output()).toContain('--assume-entry');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(restartMock).not.toHaveBeenCalled();
    });

    it('refuses on an ownership conflict, and says which positions clash', async () => {
      const before = writeDaemon(['10.0.0.1', TARGET, TARGET]);
      writeRecord();

      await run('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(output()).toContain('--assume-index');
      expect(output()).toContain('1, 2');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('refuses when the record was written against another file', async () => {
      const before = writeDaemon([TARGET]);
      writeRecord({ daemonPath: path.join(daemonDir, 'other.json') });

      await run('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('refuses when the daemon file is not valid JSON', async () => {
      fs.writeFileSync(daemonPath, '{"dns": [', 'utf8');
      writeRecord();

      await run('--yes');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe('{"dns": [');
      expect(output()).toContain('not valid JSON');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('treats an entry the user already removed as revoked, without restarting', async () => {
    const before = writeDaemon(['8.8.8.8']);
    writeRecord();

    await run('--yes');

    expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
    expect(restartMock).not.toHaveBeenCalled();
    expect(toolState.readDnsState()).toBeUndefined();
    expect(output()).toContain('already gone');
  });

  describe('--dry-run', () => {
    it('writes nothing and touches nothing', async () => {
      const before = writeDaemon([TARGET, '8.8.8.8']);
      writeRecord();

      await run('--dry-run');

      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
      expect(restartMock).not.toHaveBeenCalled();
      expect(removeServicesMock).not.toHaveBeenCalled();
      expect(toolState.readDnsState()).toBeDefined();
      expect(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).toContain('DNS_ENABLE=true');
    });

    it('prints the same plan a real run then carries out', async () => {
      writeDaemon([TARGET, '8.8.8.8']);
      writeRecord();

      await run('--dry-run');
      const dryRun = output().split('\n').filter((row) => row.startsWith('  '));

      logSpy.mockClear();
      errorSpy.mockClear();
      await run('--yes');
      const real = output().split('\n').filter((row) => row.startsWith('  '));

      // The plan is printed by the same code in both runs; the real run then
      // adds its result lines underneath.
      expect(real.slice(0, dryRun.length)).toEqual(dryRun);
      expect(dryRun.some((row) => row.includes(`- ${TARGET}`))).toBe(true);
    });
  });

  it('leaves the platform daemon file alone, whatever it does', async () => {
    // The gate for this milestone: everything is exercised through the redirected
    // path, and the file a real machine actually uses is never opened for writing.
    const platformPath = platformDaemonPath(detectDaemonEnvironment());
    const existedBefore = fs.existsSync(platformPath);
    const contentBefore = existedBefore ? fs.readFileSync(platformPath, 'utf8') : undefined;

    writeDaemon([TARGET, '8.8.8.8']);
    writeRecord();
    await run('--yes');

    expect(fs.existsSync(platformPath)).toBe(existedBefore);
    if (existedBefore) {
      expect(fs.readFileSync(platformPath, 'utf8')).toBe(contentBefore);
    }
  });
});
