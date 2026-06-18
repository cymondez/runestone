import { spawnCommand } from '../utils/spawn';

export function openUrl(url: string): void {
  const command =
    process.platform === 'win32'
      ? { name: 'cmd', args: ['/c', 'start', '', url] }
      : process.platform === 'darwin'
        ? { name: 'open', args: [url] }
        : { name: 'xdg-open', args: [url] };

  const result = spawnCommand(command.name, command.args, {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 30000
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to open ${url}`);
  }
}
