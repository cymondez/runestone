import * as path from 'path';
import { AgentContextSnapshot, SnapshotCertificate, SnapshotContainer, SnapshotService } from '../../src/services/agent-context/snapshot';
import { StatusReportDependencies, buildStatusReport } from '../../src/services/status-report';
import { DnsOwnershipState } from '../../src/utils/tool-state';
import { testEnv } from '../helpers/env';

const config = (overrides = {}) =>
  testEnv(path.join('/tmp', 'runestone-status-report'), { HOST_DOMAIN: 'example.test', PREFIX: 'mylab', ...overrides });

const running = (service: string, name = service): SnapshotContainer => ({ name, service, state: 'running', status: 'Up 1 hour' });

function certificate(overrides: Partial<SnapshotCertificate> = {}): SnapshotCertificate {
  return { sans: ['*.example.test'], valid: true, issuer: 'test CA', validUntil: '2030-01-01', expiresIn: '1000d', ...overrides };
}

function route(overrides: Partial<SnapshotService> = {}): SnapshotService {
  return {
    name: 'api',
    route: 'api.example.test',
    url: 'http://host.docker.internal:3000',
    group: null,
    dynamicConfigExists: true,
    certificateCovered: true,
    ...overrides
  };
}

function snapshot(overrides: Partial<AgentContextSnapshot> = {}): AgentContextSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-14T00:00:00.000Z',
    probeMode: 'live',
    configured: true,
    environment: {} as AgentContextSnapshot['environment'],
    domains: { hostDomain: 'example.test', covered: [], wildcards: ['*.example.test'] },
    certificates: [certificate()],
    services: [],
    usedNames: { serviceNames: [], routes: [] },
    dns: { enabled: false },
    containers: { ok: true, value: [running('runestone')] },
    traefik: { ok: true, value: { routers: [{ name: 'other@docker', provider: 'docker', rule: null }], services: [] } },
    warnings: [],
    ...overrides
  };
}

function deps(overrides: Partial<StatusReportDependencies> = {}, snap: AgentContextSnapshot = snapshot()): Partial<StatusReportDependencies> {
  return {
    isConfigured: () => true,
    snapshot: async () => snap,
    networkExists: () => true,
    volumeExists: () => true,
    listSshKeys: () => ['id_ed25519'],
    readDnsRecord: () => undefined,
    now: () => new Date('2026-10-14T00:00:00.000Z'),
    cliVersion: () => '9.9.9',
    ...overrides
  };
}

