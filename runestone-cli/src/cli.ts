import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createCertsCommand } from './commands/certs';
import { createDownCommand } from './commands/down';
import { createKeysCommand } from './commands/keys';
import { createSetupCommand } from './commands/setup';
import { createStatusCommand } from './commands/status';
import { createStopCommand } from './commands/stop';
import { createUpCommand } from './commands/up';

function packageVersion(): string {
  try {
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createProgram(): Command {
  return new Command()
    .name('runestone')
    .description('Cross-platform CLI tool for the runestone Docker development environment')
    .version(packageVersion())
    .addCommand(createSetupCommand())
    .addCommand(createUpCommand())
    .addCommand(createStopCommand())
    .addCommand(createDownCommand())
    .addCommand(createStatusCommand())
    .addCommand(createCertsCommand())
    .addCommand(createKeysCommand());
}

export function run(argv = process.argv): void {
  createProgram().parse(argv);
}

if (require.main === module) {
  run();
}
