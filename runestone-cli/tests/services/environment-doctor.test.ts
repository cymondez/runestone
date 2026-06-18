import { spawnCommand } from '../../src/utils/spawn';
import { checkEnvironment, formatDoctorCheck, installDoctorCheck } from '../../src/services/environment-doctor';

jest.mock('../../src/utils/spawn', () => ({
  spawnCommand: jest.fn()
}));

const spawnCommandMock = spawnCommand as jest.MockedFunction<typeof spawnCommand>;

function mockPlatform(platform: NodeJS.Platform): PropertyDescriptor | undefined {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  return original;
}

function restorePlatform(original: PropertyDescriptor | undefined): void {
  if (original) {
    Object.defineProperty(process, 'platform', original);
  }
}

function result(stdout: string, status = 0): ReturnType<typeof spawnCommand> {
  return {
    status,
    stdout,
    stderr: '',
    pid: 1,
    output: [null, stdout, ''],
    signal: null
  } as never;
}

describe('environment-doctor', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('passes Docker 29, Docker Compose v2, and skips certutil on Windows', () => {
    const original = mockPlatform('win32');
    spawnCommandMock.mockImplementation((command, args) => {
      const key = [command, ...args].join(' ');
      if (key === 'docker --version') {
        return result('Docker version 29.5.2, build fake');
      }
      if (key === 'docker compose version') {
        return result('Docker Compose version v2.27.0');
      }
      return result('', 1);
    });

    try {
      const report = checkEnvironment();

      expect(report.passed).toBe(true);
      expect(report.checks.map((check) => check.status)).toEqual(['pass', 'pass', 'skip']);
    } finally {
      restorePlatform(original);
    }
  });

  it('fails Docker below 29 and Linux certutil when certutil is missing', () => {
    const original = mockPlatform('linux');
    spawnCommandMock.mockImplementation((command, args) => {
      const key = [command, ...args].join(' ');
      if (key === 'docker --version') {
        return result('Docker version 26.0.0, build fake');
      }
      if (key === 'docker compose version') {
        return result('Docker Compose version v2.27.0');
      }
      if (key === 'apt-get --version') {
        return result('apt 2.8.0');
      }
      if (key === 'sudo --version') {
        return result('Sudo version 1.9.15');
      }
      if (key === 'curl --version') {
        return result('curl 8.5.0');
      }
      const missing = {
        ...result('', 1),
        error: Object.assign(new Error('not found'), { code: 'ENOENT' })
      };
      return missing as never;
    });

    try {
      const report = checkEnvironment();

      expect(report.passed).toBe(false);
      const docker = report.checks.find((check) => check.id === 'docker');
      expect(docker?.status).toBe('fail');
      expect(docker?.canInstall).toBe(true);
      const certutil = report.checks.find((check) => check.id === 'certutil');
      expect(certutil?.status).toBe('fail');
      expect(certutil?.canInstall).toBe(true);
      expect(formatDoctorCheck(certutil as never)).toContain('FAIL');
    } finally {
      restorePlatform(original);
    }
  });

  it('passes Linux certutil when certutil -H prints help with exit code 1', () => {
    const original = mockPlatform('linux');
    spawnCommandMock.mockImplementation((command, args) => {
      const key = [command, ...args].join(' ');
      if (key === 'docker --version') {
        return result('Docker version 29.5.3, build fake');
      }
      if (key === 'docker compose version') {
        return result('Docker Compose version v2.27.0');
      }
      if (key === 'certutil -H') {
        return result('-A              Add a certificate to the database\n', 1);
      }
      return result('', 1);
    });

    try {
      const report = checkEnvironment();

      expect(report.passed).toBe(true);
      expect(report.checks.find((check) => check.id === 'certutil')?.status).toBe('pass');
    } finally {
      restorePlatform(original);
    }
  });

  it('installs Docker on Linux with wget fallback and fixes socket access', () => {
    const original = mockPlatform('linux');
    const originalEnv = process.env;
    const originalGetuid = process.getuid;
    const calls: string[] = [];
    process.env = { ...originalEnv, USER: 'devuser' };
    Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true });
    spawnCommandMock.mockImplementation((command, args) => {
      const key = [command, ...args].join(' ');
      calls.push(key);
      if (key === 'curl --version') {
        return { ...result('', 1), error: Object.assign(new Error('missing'), { code: 'ENOENT' }) } as never;
      }
      if (key === 'wget --version' || key === 'sudo --version' || key === 'setfacl --version') {
        return result('ok');
      }
      if (key === 'sudo sh -c wget -qO- https://get.docker.com | sh') {
        return result('');
      }
      if (key === 'docker ps') {
        return calls.filter((call) => call === 'docker ps').length > 1 ? result('CONTAINER ID\n') : result('', 1);
      }
      if (key === 'id -nG devuser') {
        return result('devuser');
      }
      if (key === 'sudo usermod -aG docker devuser') {
        return result('');
      }
      if (key === 'sudo setfacl -m user:devuser:rw /var/run/docker.sock') {
        return result('');
      }
      return result('');
    });

    try {
      installDoctorCheck({
        id: 'docker',
        label: 'Docker Engine',
        status: 'fail',
        required: '>= 29.0.0',
        message: 'Docker was not found',
        canInstall: true
      });

      expect(calls).toContain('sudo sh -c wget -qO- https://get.docker.com | sh');
      expect(calls).toContain('sudo usermod -aG docker devuser');
      expect(calls).toContain('sudo setfacl -m user:devuser:rw /var/run/docker.sock');
      expect(calls.filter((call) => call === 'docker ps')).toHaveLength(2);
    } finally {
      process.env = originalEnv;
      Object.defineProperty(process, 'getuid', { value: originalGetuid, configurable: true });
      restorePlatform(original);
    }
  });

  it('installs Linux certutil with the detected package manager without sudo when running as root', () => {
    const original = mockPlatform('linux');
    const originalGetuid = process.getuid;
    const calls: string[] = [];
    Object.defineProperty(process, 'getuid', { value: () => 0, configurable: true });
    spawnCommandMock.mockImplementation((command, args) => {
      const key = [command, ...args].join(' ');
      calls.push(key);
      if (key === 'dnf --version') {
        return result('dnf 5');
      }
      if (key.endsWith('--version')) {
        return { ...result('', 1), error: Object.assign(new Error('missing'), { code: 'ENOENT' }) } as never;
      }
      if (key === 'dnf install -y nss-tools') {
        return result('');
      }
      return result('');
    });

    try {
      installDoctorCheck({
        id: 'certutil',
        label: 'NSS certutil',
        status: 'fail',
        required: 'nss-tools',
        message: 'certutil was not found',
        canInstall: true
      });

      expect(calls).toContain('dnf install -y nss-tools');
      expect(calls.some((call) => call.startsWith('sudo '))).toBe(false);
    } finally {
      Object.defineProperty(process, 'getuid', { value: originalGetuid, configurable: true });
      restorePlatform(original);
    }
  });
});
