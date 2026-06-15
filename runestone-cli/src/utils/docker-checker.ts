import { spawnSync } from 'child_process';

export const dockerChecker = {
  isInstalled(): boolean {
    try {
      const result = spawnSync('docker', ['--version'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 5000
      });

      return result.status === 0 && Boolean(result.stdout?.toString().trim());
    } catch {
      return false;
    }
  },

  composePluginInstalled(): boolean {
    try {
      const result = spawnSync('docker', ['compose', 'version'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 5000
      });

      return result.status === 0 && Boolean(result.stdout?.toString().trim());
    } catch {
      return false;
    }
  }
};
