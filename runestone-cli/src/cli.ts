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
import { createMcpCommand } from './commands/mcp';
import { createSkillCommand } from './commands/skill';
import { createStatusCommand } from './commands/status';
import { createStopCommand } from './commands/stop';
import { createUpCommand } from './commands/up';
import { t } from './i18n';
import { createCommand } from './utils/command';
import { packageVersion } from './utils/version';

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
    .addCommand(createSkillCommand())
    .addCommand(createMcpCommand())
    .addCommand(createStatusCommand());
}

export function run(argv = process.argv): void {
  createProgram().parse(argv);
}

if (require.main === module) {
  run();
}
