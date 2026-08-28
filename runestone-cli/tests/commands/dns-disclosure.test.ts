import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { runSetup } from '../../src/commands/setup';
import { composeService } from '../../src/services/docker-compose';
import { DAEMON_PATH_OVERRIDE_ENV } from '../../src/services/dns/daemon-target';
import { restartDocker } from '../../src/services/dns/docker-restart';
import { DNS_STATE_SCHEMA_VERSION, DnsOwnershipState } from '../../src/utils/tool-state';

/**
 * One test per row of the spec 11.3 timing table.
 *
 * The table is the deliverable, not a summary of one: spec 11.3 says the
 * disclosures must be **repeated before every operation that touches global
 * state**, and stating them once during setup and assuming the user remembers is
 * explicitly not acceptable. A test per row is what stops a moment from quietly
 * losing its disclosure later.
 *
 * The two remaining rows — the user documentation and the README — are files
 * rather than moments, and belong to M8.
 */

const mockRendered: string[] = [];
const mockAnswers: unknown[] = [];

jest.mock('@clack/core', () => {
  class FakePrompt {
    private readonly config: Record<string, unknown>;
    options: unknown[];
    cursor = 0;
    value: unknown;
    state = 'initial';

    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.options = (config.options as unknown[]) ?? [];
      this.value = config.initialValue;
    }

    async prompt(): Promise<unknown> {
      mockRendered.push(String((this.config.render as () => string).call(this)));
      return mockAnswers.shift();
    }
  }

  return { TextPrompt: FakePrompt, SelectPrompt: FakePrompt, ConfirmPrompt: FakePrompt };
});

jest.mock('@clack/prompts', () => ({
  ...jest.requireActual('@clack/prompts'),
  intro: jest.fn(),
  outro: jest.fn(),
  cancel: jest.fn(),
  confirm: jest.fn(async () => true),
  isCancel: jest.fn(() => false),
  spinner: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  log: {
    info: jest.fn((message: string) => mockRendered.push(message)),
    warn: jest.fn((message: string) => mockRendered.push(message)),
    error: jest.fn((message: string) => mockRendered.push(message)),
    success: jest.fn((message: string) => mockRendered.push(message)),
    message: jest.fn((message: string) => mockRendered.push(message))
  }
}));

jest.mock('../../src/services/environment-doctor', () => ({
  ...jest.requireActual('../../src/services/environment-doctor'),
  checkEnvironment: jest.fn(() => ({ checks: [], passed: true }))
}));

jest.mock('../../src/services/port-checker', () => ({
  ...jest.requireActual('../../src/services/port-checker'),
  isPortAvailable: jest.fn(async () => true)
}));

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: {
    up: jest.fn(),
    down: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    removeServices: jest.fn(),
    ps: jest.fn(() => [{ Id: '1', Name: 'runestone-dns', State: 'running', Status: 'Up', Service: 'dns' }])
  }
}));

jest.mock('../../src/services/dns/environment', () => ({
  ...jest.requireActual('../../src/services/dns/environment'),
  resolveTargetIp: jest.fn(() => ({ ip: '192.168.65.254' }))
}));

jest.mock('../../src/services/docker-exec', () => ({
  execService: { exec: jest.fn(() => '') }
}));

jest.mock('../../src/services/dns/docker-restart', () => ({
  ...jest.requireActual('../../src/services/dns/docker-restart'),
  restartDocker: jest.fn(() => ({ status: 'restarted', waitedMs: 2000 }))
}));

jest.mock('../../src/utils/docker-checker', () => ({
  dockerChecker: { isInstalled: () => true, composePluginInstalled: () => true }
}));

jest.mock('../../src/services/docker-network', () => ({
  networkService: { exists: () => true, createNetwork: jest.fn(), removeNetwork: jest.fn() }
}));

jest.mock('../../src/services/docker-volume', () => ({
  volumeService: { exists: () => true, createVolume: jest.fn(), removeVolume: jest.fn() }
}));

