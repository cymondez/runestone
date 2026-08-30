import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createCertsCommand } from './commands/certs';
import { createDnsCommand } from './commands/dns';
import { createDownCommand } from './commands/down';
import { createDocsCommand } from './commands/docs';
import { createDoctorCommand } from './commands/doctor';
import { createKeysCommand } from './commands/keys';
import { createServiceCommand } from './commands/service';
import { createSetupCommand } from './commands/setup';
import { createStatusCommand } from './commands/status';
import { createStopCommand } from './commands/stop';
import { createUpCommand } from './commands/up';
import { t } from './i18n';
import { createCommand } from './utils/command';

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
  return createCommand()
    .name('runestone')
    .description(t('cli.description'))
    .version(packageVersion())
    .addCommand(createSetupCommand())
    .addCommand(createUpCommand())
    .addCommand(createStopCommand())
    .addCommand(createDownCommand())
    .addCommand(createCertsCommand())
    .addCommand(createKeysCommand())
    .addCommand(createServiceCommand())
    .addCommand(createDnsCommand())
    .addCommand(createDoctorCommand())
    .addCommand(createDocsCommand())
    .addCommand(createStatusCommand());
}

export function run(argv = process.argv): void {
  createProgram().parse(argv);
}

if (require.main === module) {
  run();
}
