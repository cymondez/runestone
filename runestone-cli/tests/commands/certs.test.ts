import { createProgram } from '../../src/cli';
import { listDomainCertificates } from '../../src/services/cert-manager';
import { envLoader } from '../../src/utils/env-loader';

jest.mock('../../src/services/cert-manager', () => ({
  createDomainCertificate: jest.fn(),
  listDomainCertificates: jest.fn(),
  removeDomainCertificate: jest.fn()
}));

jest.mock('../../src/utils/env-loader', () => ({
  envLoader: {
    load: jest.fn()
  }
}));

describe('certs command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    (envLoader.load as jest.Mock).mockReturnValue({ PROJECT_DIR: '/runestone' });
    (listDomainCertificates as jest.Mock).mockReturnValue([
      {
        status: '✓',
        sans: ['*.example.test', 'example.test'],
        issuer: 'Runestone Tests',
        validUntil: '2036-06-13',
        expiry: '3650d',
        certFile: '/runestone/certs/example.test.crt',
        keyFile: '/runestone/certs/example.test.key',
        dynamicConfigFile: '/runestone/configuration/traefik/dynamic/example.test.ssl.yml'
      }
    ]);
  });

  afterEach(() => {
    logSpy.mockRestore();
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
});