jest.mock('../../src/services/dns/enable', () => ({
  ...jest.requireActual('../../src/services/dns/enable'),
  preflight: jest.fn(() => ({
    ok: true,
    failures: [],
    targetIp: '192.168.65.254',
    bindIp: '0.0.0.0',
    upstreams: { upstreams: ['10.0.0.53'], origins: [{ value: '10.0.0.53', origin: 'daemon' }] },
    daemonPath: process.env[DAEMON_PATH_OVERRIDE_ENV] ?? '',
    daemonExists: true,
    daemonText: '{}',
    requiresPrivilege: false,
    host: 'docker-desktop',
    upstreamIsFallback: false,
    restartPlan: { host: 'docker-desktop', steps: [], requiresPrivilege: false, source: 'platform' }
  }))
}));

const TARGET = '192.168.65.254';

describe('spec 11.3 disclosure matrix', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let errorSpy: jest.SpyInstance<void, Parameters<typeof console.error>>;
  let exitSpy: jest.SpyInstance;
  let directory: string;
  let projectDir: string;
  let daemonPath: string;
  const saved: Record<string, string | undefined> = {};
  const tracked = [DAEMON_PATH_OVERRIDE_ENV, 'RUNESTONE_TOOL_STATE_PATH', 'RUNESTONE_LANG', 'RUNESTONE_SKIP_SSH_KEYS'];

  function output(): string {
    return [...mockRendered, ...logSpy.mock.calls.map((call) => call.join(' ')), ...errorSpy.mock.calls.map((call) => call.join(' '))].join('\n');
  }

  function writeDaemon(dns: string[]): void {
    fs.writeFileSync(daemonPath, `${JSON.stringify({ dns }, null, 2)}\n`, 'utf8');
  }

  function writeEnv(values: string[]): void {
    fs.writeFileSync(path.join(projectDir, '.env'), `${values.join('\n')}\n`, 'utf8');
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
      upstreams: ['10.0.0.53'],
      updatedAt: '2026-08-27T10:00:00.000Z',
      ...overrides
    };

    fs.writeFileSync(
      process.env.RUNESTONE_TOOL_STATE_PATH as string,
      JSON.stringify({ runestonePath: projectDir, locale: 'en', dns: state }, null, 2),
      'utf8'
    );
  }

  async function run(...args: string[]): Promise<void> {
    await createProgram().parseAsync(['node', 'runestone', ...args]);
  }

  beforeEach(() => {
    mockRendered.length = 0;
    mockAnswers.length = 0;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-disclosure-'));
    projectDir = path.join(directory, 'project');
    fs.mkdirSync(projectDir);
    daemonPath = path.join(directory, 'daemon.json');

    for (const name of tracked) {
      saved[name] = process.env[name];
    }
    process.env[DAEMON_PATH_OVERRIDE_ENV] = daemonPath;
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(directory, 'runestone.config.json');
    process.env.RUNESTONE_LANG = 'en';
    process.env.RUNESTONE_SKIP_SSH_KEYS = '1';

    writeDaemon([TARGET, '10.0.0.53']);
    writeEnv(['HOST_DOMAIN=example.test', 'PREFIX=runestone', 'DNS_ENABLE=true', `DNS_HOST_IP=${TARGET}`]);
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

  describe('setup', () => {
    // A daemon file with a usable resolver already in it, so the computed
    // upstream list comes from a fixture rather than from whatever this machine
    // happens to be using.
    beforeEach(() => {
      writeDaemon(['10.0.0.53']);
    });

    async function driveSetup(): Promise<void> {
      fs.rmSync(path.join(projectDir, '.env'));
      mockAnswers.push(
        'en',
        'local.developers-homelab.net',
        'runestone',
        'web',
        '80',
        'websecure',
        '443',
        '1025',
        false,
        true,
        'keep',
        true,
        true,
        'apply'
      );

      await runSetup({ project: projectDir });
    }

    it('row 1 — the DNS toggle question discloses items 1, 2, 3, 4 and 7 with the real daemon path', async () => {
      await driveSetup();
      const text = output();

      expect(text).toContain(daemonPath);
      expect(text).toContain('terminates every container on this machine');
      expect(text).toContain('pass through the Runestone dns container');
      expect(text).toContain('Port 53 on this host is occupied');
      expect(text).toContain('only the entries Runestone added');
    });

    it('row 2 — the upstream question discloses item 10, with the origin of each value', async () => {
      await driveSetup();
      const text = output();

      expect(text).toContain('is not a Runestone domain is forwarded to these servers');
      expect(text).toContain('10.0.0.53 — found in the Docker daemon configuration');
      expect(text).toContain('a pool, not a priority order');
    });

    it('row 3 — the fallback question gives both directions of the 9.7 table, and advice not a verdict', async () => {
      await driveSetup();
      const text = output();

      expect(text).toContain('What it buys');
      expect(text).toContain('What it costs');
      expect(text).toContain('usually right');
      expect(text).toContain('If unsure, leave it off');
    });

    it('row 4 — the automatic-reordering question states the risk of both modes', async () => {
      await driveSetup();
      const text = output();

      expect(text).toContain('Off: Runestone warns and changes nothing');
      expect(text).toContain('On: Runestone rewrites the daemon configuration on every runestone up');
    });

    it('records the answers and writes no daemon configuration of its own', async () => {
      const before = fs.readFileSync(daemonPath, 'utf8');
      await driveSetup();

      const env = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');
      expect(env).toContain('DNS_UPSTREAM=10.0.0.53');
      expect(env).toContain('DNS_DAEMON_FALLBACK=10.0.0.53');
      expect(env).toContain('DNS_AUTO_REORDER=true');
      // Setup never writes DNS_ENABLE at all. Writing true would claim DNS is on
      // before anything is in the daemon configuration; writing false would
      // silently orphan an entry that is already there. `dns enable` and
      // `dns disable` own that key, because they own the file behind it.
      expect(env).not.toMatch(/^DNS_ENABLE=/m);
      expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
    });
  });

  describe('dns enable', () => {
    it('row 5 — the confirmation before the daemon is modified carries all of items 1 to 11', async () => {
      writeDaemon(['10.0.0.53']);
      await run('dns', 'enable', '--dry-run');
      const text = output();

      // Every item, by its number. Not a sample of them.
      const numbered = text.split('\n').map((row) => row.trim());
      for (let item = 1; item <= 11; item += 1) {
        expect(numbered.some((row) => row.startsWith(`${item}. `))).toBe(true);
      }

      // And with the values actually in effect, not placeholders (spec 11.3).
      expect(text).toContain(daemonPath);
      expect(text).toContain(TARGET);
    });

    it('row 6 — the confirmation before Docker is restarted states that every container is terminated', () => {
      const { t } = jest.requireActual('../../src/i18n') as { t: (key: string) => string };

      expect(t('dns.enable.confirmRestart')).toContain('terminates every container');
    });
  });

  describe('dns status', () => {
    it('row 7 — reports the invasive settings currently in effect', async () => {
      writeRecord();
      await run('dns', 'status');
      const text = output();

      expect(text).toContain(daemonPath);
      expect(text).toContain(TARGET);
    });
  });

  describe('dns disable', () => {
    it('row 8 — the confirmation carries items 2 and 7, and --yes does not suppress it', async () => {
      writeRecord();
      await run('dns', 'disable', '--dry-run');
      const text = output();

      expect(text).toContain('terminates every container on this machine');
      expect(text).toContain('Every other entry keeps its value and its position');
    });
  });

  describe('up', () => {
    it('row 9 — warns with the actual positions when our entry is no longer first', async () => {
      writeDaemon(['10.0.0.53', TARGET]);
      writeRecord({ insertedEntries: [{ role: 'target', value: TARGET, index: 0 }] });

      await run('up');
      const text = output();

      expect(text).toContain('no longer first in the dns array');
      expect(text).toContain(`${TARGET} @ 1`);
      expect(text).toContain('DNS_AUTO_REORDER=true');
    });
  });

  describe('stop', () => {
    it('row 10 — discloses item 5, that the dns service is deliberately left running', async () => {
      await run('stop');
      const text = output();

      expect(text).toContain('deliberately left running');
      expect(composeService.stop).toHaveBeenCalledWith(expect.any(String), {
        services: ['runestone'],
        profiles: []
      });
    });

    it('row 11 — --all discloses items 3 and 5 before anything stops', async () => {
      const stopMock = composeService.stop as jest.MockedFunction<typeof composeService.stop>;
      stopMock.mockClear();

      await run('stop', '--all');
      const text = output();

      expect(text).toContain('disables DNS for every container on this machine');
      expect(text).toContain('Only --all stops the dns service');
      expect(stopMock).toHaveBeenCalledWith(expect.any(String), { services: [], profiles: ['dns'] });
    });
  });

  describe('down', () => {
    it('row 12 — states that the daemon configuration is revoked first and Docker is restarted', async () => {
      writeRecord();

      await run('down', '--yes');
      const text = output();

      expect(text).toContain('are revoked before anything is torn down');
      expect(text).toContain('terminates every container on this machine');
      expect(composeService.down).toHaveBeenCalled();
    });

    it('aborts without destructive cleanup when DNS cannot be disabled', async () => {
      const downMock = composeService.down as jest.MockedFunction<typeof composeService.down>;
      downMock.mockClear();
      // No ownership record: `disable` refuses to guess, so `down` must not run.
      await run('down', '--yes', '--purge');

      expect(downMock).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  /**
   * The other half of the milestone: a user who never enabled DNS must not be
   * able to tell that any of this exists.
   */
  describe('doctor', () => {
    it('reports a DNS failure instead of signing off as passed', async () => {
      // DNS on, nothing recorded: the daemon points nowhere Runestone knows of.
      await run('doctor');
      const text = output();

      expect(text).toContain('Runestone owns nothing in');
      expect(text).toContain('doctor reports only');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('with DNS disabled', () => {
    beforeEach(() => {
      writeEnv(['HOST_DOMAIN=example.test', 'PREFIX=runestone']);
      for (const mock of [composeService.up, composeService.stop, composeService.down]) {
        (mock as jest.Mock).mockClear();
      }
      (restartDocker as jest.Mock).mockClear();
    });

    it('up starts the project without the dns profile and says nothing about DNS', async () => {
      await run('up');

      expect(composeService.up).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ profiles: [] }));
      expect(output()).not.toContain('DNS');
    });

    it('stop stops the whole project, unscoped, exactly as it did before', async () => {
      await run('stop');

      expect(composeService.stop).toHaveBeenCalledWith(expect.any(String), { services: [], profiles: [] });
      expect(output()).not.toContain('DNS');
    });

    it('down tears straight down with no revocation and no Docker restart', async () => {
      await run('down');

      expect(composeService.down).toHaveBeenCalled();
      expect(restartDocker).not.toHaveBeenCalled();
      expect(output()).not.toContain('DNS');
    });

    it('doctor reports nothing about DNS', async () => {
      await run('doctor');

      expect(output()).not.toContain('DNS');
    });
  });

  describe('failed rollback', () => {
    it('row 13 — names the daemon path and the manual recovery steps', () => {
      const { t } = jest.requireActual('../../src/i18n') as {
        t: (key: string, params?: Record<string, string>) => string;
      };

      const message = t('dns.enable.restart.rollbackFailed', { message: 'boom', path: '/etc/docker/daemon.json' });
      expect(message).toContain('/etc/docker/daemon.json');
      expect(message).toContain('remove the entry');
      expect(message).toContain('restart Docker');
    });
  });
});
