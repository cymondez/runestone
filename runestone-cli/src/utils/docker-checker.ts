import { spawnCommand } from './spawn';

export const dockerChecker = {
  isInstalled(): boolean {
    try {
      const result = spawnCommand('docker', ['--version'], {
        encoding: 'utf8',
        timeout: 5000
      });

      return result.status === 0 && Boolean(result.stdout?.toString().trim());
    } catch {
      return false;
    }
  },

  composePluginInstalled(): boolean {
    try {
      const result = spawnCommand('docker', ['compose', 'version'], {
        encoding: 'utf8',
        timeout: 5000
      });

      return result.status === 0 && Boolean(result.stdout?.toString().trim());
    } catch {
      return false;
    }
  }
};
