import * as os from 'os';
import * as path from 'path';

export type RunestonePlatform = 'win32' | 'darwin' | 'linux';
export type RunestoneArch = 'x64' | 'arm64' | 'other';

export const osDetector = {
  platform(): RunestonePlatform {
    if (process.platform === 'win32') {
      return 'win32';
    }

    if (process.platform === 'darwin') {
      return 'darwin';
    }

    return 'linux';
  },

  arch(): RunestoneArch {
    const arch = os.arch();
    if (arch === 'x64' || arch === 'arm64') {
      return arch;
    }

    return 'other';
  },

  homeDir(): string {
    return os.homedir();
  },

  sshDir(): string {
    return path.join(this.homeDir(), '.ssh');
  }
};
