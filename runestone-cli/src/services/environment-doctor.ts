import { spawnCommand } from '../utils/spawn';

export type DoctorCheckId = 'docker' | 'dockerCompose' | 'certutil';
export type DoctorCheckStatus = 'pass' | 'fail' | 'skip';

export interface DoctorCheck {
  id: DoctorCheckId;
  label: string;
  status: DoctorCheckStatus;
  required: string;
  found?: string;
  message: string;
  installHint?: string;
  canInstall: boolean;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: boolean;
}

const DOCKER_MIN_VERSION = '29.0.0';
const DOCKER_INSTALL_URL = 'https://get.docker.com';

type LinuxPackageManager = 'apt-get' | 'dnf' | 'yum' | 'zypper' | 'pacman' | 'apk';

const packageCommands: Record<LinuxPackageManager, { update?: string[]; install: (packageName: string) => string[] }> = {
  'apt-get': {
    update: ['apt-get', 'update'],
    install: (packageName) => ['apt-get', 'install', '-y', packageName]
  },
  dnf: {
    install: (packageName) => ['dnf', 'install', '-y', packageName]
  },
  yum: {
    install: (packageName) => ['yum', 'install', '-y', packageName]
  },
  zypper: {
    install: (packageName) => ['zypper', 'install', '-y', packageName]
  },
  pacman: {
    install: (packageName) => ['pacman', '-Sy', '--noconfirm', packageName]
  },
  apk: {
    install: (packageName) => ['apk', 'add', packageName]
  }
};

const certutilPackages: Partial<Record<LinuxPackageManager, string>> = {
  'apt-get': 'libnss3-tools',
  dnf: 'nss-tools',
  yum: 'nss-tools',
  zypper: 'mozilla-nss-tools',
  pacman: 'nss',
  apk: 'nss-tools'
};

const composePackages: Partial<Record<LinuxPackageManager, string>> = {
  'apt-get': 'docker-compose-plugin',
  dnf: 'docker-compose-plugin',
  yum: 'docker-compose-plugin'
};

function commandOutput(command: string, args: string[]): { ok: boolean; stdout: string; stderr: string; error?: NodeJS.ErrnoException } {
  try {
    const result = spawnCommand(command, args, {
      encoding: 'utf8',
      timeout: 10_000
    });
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error as NodeJS.ErrnoException | undefined
    };
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: error as NodeJS.ErrnoException
    };
  }
}

function commandExists(command: string): boolean {
  return commandOutput(command, ['--version']).ok;
}

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function canRunPrivileged(): boolean {
  return isRoot() || commandExists('sudo');
}

function currentUser(): string | undefined {
  return process.env.SUDO_USER || process.env.USER || process.env.LOGNAME;
}

function linuxPackageManager(): LinuxPackageManager | undefined {
  return (Object.keys(packageCommands) as LinuxPackageManager[]).find(commandExists);
}

function dockerInstallScript(): string | undefined {
  if (commandExists('curl')) {
    return `curl -fsSL ${DOCKER_INSTALL_URL} | sh`;
  }
  if (commandExists('wget')) {
    return `wget -qO- ${DOCKER_INSTALL_URL} | sh`;
  }
  return undefined;
}

function linuxPackageInstallCommand(packageName: string, manager = linuxPackageManager()): string | undefined {
  if (!manager) {
    return undefined;
  }
  return packageCommands[manager].install(packageName).join(' ');
}

