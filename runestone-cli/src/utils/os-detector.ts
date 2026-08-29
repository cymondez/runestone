import * as fs from 'fs';
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

  /**
   * Whether the CLI is running inside a WSL distribution (spec 6.2).
   *
   * **This is about where the CLI runs, not about what the daemon is.** An
   * earlier version of the spec removed this detection on the grounds that
   * every container on Docker Desktop's Linux VM reports a Microsoft kernel in
   * `/proc/version`. That is true, and it is a statement about the inside of a
   * container; the CLI runs in the user's own userland, where the two are
   * cleanly distinguishable. Measured on 2026-08-29:
   *
   * | | WSL distro | native Linux |
   * | --- | --- | --- |
   * | `WSL_DISTRO_NAME` | `Ubuntu-26.04` | unset |
   * | `/run/WSL` | present | absent |
   * | `/proc/version` | `…-microsoft-standard-WSL2` | `…-generic` |
   *
   * Its only job is to separate two machines that `docker info` cannot tell
   * apart: a WSL distro using Docker Desktop's integration, whose daemon
   * configuration is on the Windows side, from Docker Desktop for Linux, whose
   * configuration is right here.
   */
  isWsl(): boolean {
    if (this.platform() !== 'linux') {
      return false;
    }

    if ((process.env.WSL_DISTRO_NAME ?? '').trim() !== '') {
      return true;
    }

    try {
      if (fs.existsSync('/run/WSL')) {
        return true;
      }
    } catch {
      // An unreadable /run says nothing either way; fall through to the kernel.
    }

    try {
      return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    } catch {
      return false;
    }
  },

  homeDir(): string {
    return os.homedir();
  },

  sshDir(): string {
    return path.join(this.homeDir(), '.ssh');
  }
};
