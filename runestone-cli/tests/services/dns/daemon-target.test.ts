import * as os from 'os';
import * as path from 'path';
import {
  DAEMON_PATH_OVERRIDE_ENV,
  RESTART_CMD_OVERRIDE_ENV,
  activeOverrides,
  detectDaemonEnvironment,
  parseRestartCommand,
  platformDaemonPath,
  resolveDaemonConfigTarget,
  resolveDockerRestartPlan
} from '../../../src/services/dns/daemon-target';
import { osDetector } from '../../../src/utils/os-detector';

describe('dns daemon target resolution', () => {
  beforeEach(() => {
    delete process.env[DAEMON_PATH_OVERRIDE_ENV];
    delete process.env[RESTART_CMD_OVERRIDE_ENV];
  });

  afterAll(() => {
    delete process.env[DAEMON_PATH_OVERRIDE_ENV];
    delete process.env[RESTART_CMD_OVERRIDE_ENV];
  });

  describe('platform defaults (spec 6.2)', () => {
    it('uses the user .docker directory on Docker Desktop', () => {
      expect(platformDaemonPath({ host: 'docker-desktop', homeDir: path.join('/home', 'me') })).toBe(
        path.join('/home', 'me', '.docker', 'daemon.json')
      );
    });

    it('uses /etc/docker/daemon.json on a native Linux engine', () => {
      expect(platformDaemonPath({ host: 'linux-engine', homeDir: '/home/me' })).toBe('/etc/docker/daemon.json');
    });

    it('uses the Windows-side path under WSL', () => {
      expect(
        platformDaemonPath({ host: 'wsl-docker-desktop', homeDir: '/home/me', windowsHomeDir: '/mnt/c/Users/me' })
      ).toBe('/mnt/c/Users/me/.docker/daemon.json');
    });

    it('refuses to guess the Windows-side path and points at the override', () => {
      expect(() => platformDaemonPath({ host: 'wsl-docker-desktop', homeDir: '/home/me' })).toThrow(
        DAEMON_PATH_OVERRIDE_ENV
      );
    });

    it('requires privilege escalation only for the native Linux engine', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');
      jest.spyOn(osDetector, 'isWsl').mockReturnValue(false);

      expect(resolveDaemonConfigTarget().requiresPrivilege).toBe(true);
      expect(resolveDaemonConfigTarget({ host: 'docker-desktop', homeDir: '/home/me' }).requiresPrivilege).toBe(false);
    });
  });

  describe('host detection', () => {
    it.each([
      ['win32' as const, 'docker-desktop'],
      ['darwin' as const, 'docker-desktop']
    ])('treats %s as Docker Desktop', (platform, host) => {
      jest.spyOn(osDetector, 'platform').mockReturnValue(platform);

      expect(detectDaemonEnvironment().host).toBe(host);
    });

    it('treats WSL as the Docker Desktop endpoint unless told otherwise', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');
      jest.spyOn(osDetector, 'isWsl').mockReturnValue(true);

      expect(detectDaemonEnvironment().host).toBe('wsl-docker-desktop');
      expect(detectDaemonEnvironment({ dockerDesktopEndpoint: false }).host).toBe('linux-engine');
    });

    it('treats plain Linux as a native engine', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');
      jest.spyOn(osDetector, 'isWsl').mockReturnValue(false);

      expect(detectDaemonEnvironment().host).toBe('linux-engine');
    });

    it('reports the real home directory', () => {
      expect(detectDaemonEnvironment().homeDir).toBe(os.homedir());
    });
  });

  describe('daemon path override (spec 7.4)', () => {
    it('replaces the platform path and never needs escalation', () => {
      process.env[DAEMON_PATH_OVERRIDE_ENV] = path.join('fixtures', 'daemon.json');

      const target = resolveDaemonConfigTarget({ host: 'linux-engine', homeDir: '/home/me' });

      expect(target).toMatchObject({
        path: path.resolve('fixtures', 'daemon.json'),
        source: 'override',
        host: 'linux-engine',
        requiresPrivilege: false
      });
      expect(target.path).not.toBe('/etc/docker/daemon.json');
    });

    it('ignores a blank value', () => {
      process.env[DAEMON_PATH_OVERRIDE_ENV] = '   ';

      expect(resolveDaemonConfigTarget({ host: 'linux-engine', homeDir: '/home/me' })).toMatchObject({
        path: '/etc/docker/daemon.json',
        source: 'platform'
      });
    });
  });

  describe('restart plan (spec 6.2)', () => {
    it('escalates through systemctl then service on a native Linux engine', () => {
      expect(resolveDockerRestartPlan({ host: 'linux-engine', homeDir: '/home/me' })).toEqual({
        source: 'platform',
        host: 'linux-engine',
        allowManualFallback: false,
        steps: [
          { command: 'sudo', args: ['systemctl', 'restart', 'docker'] },
          { command: 'sudo', args: ['service', 'docker', 'restart'] }
        ]
      });
    });

    it('tries docker desktop restart and allows a manual fallback', () => {
      expect(resolveDockerRestartPlan({ host: 'docker-desktop', homeDir: '/home/me' })).toEqual({
        source: 'platform',
        host: 'docker-desktop',
        allowManualFallback: true,
        steps: [{ command: 'docker', args: ['desktop', 'restart'] }]
      });
    });
  });

  describe('restart command override (spec 7.4)', () => {
    it('replaces the platform restart entirely, with no manual fallback', () => {
      process.env[RESTART_CMD_OVERRIDE_ENV] = 'docker restart runestone-dind';

      expect(resolveDockerRestartPlan({ host: 'linux-engine', homeDir: '/home/me' })).toEqual({
        source: 'override',
        host: 'linux-engine',
        allowManualFallback: false,
        raw: 'docker restart runestone-dind',
        steps: [{ command: 'docker', args: ['restart', 'runestone-dind'] }]
      });
    });

    it('ignores a blank value', () => {
      process.env[RESTART_CMD_OVERRIDE_ENV] = '  ';

      expect(resolveDockerRestartPlan({ host: 'docker-desktop', homeDir: '/home/me' }).source).toBe('platform');
    });
  });

  describe('parseRestartCommand', () => {
    it('splits on whitespace', () => {
      expect(parseRestartCommand('  docker   restart  dind ')).toEqual({
        command: 'docker',
        args: ['restart', 'dind']
      });
    });

    it('honours quoting so paths with spaces survive', () => {
      expect(parseRestartCommand('"C:/Program Files/Docker/docker.exe" restart \'my dind\'')).toEqual({
        command: 'C:/Program Files/Docker/docker.exe',
        args: ['restart', 'my dind']
      });
    });

    it('keeps an empty quoted argument', () => {
      expect(parseRestartCommand('cmd ""')).toEqual({ command: 'cmd', args: [''] });
    });

    it('rejects an unterminated quote', () => {
      expect(() => parseRestartCommand('docker "restart')).toThrow('unterminated');
    });

    it('rejects a command-free value', () => {
      expect(() => parseRestartCommand('   ')).toThrow('no command');
    });
  });

  describe('activeOverrides', () => {
    it('is empty when neither override is set', () => {
      expect(activeOverrides()).toEqual([]);
    });

    it('reports every override actually in effect', () => {
      process.env[DAEMON_PATH_OVERRIDE_ENV] = '/tmp/daemon.json';
      process.env[RESTART_CMD_OVERRIDE_ENV] = 'true';

      expect(activeOverrides()).toEqual([
        { variable: DAEMON_PATH_OVERRIDE_ENV, value: '/tmp/daemon.json' },
        { variable: RESTART_CMD_OVERRIDE_ENV, value: 'true' }
      ]);
    });

    it('reports only the one that is set', () => {
      process.env[RESTART_CMD_OVERRIDE_ENV] = 'true';

      expect(activeOverrides()).toEqual([{ variable: RESTART_CMD_OVERRIDE_ENV, value: 'true' }]);
    });
  });
});
