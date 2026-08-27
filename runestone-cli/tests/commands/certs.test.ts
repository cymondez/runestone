import { createProgram } from '../../src/cli';
import * as p from '@clack/prompts';
import { listDomainCertificates, removeDomainCertificate } from '../../src/services/cert-manager';
import { installRootCa } from '../../src/services/root-ca-installer';
import { readTraefikSnapshot } from '../../src/services/traefik-api';
import { envLoader } from '../../src/utils/env-loader';

jest.mock('../../src/services/cert-manager', () => ({
  ...jest.requireActual('../../src/services/cert-manager'),
  createDomainCertificate: jest.fn(),
  listDomainCertificates: jest.fn(),
  removeDomainCertificate: jest.fn()
}));

jest.mock('../../src/services/traefik-api', () => ({
  readTraefikSnapshot: jest.fn()
}));

jest.mock('../../src/services/root-ca-installer', () => ({
  installRootCa: jest.fn()
}));

jest.mock('../../src/utils/env-loader', () => ({
  ...jest.requireActual('../../src/utils/env-loader'),
  envLoader: {
    load: jest.fn()
  }
}));

jest.mock('@clack/prompts', () => ({
  confirm: jest.fn(),
  isCancel: jest.fn(() => false),
  cancel: jest.fn()
}));

