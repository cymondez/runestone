import { createProgram } from '../../src/cli';
import { composeService } from '../../src/services/docker-compose';
import { networkService } from '../../src/services/docker-network';
import { sshManager } from '../../src/services/ssh-manager';
import { volumeService } from '../../src/services/docker-volume';

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

describe('status command', () => {
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let errorSpy: jest.SpyInstance<void, Parameters<typeof console.error>>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (composeService.ps as jest.Mock).mockReturnValue([
      { Id: '1', Name: 'runestone', State: 'running', Status: 'Up', Service: 'runestone' }
    ]);
    (sshManager.listKeys as jest.Mock).mockReturnValue(['id_ed25519']);
    (networkService.exists as jest.Mock).mockReturnValue(true);
    (volumeService.exists as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints containers, injected keys, network, and volume state', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'status']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('runestone');
    expect(output).toContain('id_ed25519');
    expect(output).toContain('runestone-network');
    expect(output).toContain('runestone-ssh');
  });
});
