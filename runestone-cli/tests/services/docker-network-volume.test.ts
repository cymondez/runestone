import { spawnSync } from 'child_process';
import { networkService } from '../../src/services/docker-network';
import { volumeService } from '../../src/services/docker-volume';

jest.mock('child_process', () => ({
  spawnSync: jest.fn()
}));

const spawnSyncMock = spawnSync as jest.MockedFunction<typeof spawnSync>;

function result(status: number, stdout = '', stderr = '') {
  return {
    status,
    stdout,
    stderr,
    pid: 1,
    output: [null, stdout, stderr],
    signal: null
  };
}

describe('docker network and volume services', () => {
  beforeEach(() => {
    spawnSyncMock.mockReturnValue(result(0, 'ok') as never);
  });

  it('checks network existence with docker inspect', () => {
    expect(networkService.exists('runestone-network')).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith('docker', ['network', 'inspect', 'runestone-network'], expect.any(Object));
  });

  it('creates a named bridge network', () => {
    networkService.createNetwork('runestone-network');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'docker',
      ['network', 'create', '--driver', 'bridge', 'runestone-network'],
      expect.any(Object)
    );
  });

  it('checks volume existence with docker inspect', () => {
    expect(volumeService.exists('runestone-ssh')).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith('docker', ['volume', 'inspect', 'runestone-ssh'], expect.any(Object));
  });

  it('creates a named volume', () => {
    volumeService.createVolume('runestone-ssh');
    expect(spawnSyncMock).toHaveBeenCalledWith('docker', ['volume', 'create', 'runestone-ssh'], expect.any(Object));
  });
});