describe('the status report', () => {
  beforeEach(() => {
    process.env.RUNESTONE_LANG = 'en';
  });

  afterEach(() => {
    delete process.env.RUNESTONE_LANG;
  });

  it('is ready when Runestone runs and nothing needs attention', async () => {
    const report = await buildStatusReport(config(), deps());

    expect(report.verdict).toBe('ready');
    expect(report.problems).toEqual([]);
    expect(report.provides).toEqual({
      traefikDashboard: 'https://traefik.example.test',
      mailpitUi: 'https://mailpit.example.test',
      smtp: { fromHost: 'localhost:1025', fromRunestoneNetwork: 'mylab:1025', fromOtherContainers: 'host.docker.internal:1025' }
    });
    expect(report.traefikRouters).toEqual(['other@docker']);
  });

  it('says setup is needed, and asks Docker nothing, when Runestone is not configured', async () => {
    const snapshotSpy = jest.fn();
    const report = await buildStatusReport(config(), deps({ isConfigured: () => false, snapshot: snapshotSpy }));

    expect(report.verdict).toBe('not-configured');
    expect(report.problems).toEqual([expect.objectContaining({ fix: 'runestone setup' })]);
    expect(snapshotSpy).not.toHaveBeenCalled();
  });

  it('does not report the network or volume as missing when Docker could not be asked', async () => {
    // With the daemon down every existence check comes back false, and
    // "missing" would send the reader to fix the wrong thing.
    const networkExists = jest.fn(() => false);
    const report = await buildStatusReport(
      config(),
      deps({ networkExists }, snapshot({ containers: { ok: false, reason: 'unavailable', message: 'Cannot connect to the Docker daemon' } }))
    );

    expect(report.verdict).toBe('docker-unreachable');
    expect(report.network.exists).toBeNull();
    expect(report.sshKeys).toBeNull();
    expect(networkExists).not.toHaveBeenCalled();
    expect(report.problems[0].text).toContain('Cannot connect to the Docker daemon');
  });

  it('is stopped when the runestone container is not running, and says to run up', async () => {
    const report = await buildStatusReport(
      config(),
      deps({}, snapshot({ containers: { ok: true, value: [] }, traefik: { ok: false, reason: 'unavailable', message: 'ECONNREFUSED' } }))
    );

    expect(report.verdict).toBe('stopped');
    expect(report.problems.map((problem) => problem.fix)).toContain('runestone up');
    // Traefik cannot answer while Runestone is stopped; that is the same
    // problem, not a second one.
    expect(report.problems.map((problem) => problem.text).join(' ')).not.toContain("Traefik's API");
  });

  it.each([
    ['the network is missing', deps({ networkExists: () => false }), 'runestone up'],
    [
      'Traefik does not answer',
      deps({}, snapshot({ traefik: { ok: false, reason: 'unavailable', message: 'timed out' } })),
      'runestone up --force-recreate'
    ],
    [
      'DNS is on but its service is not running',
      deps({}, snapshot({ dns: { enabled: true } })),
      'runestone up'
    ],
    ['no certificate exists', deps({}, snapshot({ certificates: [] })), 'runestone certs create example.test'],
    [
      'a certificate is expired',
      deps({}, snapshot({ certificates: [certificate(), certificate({ sans: ['*.old.test'], valid: false })] })),
      'runestone certs create old.test'
    ],
    [
      'a route has no Traefik file',
      deps({}, snapshot({ services: [route({ dynamicConfigExists: false })] })),
      'runestone service repair api'
    ],
    [
      'no certificate covers a route',
      deps({}, snapshot({ services: [route({ route: 'api.other.test', certificateCovered: false })] })),
      'runestone certs create other.test'
    ]
  ])('is degraded when %s, with the command that fixes it', async (_name, dependencies, fix) => {
    const report = await buildStatusReport(config({ DNS_ENABLE: _name.startsWith('DNS') ? 'true' : 'false' }), dependencies);

    expect(report.verdict).toBe('degraded');
    expect(report.problems.map((problem) => problem.fix).join('\n')).toContain(fix);
  });

  it('separates DNS written but not yet in effect from DNS left unfinished', async () => {
    const record = (preparedReason?: DnsOwnershipState['preparedReason']) => (): DnsOwnershipState => ({
      schemaVersion: 1,
      phase: 'prepared',
      preparedReason,
      contextName: 'desktop-linux',
      daemonPath: '/tmp/daemon.json',
      targetIp: '192.168.65.254',
      insertedEntries: [],
      createdDnsKey: false,
      createdDaemonFile: false,
      upstreams: [],
      updatedAt: '2026-10-14T00:00:00.000Z'
    });
    const withDns = snapshot({ dns: { enabled: true }, containers: { ok: true, value: [running('runestone'), running('dns', 'mylab-dns')] } });

    const pending = await buildStatusReport(config({ DNS_ENABLE: 'true' }), deps({ readDnsRecord: record('no-restart') }, withDns));
    expect(pending.problems[0].fix).toContain('Restart Docker');

    const unfinished = await buildStatusReport(config({ DNS_ENABLE: 'true' }), deps({ readDnsRecord: record('rollback-failed') }, withDns));
    expect(unfinished.problems[0].fix).toBe('runestone dns status');
  });

  it('gives every problem a fix', async () => {
    const report = await buildStatusReport(
      config({ DNS_ENABLE: 'true' }),
      deps(
        { networkExists: () => false },
        snapshot({
          dns: { enabled: true },
          certificates: [certificate({ valid: false })],
          services: [route({ dynamicConfigExists: false, certificateCovered: false })],
          traefik: { ok: false, reason: 'unavailable', message: 'timed out' }
        })
      )
    );

    expect(report.problems.length).toBeGreaterThan(4);
    for (const problem of report.problems) {
      expect(problem.text.trim()).not.toBe('');
      expect(problem.fix.trim()).not.toBe('');
    }
  });

  it('is plain JSON, so `status --json` publishes it unchanged', async () => {
    const report = await buildStatusReport(config(), deps());

    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('prints nothing itself', async () => {
    const stdout = jest.spyOn(process.stdout, 'write');
    const stderr = jest.spyOn(process.stderr, 'write');

    await buildStatusReport(config(), deps());

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });
});

describe('the status report and the DNS web UI', () => {
  beforeEach(() => {
    process.env.RUNESTONE_LANG = 'en';
  });

  afterEach(() => {
    delete process.env.RUNESTONE_LANG;
  });

  const withDns = snapshot({
    dns: { enabled: true },
    containers: { ok: true, value: [running('runestone'), running('dns', 'mylab-dns')] }
  });

  it('flags a DNS web UI without authentication, with the setting that fixes it', async () => {
    // `dns status` disclosed this while `status` said "ready".
    const report = await buildStatusReport(
      config({ DNS_ENABLE: 'true', DNS_UI_ENABLE: 'true', DNS_UI_USER: '', DNS_UI_PASS: '' }),
      deps({}, withDns)
    );

    expect(report.verdict).toBe('degraded');
    expect(report.problems).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('https://dns.example.test'),
        fix: expect.stringContaining('DNS_UI_USER and DNS_UI_PASS')
      })
    ]);
  });

  it.each([
    ['credentials are set', { DNS_UI_ENABLE: 'true', DNS_UI_USER: 'me', DNS_UI_PASS: 'secret' }],
    ['the UI is off', { DNS_UI_ENABLE: 'false', DNS_UI_USER: '', DNS_UI_PASS: '' }]
  ])('says nothing about the UI when %s', async (_name, settings) => {
    const report = await buildStatusReport(config({ DNS_ENABLE: 'true', ...settings }), deps({}, withDns));

    expect(report.verdict).toBe('ready');
  });
});
