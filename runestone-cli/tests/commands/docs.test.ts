import { createProgram } from '../../src/cli';
import { composeService } from '../../src/services/docker-compose';
import { readTraefikSnapshot } from '../../src/services/traefik-api';
import { listDomainCertificates } from '../../src/services/cert-manager';
import { envLoader } from '../../src/utils/env-loader';
import { testEnv } from '../helpers/env';

jest.mock('../../src/services/traefik-api', () => ({
  ...jest.requireActual('../../src/services/traefik-api'),
  readTraefikSnapshot: jest.fn()
}));

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: { ps: jest.fn() }
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

const psMock = composeService.ps as jest.Mock;
const traefikMock = readTraefikSnapshot as jest.Mock;
const certsMock = listDomainCertificates as jest.Mock;

async function run(...args: string[]) {
  await createProgram().parseAsync(['node', 'runestone', 'docs', ...args]);
}

describe('docs --ai-context', () => {
  let stdout: jest.SpyInstance;

  beforeEach(() => {
    // The command signals failure with process.exitCode rather than
    // process.exit, so it has to be reset between tests or one failure leaks
    // into the next assertion.
    process.exitCode = undefined;
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    (envLoader.load as jest.Mock).mockReturnValue(
      testEnv('/tmp/runestone-docs-test', { HOST_DOMAIN: 'example.test', PREFIX: 'mylab' })
    );
    (envLoader.hasRequiredVars as jest.Mock).mockReturnValue(true);
    certsMock.mockReturnValue([]);
    psMock.mockReturnValue([]);
    traefikMock.mockResolvedValue({ routers: [], services: [] });
  });

  afterEach(() => {
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  function output(): string {
    return stdout.mock.calls.map((call) => String(call[0])).join('');
  }

  describe.each(['compose', 'service', 'troubleshoot', 'overview'])('the %s topic', (topic) => {
    it('reaches neither Docker nor Traefik, even without --offline', async () => {
      // This is the hot path: an agent may call it on every task, so it must
      // not wait on a cold daemon. The tier is a property of the topic, so no
      // flag should be needed to get this behaviour — which is exactly why it
      // is asserted without one.
      await run('--ai-context', topic);

      expect(psMock).not.toHaveBeenCalled();
      expect(traefikMock).not.toHaveBeenCalled();
      expect(output().length).toBeGreaterThan(0);
      expect(process.exitCode).toBeUndefined();
    });
  });

  it('the state topic reaches both, because that is the only reason it exists', async () => {
    await run('--ai-context', 'state');

    expect(psMock).toHaveBeenCalledTimes(1);
    expect(traefikMock).toHaveBeenCalledTimes(1);
    expect(traefikMock).toHaveBeenCalledWith('https://traefik.example.test');
  });

  it('--offline forces the state topic to read files only', async () => {
    await run('--ai-context', 'state', '--offline');

    expect(psMock).not.toHaveBeenCalled();
    expect(traefikMock).not.toHaveBeenCalled();
    // Still a usable document, and it says the facts were not checked rather
    // than implying nothing is registered.
    expect(output()).toContain('were not checked');
  });

  it('bounds the container probe, rather than inheriting the thirty-second default', async () => {
    await run('--ai-context', 'state');

    expect(psMock).toHaveBeenCalledWith(expect.any(String), 8000);
  });

  it('reports every registered router so an agent can avoid a collision', async () => {
    traefikMock.mockResolvedValue({
      routers: [{ name: 'someone-else@docker', rule: 'Host(`taken.example.test`)' }],
      services: [{ name: 'someone-else@docker' }]
    });

    await run('--ai-context', 'state');

    expect(output()).toContain('someone-else@docker');
  });

  it('still produces a document when Docker is down', async () => {
    psMock.mockImplementation(() => {
      throw new Error('Cannot connect to the Docker daemon');
    });

    await run('--ai-context', 'state');

    expect(process.exitCode).toBeUndefined();
    expect(output()).toContain('Docker could not be reached');
  });

  it('refuses to imply a name is free when Traefik is unreachable', async () => {
    traefikMock.mockRejectedValue(new Error('socket hang up'));

    await run('--ai-context', 'state');

    expect(process.exitCode).toBeUndefined();
    expect(output()).toContain('unverified rather than free');
  });

  it('writes nothing and exits 1 on an unknown topic', async () => {
    await run('--ai-context', 'nope');

    expect(process.exitCode).toBe(1);
    expect(output()).toBe('');
  });

  it('writes nothing and exits 1 when Runestone is not configured', async () => {
    (envLoader.hasRequiredVars as jest.Mock).mockReturnValue(false);

    await run('--ai-context', 'state');

    expect(process.exitCode).toBe(1);
    expect(output()).toBe('');
    // The gate comes before the probes: an unconfigured machine must not pay
    // for Docker just to be told to run setup.
    expect(psMock).not.toHaveBeenCalled();
    expect(traefikMock).not.toHaveBeenCalled();
  });

  it('treats a bare --ai-context as the compose topic', async () => {
    await run('--ai-context');

    expect(output()).toContain('# Runestone AI Compose Context');
    expect(psMock).not.toHaveBeenCalled();
  });
});
