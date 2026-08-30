import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { composeService } from '../../src/services/docker-compose';
import { DAEMON_PATH_OVERRIDE_ENV } from '../../src/services/dns/daemon-target';
import { DNS_STATE_SCHEMA_VERSION, DnsOwnershipState } from '../../src/utils/tool-state';

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: {
    ps: jest.fn(() => [])
  }
}));

const TARGET = '192.168.65.254';

describe('dns command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let errorSpy: jest.SpyInstance<void, Parameters<typeof console.error>>;
  let directory: string;
  let projectDir: string;
  let daemonDir: string;
  let daemonPath: string;
  const saved: Record<string, string | undefined> = {};

  function remember(name: string): void {
    saved[name] = process.env[name];
  }

  function restore(name: string): void {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }

  function writeDaemon(dns: string[]): void {
    fs.writeFileSync(daemonPath, `${JSON.stringify({ dns, experimental: false }, null, 2)}\n`, 'utf8');
  }

  function writeState(dns?: DnsOwnershipState): void {
    fs.writeFileSync(
      process.env.RUNESTONE_TOOL_STATE_PATH as string,
      JSON.stringify({ runestonePath: projectDir, locale: 'en', ...(dns ? { dns } : {}) }, null, 2),
      'utf8'
    );
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
      upstreams: ['1.0.0.1'],
      updatedAt: '2026-08-27T10:00:00.000Z',
      ...overrides
    };

    writeState(state);
  }

  function output(): string {
    return logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-dns-cmd-'));
    projectDir = path.join(directory, 'project');
    daemonDir = path.join(directory, 'docker');
    fs.mkdirSync(projectDir);
    fs.mkdirSync(daemonDir);
    daemonPath = path.join(daemonDir, 'daemon.json');

    for (const name of [DAEMON_PATH_OVERRIDE_ENV, 'RUNESTONE_TOOL_STATE_PATH', 'RUNESTONE_LANG']) {
      remember(name);
    }
    process.env[DAEMON_PATH_OVERRIDE_ENV] = daemonPath;
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(directory, 'runestone.config.json');
    process.env.RUNESTONE_LANG = 'en';

    // A self-contained project, so the test never reads the developer's own
    // ~/.runestone/.env and can state the DNS settings it needs.
    fs.writeFileSync(
      path.join(projectDir, '.env'),
      `${['HOST_DOMAIN=example.test', 'PREFIX=runestone', 'DNS_ENABLE=true', `DNS_HOST_IP=${TARGET}`].join('\n')}\n`,
      'utf8'
    );
    writeState();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    for (const name of [DAEMON_PATH_OVERRIDE_ENV, 'RUNESTONE_TOOL_STATE_PATH', 'RUNESTONE_LANG']) {
      restore(name);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function runStatus(): Promise<void> {
    await createProgram().parseAsync(['node', 'runestone', 'dns', 'status']);
  }

  it('reports every section, with the real daemon path rather than a placeholder', async () => {
    writeDaemon([TARGET, '8.8.8.8']);

    await runStatus();

    const printed = output();
    expect(printed).toContain(daemonPath);
    expect(printed).toContain('Upstream DNS');
    expect(printed).toContain('Daemon fallback entry');
    expect(printed).toContain('Web UI');
    expect(printed).toContain('None. Runestone owns nothing');
    expect(printed).toContain('DNS is enabled');
    expect(printed).toContain('https://dns.example.test');
  });

  it('reports loudly that a development override is in effect', async () => {
    writeDaemon([TARGET]);

    await runStatus();

    expect(output()).toContain(DAEMON_PATH_OVERRIDE_ENV);
    expect(output()).toContain('writing to the wrong file');
  });

  it('warns when our entry is no longer consulted first', async () => {
    writeDaemon(['10.0.0.1', TARGET]);
    writeRecord();

    await runStatus();

    expect(output()).toContain('no longer consulted first');
    expect(output()).toContain('Automatic reordering is off');
  });

  it('says a prepared record is waiting for a restart rather than calling it an error', async () => {
    writeDaemon([TARGET]);
    writeRecord({ phase: 'prepared', preparedReason: 'no-restart' });

    await runStatus();

    expect(output()).toContain('waiting for a Docker restart');
    expect(output()).not.toContain('rollback');
  });

  it('says a failed rollback needs manual recovery', async () => {
    writeDaemon([TARGET]);
    writeRecord({ phase: 'prepared', preparedReason: 'rollback-failed' });

    await runStatus();

    expect(output()).toContain('rollback failed');
  });

  it('reports a duplicate entry the user added', async () => {
    writeDaemon([TARGET, '8.8.8.8', TARGET]);
    writeRecord();

    await runStatus();

    expect(output()).toContain('does not own');
  });

  it('writes nothing', async () => {
    writeDaemon([TARGET]);
    const before = fs.readFileSync(daemonPath, 'utf8');

    await runStatus();

    expect(fs.readFileSync(daemonPath, 'utf8')).toBe(before);
    expect(fs.readdirSync(daemonDir)).toEqual(['daemon.json']);
  });

  it('does not ask docker for anything but the container list', async () => {
    writeDaemon([TARGET]);

    await runStatus();

    expect(composeService.ps as jest.Mock).toHaveBeenCalledTimes(1);
    expect(Object.keys(composeService)).toEqual(['ps']);
  });
});