describe('certs command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let warnSpy: jest.SpyInstance<void, Parameters<typeof console.warn>>;

  const readTraefikSnapshotMock = readTraefikSnapshot as jest.MockedFunction<typeof readTraefikSnapshot>;
  const confirmMock = p.confirm as jest.MockedFunction<typeof p.confirm>;

  beforeEach(() => {
    process.env.RUNESTONE_LANG = 'en';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (envLoader.load as jest.Mock).mockReturnValue({
      HOST_DOMAIN: 'example.test',
      PROJECT_DIR: '/runestone',
      COMPOSE_FILE_PATH: '/runestone/compose.yml'
    });
    readTraefikSnapshotMock.mockResolvedValue({ routers: [], services: [] });
    confirmMock.mockResolvedValue(true);
    (removeDomainCertificate as jest.Mock).mockReturnValue({
      artifacts: {
        domain: 'example.test',
        wildcardHost: '*.example.test',
        certFile: '/runestone/certs/example.test.crt',
        keyFile: '/runestone/certs/example.test.key',
        dynamicConfigFile: '/runestone/configuration/certs/example.test.ssl.yml'
      },
      certificateChanged: true,
      dynamicConfigChanged: true
    });
    (installRootCa as jest.Mock).mockResolvedValue({
      rootCaPath: '/runestone/certs/rootCA.pem',
      aliasResult: { copied: [], warnings: [] },
      nss: {
        certutilPath: '/bundled/certutil',
        imported: [{ dir: '/home/user/.local/share/pki/nssdb', version: 'cert9' }],
        skipped: []
      }
    });
    (listDomainCertificates as jest.Mock).mockReturnValue([
      {
        status: '✓',
        sans: ['*.example.test', 'example.test'],
        issuer: 'Runestone Tests',
        validUntil: '2036-06-13',
        expiry: '3650d',
        certFile: '/runestone/certs/example.test.crt',
        keyFile: '/runestone/certs/example.test.key',
        dynamicConfigFile: '/runestone/configuration/certs/example.test.ssl.yml'
      }
    ]);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete process.env.RUNESTONE_LANG;
    jest.clearAllMocks();
  });

  it('prints certificate list as a table', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'list']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Status');
    expect(output).toContain('SANs');
    expect(output).toContain('Issuer');
    expect(output).toContain('Valid Until');
    expect(output).toContain('Expiry');
    expect(output).toContain('✓');
    expect(output).toContain('*.example.test, example.test');
    expect(output).toContain('Runestone Tests');
  });

  it('supports ls alias and no-header output', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'ls', '--no-header']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).not.toContain('Status');
    expect(output).toContain('✓');
    expect(output).toContain('*.example.test, example.test');
  });

  it('installs the root CA into browser NSS databases', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'install']);

    expect(installRootCa).toHaveBeenCalledWith('/runestone');
    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('/runestone/certs/rootCA.pem');
    expect(output).toContain('/home/user/.local/share/pki/nssdb');
  });

  it('does not import NSS databases on Windows', async () => {
    (installRootCa as jest.Mock).mockResolvedValue({
      rootCaPath: '/runestone/certs/rootCA.pem',
      aliasResult: { copied: [], warnings: [] }
    });
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'i']);

    expect(installRootCa).toHaveBeenCalledWith('/runestone');
    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('/runestone/certs/rootCA.pem');
    expect(output).not.toContain('/home/user/.local/share/pki/nssdb');
  });

  it('asks before removing a certificate still needed by Traefik routes', async () => {
    readTraefikSnapshotMock.mockResolvedValue({
      routers: [
        { name: 'api@file', rule: 'Host(`api.example.test`)' },
        { name: 'admin@file', rule: 'Host(`admin.example.test`)' },
        { name: 'mail@file', rule: 'Host(`mail.example.test`)' },
        { name: 'web@file', rule: 'Host(`web.example.test`)' },
        { name: 'other@file', rule: 'Host(`other.uncovered.test`)' }
      ],
      services: []
    });
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'rm', 'example.test']);

    expect(readTraefikSnapshotMock).toHaveBeenCalledWith('https://traefik.example.test');
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      message: [
        "Certificate 'example.test' is still needed by route(s):",
        '       -  admin.example.test',
        '       -  api.example.test',
        '       -  mail.example.test',
        '          ...',
        '     Remove it anyway?'
      ].join('\n'),
      initialValue: false
    }));
    expect(removeDomainCertificate).toHaveBeenCalledWith('/runestone', 'example.test', { composeFilePath: '/runestone/compose.yml' });
  });

  it('cancels certificate removal when an in-use route is not forced and the user declines', async () => {
    confirmMock.mockResolvedValue(false);
    readTraefikSnapshotMock.mockResolvedValue({
      routers: [{ name: 'api@file', rule: 'Host(`api.example.test`)' }],
      services: []
    });
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'rm', 'example.test']);

    expect(removeDomainCertificate).not.toHaveBeenCalled();
    const output = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Certificate removal cancelled.');
  });

  it('does not ask when another certificate still covers the Traefik route', async () => {
    (listDomainCertificates as jest.Mock).mockReturnValue([
      {
        status: '✓',
        sans: ['*.example.test'],
        issuer: 'Runestone Tests',
        validUntil: '2036-06-13',
        expiry: '3650d',
        certFile: '/runestone/certs/example.test.crt',
        keyFile: '/runestone/certs/example.test.key',
        dynamicConfigFile: '/runestone/configuration/certs/example.test.ssl.yml'
      },
      {
        status: '✓',
        sans: ['*.api.example.test', 'api.example.test'],
        issuer: 'Runestone Tests',
        validUntil: '2036-06-13',
        expiry: '3650d',
        certFile: '/runestone/certs/api.example.test.crt',
        keyFile: '/runestone/certs/api.example.test.key',
        dynamicConfigFile: '/runestone/configuration/certs/api.example.test.ssl.yml'
      }
    ]);
    readTraefikSnapshotMock.mockResolvedValue({
      routers: [{ name: 'api@file', rule: 'Host(`api.example.test`)' }],
      services: []
    });
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'rm', 'example.test']);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(removeDomainCertificate).toHaveBeenCalled();
  });

  it('skips in-use route prompts when removing a certificate with force', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'rm', 'example.test', '--force']);

    expect(readTraefikSnapshotMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(removeDomainCertificate).toHaveBeenCalledWith('/runestone', 'example.test', { composeFilePath: '/runestone/compose.yml' });
  });

  it('does not query Traefik before removing a certificate that is not present', async () => {
    (listDomainCertificates as jest.Mock).mockReturnValue([]);
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'certs', 'rm', 'missing.test']);

    expect(readTraefikSnapshotMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(removeDomainCertificate).toHaveBeenCalledWith('/runestone', 'missing.test', { composeFilePath: '/runestone/compose.yml' });
  });
});
