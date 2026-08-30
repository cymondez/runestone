import * as os from 'os';
import * as path from 'path';
import {
  DAEMON_PATH_OVERRIDE_ENV,
  classifyDaemonEnvironment,
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
      // Each case names its own machine rather than stubbing the platform and
      // letting the resolver work it out: the environment is the input here.
      expect(resolveDaemonConfigTarget({ host: 'linux-engine', homeDir: '/home/me' }).requiresPrivilege).toBe(true);
      expect(resolveDaemonConfigTarget({ host: 'docker-desktop', homeDir: '/home/me' }).requiresPrivilege).toBe(false);
      expect(resolveDaemonConfigTarget({ host: 'elsewhere', homeDir: '/home/me' }).requiresPrivilege).toBe(false);
    });
  });

  describe('classification (spec 6.2)', () => {
    // The five rows of the decision table, as data. **Every platform can be
    // Docker Desktop and every platform can be a plain engine** — Windows can
    // run docker-ce inside WSL2, macOS has Colima and Lima, Linux has Docker
    // Desktop for Linux — so none of these rows can be reached from the
    // platform alone.
    const HOME = path.join('/home', 'someone');
    const ROWS: Array<[number, string, boolean, 'win32' | 'darwin' | 'linux', boolean, string]> = [
      [1, 'Docker Desktop on Windows', true, 'win32', false, 'docker-desktop'],
      [1, 'Docker Desktop on macOS', true, 'darwin', false, 'docker-desktop'],
      [2, 'a WSL distro using the Desktop integration', true, 'linux', true, 'elsewhere'],
      [3, 'Docker Desktop for Linux', true, 'linux', false, 'docker-desktop'],
      [4, 'a native engine on Linux', false, 'linux', false, 'linux-engine'],
      [5, 'a plain engine reached from Windows', false, 'win32', false, 'elsewhere'],
      [5, 'a plain engine reached from macOS', false, 'darwin', false, 'elsewhere']
    ];

    it.each(ROWS)('row %i — %s', (_row, _name, daemonIsDockerDesktop, platform, isWsl, host) => {
      expect(
        classifyDaemonEnvironment({ daemonIsDockerDesktop, platform, isWsl, homeDir: HOME }).host
      ).toBe(host);
    });

    it('row 2 and row 3 differ only by WSL, which is the whole point', () => {
      // `docker info` cannot separate these two: measured, a WSL distro with the
      // integration reports `Docker Desktop` and carries the `desktop` CLI
      // plugin, exactly as Docker Desktop on Windows does.
      const wsl = classifyDaemonEnvironment({
        daemonIsDockerDesktop: true,
        platform: 'linux',
        isWsl: true,
        homeDir: HOME
      });
      const desktopForLinux = classifyDaemonEnvironment({
        daemonIsDockerDesktop: true,
        platform: 'linux',
        isWsl: false,
        homeDir: HOME
      });

      expect([wsl.host, desktopForLinux.host]).toEqual(['elsewhere', 'docker-desktop']);
    });

    it('has no path to offer for a daemon whose configuration is elsewhere', () => {
      // Empty, not a guess: the file this used to name is one that daemon never
      // reads, and writing it would report success while doing nothing.
      expect(platformDaemonPath({ host: 'elsewhere', homeDir: HOME })).toBe('');
    });
  });

  describe('host detection', () => {
    it.each([
      ['win32' as const, 'docker-desktop'],
      ['darwin' as const, 'docker-desktop']
    ])('treats a Docker Desktop daemon reached from %s as Docker Desktop', (platform, host) => {
      jest.spyOn(osDetector, 'platform').mockReturnValue(platform);
      jest.spyOn(osDetector, 'isWsl').mockReturnValue(false);

      expect(detectDaemonEnvironment({ isDockerDesktop: true }).host).toBe(host);
    });

    it('asks the daemon, not the platform', () => {
      jest.spyOn(osDetector, 'platform').mockReturnValue('linux');
      jest.spyOn(osDetector, 'isWsl').mockReturnValue(false);

      expect(detectDaemonEnvironment({ isDockerDesktop: false }).host).toBe('linux-engine');
      expect(detectDaemonEnvironment({ isDockerDesktop: true }).host).toBe('docker-desktop');
    });

    it('reports the real home directory', () => {
      expect(detectDaemonEnvironment({ isDockerDesktop: true }).homeDir).toBe(os.homedir());
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
