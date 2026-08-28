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
  resolveDockerRestartPlan,
  sameDaemonPath
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

  describe('comparing recorded daemon paths', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('treats the two Windows spellings of one file as the same file', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('win32');

      // The mismatch check is what makes `dns disable` refuse to act, so a false
      // mismatch refuses to remove an entry that is genuinely ours and prints
      // two paths the user reads as identical.
      const backslashes = ['C:', 'Users', 'me', '.docker', 'daemon.json'].join('\\');
      expect(sameDaemonPath('C:/Users/me/.docker/daemon.json', backslashes)).toBe(true);
      expect(sameDaemonPath(backslashes.toLowerCase(), backslashes)).toBe(true);
    });

    it('still tells two different files apart', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('win32');

      expect(sameDaemonPath('C:/Users/me/.docker/daemon.json', 'C:/etc/daemon.json')).toBe(false);
    });

    it('keeps case significant off Windows', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');

      expect(sameDaemonPath('/etc/docker/daemon.json', '/etc/docker/daemon.json')).toBe(true);
      expect(sameDaemonPath('/etc/Docker/daemon.json', '/etc/docker/daemon.json')).toBe(false);
    });
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

    it('requires privilege escalation only for the native Linux engine', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');

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

    it('treats Linux as a native engine, whatever kernel it reports', () => {
      // Deliberately not asking whether this is WSL. Docker Desktop runs its VM
      // on WSL2, so the kernel string cannot tell WSL apart from a container on
      // Docker Desktop — and the question that actually matters, which daemon
      // this is, is answered by `docker info` in preflight instead.
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');

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

    it('offers no automatic step on Docker Desktop, and says a human must do it', () => {
      // `docker desktop restart` restarts the *application*, which stops the
      // containers — and `unless-stopped` means "restart unless it was stopped",
      // so those never come back. Measured twice on Docker Desktop for Windows.
      // The engine restart Docker Desktop performs for its own Settings screen
      // is the supported way to apply this file, and it is not on the CLI.
      expect(resolveDockerRestartPlan({ host: 'docker-desktop', homeDir: '/home/me' })).toEqual({
        source: 'platform',
        host: 'docker-desktop',
        allowManualFallback: true,
        steps: []
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
