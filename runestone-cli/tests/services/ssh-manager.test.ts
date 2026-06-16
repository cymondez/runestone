import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sshManager } from '../../src/services/ssh-manager';
import { runService } from '../../src/services/docker-run';
import { volumeService } from '../../src/services/docker-volume';

jest.mock('../../src/services/docker-run', () => ({
  runService: {
    run: jest.fn()
  }
}));

jest.mock('../../src/services/docker-volume', () => ({
  volumeService: {
    exists: jest.fn(),
    createVolume: jest.fn()
  }
}));

jest.mock('../../src/utils/os-detector', () => ({
  osDetector: {
    sshDir: jest.fn()
  }
}));

const runMock = runService.run as jest.MockedFunction<typeof runService.run>;
const existsMock = volumeService.exists as jest.MockedFunction<typeof volumeService.exists>;
const createVolumeMock = volumeService.createVolume as jest.MockedFunction<typeof volumeService.createVolume>;

describe('sshManager', () => {
  let tempDir: string;
  let sshDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-ssh-'));
    sshDir = path.join(tempDir, '.ssh');
    fs.mkdirSync(sshDir);
    jest.requireMock('../../src/utils/os-detector').osDetector.sshDir.mockReturnValue(sshDir);
    runMock.mockReturnValue('');
    existsMock.mockReturnValue(true);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('scans supported private keys from the home SSH directory', () => {
    fs.writeFileSync(path.join(sshDir, 'id_ed25519'), 'private');
    fs.writeFileSync(path.join(sshDir, 'id_ed25519.pub'), 'public');
    fs.writeFileSync(path.join(sshDir, 'config'), 'config');

    expect(sshManager.scanHomeDirectory()).toEqual([path.join(sshDir, 'id_ed25519')]);
  });

  it('adds private and public key files to the configured Docker volume', () => {
    const keyPath = path.join(sshDir, 'id_rsa');
    fs.writeFileSync(keyPath, 'private-key');
    fs.writeFileSync(`${keyPath}.pub`, 'public-key');
    existsMock.mockReturnValue(false);

    expect(sshManager.addKey(keyPath, 'custom-ssh')).toBe(true);

    expect(createVolumeMock).toHaveBeenCalledWith('custom-ssh');
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock).toHaveBeenCalledWith(
      'alpine:latest',
      expect.arrayContaining(['sh', '-c']),
      expect.objectContaining({
        interactive: true,
        input: 'private-key',
        volumes: [{ source: 'custom-ssh', target: '/root/.ssh' }]
      })
    );
  });

  it('lists injected keys from the Docker volume', () => {
    runMock.mockReturnValue('id_rsa\nid_ed25519\n');

    expect(sshManager.listKeys('runestone-ssh')).toEqual(['id_rsa', 'id_ed25519']);
  });

  it('rejects unsupported key filenames', () => {
    const keyPath = path.join(sshDir, 'deploy.pem');
    fs.writeFileSync(keyPath, 'private');

    expect(() => sshManager.addKey(keyPath)).toThrow('not a supported SSH private key name');
  });
});