function parseVersion(value: string): string | undefined {
  return value.match(/\d+\.\d+\.\d+/)?.[0] ?? value.match(/\d+\.\d+/)?.[0];
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

function dockerCheck(): DoctorCheck {
  const result = commandOutput('docker', ['--version']);
  const version = parseVersion(result.stdout);
  if (result.ok && version && compareVersions(version, DOCKER_MIN_VERSION) >= 0) {
    return {
      id: 'docker',
      label: 'Docker Engine',
      status: 'pass',
      required: `>= ${DOCKER_MIN_VERSION}`,
      found: version,
      message: `Docker ${version}`,
      canInstall: false
    };
  }

  return {
    id: 'docker',
    label: 'Docker Engine',
    status: 'fail',
    required: `>= ${DOCKER_MIN_VERSION}`,
    found: version,
    message: version ? `Docker ${version} is below ${DOCKER_MIN_VERSION}` : 'Docker was not found',
    installHint: dockerInstallHint(),
    canInstall: dockerCanInstall()
  };
}

function dockerComposeCheck(): DoctorCheck {
  const result = commandOutput('docker', ['compose', 'version']);
  const version = parseVersion(result.stdout);
  if (result.ok && version && compareVersions(version, '2.0.0') >= 0) {
    return {
      id: 'dockerCompose',
      label: 'Docker Compose',
      status: 'pass',
      required: 'v2',
      found: version,
      message: `Docker Compose ${version}`,
      canInstall: false
    };
  }

  return {
    id: 'dockerCompose',
    label: 'Docker Compose',
    status: 'fail',
    required: 'v2',
    found: version,
    message: version ? `Docker Compose ${version} is not v2` : 'Docker Compose v2 was not found',
    installHint: dockerComposeInstallHint(),
    canInstall: dockerComposeCanInstall()
  };
}

function dockerInstallHint(): string {
  if (process.platform === 'darwin') {
    return 'Install or upgrade Docker Desktop with Homebrew: brew install --cask docker';
  }
  if (process.platform === 'linux') {
    const script = dockerInstallScript();
    return script
      ? `Install or upgrade Docker Engine with Docker official install script: ${script}`
      : 'Install curl or wget first, then install Docker Engine with Docker official install script.';
  }
  return 'Install or upgrade Docker Desktop to 29.0.0 or newer.';
}

function dockerComposeInstallHint(): string {
  if (process.platform === 'darwin') {
    return 'Install or upgrade Docker Desktop with Homebrew: brew install --cask docker';
  }
  if (process.platform === 'linux') {
    const packageName = composePackages[linuxPackageManager() as LinuxPackageManager];
    const command = packageName ? linuxPackageInstallCommand(packageName) : undefined;
    return command
      ? `Install Docker Compose v2 plugin: ${command}`
      : 'Install Docker Compose v2 plugin using your distribution package manager or Docker official packages.';
  }
  return 'Install Docker Compose v2 through Docker Desktop.';
}

function dockerCanInstall(): boolean {
  if (process.platform === 'darwin') {
    return commandOutput('brew', ['--version']).ok;
  }
  if (process.platform === 'linux') {
    return canRunPrivileged() && Boolean(dockerInstallScript());
  }
  return false;
}

function dockerComposeCanInstall(): boolean {
  if (process.platform === 'darwin') {
    return commandOutput('brew', ['--version']).ok;
  }
  if (process.platform === 'linux') {
    const manager = linuxPackageManager();
    return canRunPrivileged() && Boolean(manager && composePackages[manager]);
  }
  return false;
}

function certutilInstallHint(): string {
  if (process.platform === 'darwin') {
    return 'Install NSS certutil with Homebrew: brew install nss';
  }
  const manager = linuxPackageManager();
  const packageName = manager ? certutilPackages[manager] : undefined;
  const command = packageName ? linuxPackageInstallCommand(packageName, manager) : undefined;
  return command
    ? `Install NSS certutil package: ${command}`
    : 'Install the NSS certutil package for your Linux distribution, such as libnss3-tools or nss-tools.';
}

function certutilCanInstall(): boolean {
  if (process.platform === 'darwin') {
    return commandOutput('brew', ['--version']).ok;
  }
  if (process.platform === 'linux') {
    const manager = linuxPackageManager();
    return canRunPrivileged() && Boolean(manager && certutilPackages[manager]);
  }
  return false;
}

function certutilCheck(): DoctorCheck {
  if (process.platform === 'win32') {
    return {
      id: 'certutil',
      label: 'NSS certutil',
      status: 'skip',
      required: 'not required on Windows',
      message: 'Windows uses mkcert and the system trust store',
      canInstall: false
    };
  }

  const result = commandOutput('certutil', ['-H']);
  const stderr = result.stderr.trim();
  const launched = !result.error;
  const loaderFailed = /error while loading shared libraries|No such file or directory/i.test(stderr);
  if (launched && !loaderFailed) {
    return {
      id: 'certutil',
      label: 'NSS certutil',
      status: 'pass',
      required: process.platform === 'darwin' ? 'nss certutil' : 'libnss3-tools',
      message: 'certutil is available',
      canInstall: false
    };
  }

  return {
    id: 'certutil',
    label: 'NSS certutil',
    status: 'fail',
    required: process.platform === 'darwin' ? 'nss certutil' : 'libnss3-tools',
    message: 'certutil was not found',
    installHint: certutilInstallHint(),
    canInstall: certutilCanInstall()
  };
}

export function checkEnvironment(): DoctorReport {
  const checks = [dockerCheck(), dockerComposeCheck(), certutilCheck()];
  return {
    checks,
    passed: checks.every((check) => check.status !== 'fail')
  };
}

function runInstallCommand(command: string, args: string[]): void {
  const result = spawnCommand(command, args, {
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function runPrivilegedCommand(command: string, args: string[]): void {
  if (isRoot()) {
    runInstallCommand(command, args);
    return;
  }

  if (!commandExists('sudo')) {
    throw new Error(`Cannot run ${command} ${args.join(' ')} because sudo is not available.`);
  }

  runInstallCommand('sudo', [command, ...args]);
}

function runLinuxPackageInstall(packageName: string, manager = linuxPackageManager()): void {
  if (!manager) {
    throw new Error(`No supported Linux package manager was found to install ${packageName}.`);
  }

  const commands = packageCommands[manager];
  if (commands.update) {
    runPrivilegedCommand(commands.update[0], commands.update.slice(1));
  }
  const install = commands.install(packageName);
  runPrivilegedCommand(install[0], install.slice(1));
}

function ensureDockerGroupAccess(): void {
  if (process.platform !== 'linux') {
    return;
  }

  if (commandOutput('docker', ['ps']).ok) {
    return;
  }

  const user = currentUser();
  if (!user || user === 'root') {
    return;
  }

  const groups = commandOutput('id', ['-nG', user]).stdout.split(/\s+/).filter(Boolean);
  if (!groups.includes('docker')) {
    runPrivilegedCommand('usermod', ['-aG', 'docker', user]);
  }

  if (commandExists('setfacl')) {
    runPrivilegedCommand('setfacl', ['-m', `user:${user}:rw`, '/var/run/docker.sock']);
  }

  if (!commandOutput('docker', ['ps']).ok) {
    throw new Error(
      'Docker was installed, but the current user still cannot run `docker ps`. Log out and back in, or check Docker daemon permissions.'
    );
  }
}

export function installDoctorCheck(check: DoctorCheck): void {
  if (check.id === 'docker') {
    if (process.platform === 'darwin') {
      runInstallCommand('brew', ['install', '--cask', 'docker']);
      return;
    }
    if (process.platform === 'linux') {
      const script = dockerInstallScript();
      if (!script) {
        throw new Error('Docker official install script requires curl or wget.');
      }
      runPrivilegedCommand('sh', ['-c', script]);
      ensureDockerGroupAccess();
      return;
    }
  }

  if (check.id === 'dockerCompose') {
    if (process.platform === 'darwin') {
      runInstallCommand('brew', ['install', '--cask', 'docker']);
      return;
    }
    if (process.platform === 'linux') {
      const manager = linuxPackageManager();
      const packageName = manager ? composePackages[manager] : undefined;
      if (!packageName) {
        throw new Error('No supported Linux package manager was found to install docker-compose-plugin.');
      }
      runLinuxPackageInstall(packageName, manager);
      return;
    }
  }

  if (check.id === 'certutil' && process.platform === 'darwin') {
    runInstallCommand('brew', ['install', 'nss']);
    return;
  }

  if (check.id === 'certutil' && process.platform === 'linux') {
    const manager = linuxPackageManager();
    const packageName = manager ? certutilPackages[manager] : undefined;
    if (!packageName) {
      throw new Error('No supported Linux package manager was found to install NSS certutil.');
    }
    runLinuxPackageInstall(packageName, manager);
    return;
  }

  throw new Error(`${check.label} cannot be installed automatically by Runestone doctor on this platform.`);
}

export function formatDoctorCheck(check: DoctorCheck): string {
  const icon = check.status === 'pass' ? 'OK' : check.status === 'skip' ? 'SKIP' : 'FAIL';
  const found = check.found ? `, found ${check.found}` : '';
  return `[${icon}] ${check.label}: ${check.message} (required ${check.required}${found})`;
}
