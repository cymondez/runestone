import { createProgram } from '../../src/cli';
import { listDomainCertificates } from '../../src/services/cert-manager';
import { composeService } from '../../src/services/docker-compose';
import { networkService } from '../../src/services/docker-network';
import { sshManager } from '../../src/services/ssh-manager';
import { readTraefikSnapshot } from '../../src/services/traefik-api';
import { volumeService } from '../../src/services/docker-volume';
import { envLoader } from '../../src/utils/env-loader';
import { testEnv } from '../helpers/env';

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: {
    ps: jest.fn()
  }
}));

jest.mock('../../src/services/docker-network', () => ({
  networkService: {
    exists: jest.fn()
  }
}));

jest.mock('../../src/services/docker-volume', () => ({
  volumeService: {
    exists: jest.fn()
  }
}));

jest.mock('../../src/services/ssh-manager', () => ({
  sshManager: {
    listKeys: jest.fn()
  }
}));

jest.mock('../../src/services/traefik-api', () => ({
  ...jest.requireActual('../../src/services/traefik-api'),
  readTraefikSnapshot: jest.fn()
}));

jest.mock('../../src/services/cert-manager', () => ({
  ...jest.requireActual('../../src/services/cert-manager'),
  listDomainCertificates: jest.fn()
}));

jest.mock('../../src/utils/env-loader', () => ({
  ...jest.requireActual('../../src/utils/env-loader'),
  envLoader: {
    ...jest.requireActual('../../src/utils/env-loader').envLoader,
    load: jest.fn(),
    hasRequiredVars: jest.fn()
  }
}));

describe('status command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.RUNESTONE_LANG = 'en';
    process.exitCode = undefined;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    (envLoader.load as jest.Mock).mockReturnValue(
      testEnv('/tmp/runestone-status-test', { HOST_DOMAIN: 'example.test', PREFIX: 'runestone', NETWORK_NAME: 'runestone-network' })
    );
    (envLoader.hasRequiredVars as jest.Mock).mockReturnValue(true);
    (composeService.ps as jest.Mock).mockReturnValue([
      { Id: '1', Name: 'runestone', State: 'running', Status: 'Up', Service: 'runestone' }
    ]);
    (sshManager.listKeys as jest.Mock).mockReturnValue(['id_ed25519']);
    (networkService.exists as jest.Mock).mockReturnValue(true);
    (volumeService.exists as jest.Mock).mockReturnValue(true);
    (readTraefikSnapshot as jest.Mock).mockResolvedValue({ routers: [{ name: 'traefik@file' }], services: [] });
    (listDomainCertificates as jest.Mock).mockReturnValue([
      {
        status: '✓',
        sans: ['*.example.test'],
        issuer: 'test CA',
        validUntil: '2030-01-01',
        expiry: '1000d',
        certFile: '',
        keyFile: '',
        dynamicConfigFile: ''
      }
    ]);
  });

  afterEach(() => {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    delete process.env.RUNESTONE_LANG;
    process.exitCode = undefined;
  });

  function lines(): string[] {
    // eslint-disable-next-line no-control-regex
    return logSpy.mock.calls.map((call) => call.join(' ').replace(/\x1b\[[0-9;]*m/g, ''));
  }

  it('answers on the first line whether Runestone can be used', async () => {
    await createProgram().parseAsync(['node', 'runestone', 'status']);

    expect(lines()[0]).toBe('[ok] Runestone is ready: https://traefik.example.test');
  });

  it('prints containers, network, volume, SSH keys, and what Runestone provides', async () => {
    await createProgram().parseAsync(['node', 'runestone', 'status']);

    const output = lines().join('\n');
    expect(output).toContain('runestone');
    expect(output).toContain('id_ed25519');
    expect(output).toContain('https://mailpit.example.test');
    expect(output).toContain('localhost:1025');
    expect(output).toContain('runestone:1025');
    expect(output).toContain('host.docker.internal:1025');
  });

  it('says a network exists rather than that it is running', async () => {
    await createProgram().parseAsync(['node', 'runestone', 'status']);

    const network = lines().find((line) => line.includes('runestone-network') && !line.includes('SMTP'));
    expect(network).toContain('exists');
    expect(network).not.toContain('running');
  });

  it('says Runestone is stopped, and how to start it, when the container is not running', async () => {
    (composeService.ps as jest.Mock).mockReturnValue([]);
    (readTraefikSnapshot as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await createProgram().parseAsync(['node', 'runestone', 'status']);

    const output = lines();
    expect(output[0]).toContain('Runestone is not running');
    expect(output.join('\n')).toContain('Fix: runestone up');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the report as JSON with --json, and nothing else', async () => {
    await createProgram().parseAsync(['node', 'runestone', 'status', '--json']);

    const written = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    const report = JSON.parse(written);
    expect(report.verdict).toBe('ready');
    expect(report.provides.smtp.fromHost).toBe('localhost:1025');
    expect(logSpy).not.toHaveBeenCalled();
  });
});
