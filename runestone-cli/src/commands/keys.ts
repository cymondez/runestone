import { Command } from 'commander';
import { green } from 'kleur';
import { sshManager } from '../services/ssh-manager';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { t } from '../i18n';
import { createCommand } from '../utils/command';

export function createKeysCommand(): Command {
  const command = createCommand('keys')
    .description(t('commands.keys.description'));

  command
    .addCommand(createCommand('ls')
    .alias('list')
    .description(t('commands.keys.ls.description'))
    .action(() => {
      try {
        const config = envLoader.load();
        const keys = sshManager.listKeys(config.SSH_VOLUME_NAME);
        if (keys.length === 0) {
          logger.warn('No injected SSH keys found.');
          return;
        }

        keys.forEach((key) => console.log(`  ${green('+')} ${key}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to list SSH keys: ${message}`);
        process.exit(1);
      }
    }));

  command
    .addCommand(createCommand('add')
    .description(t('commands.keys.add.description'))
    .argument('<path>', t('arguments.keyPath'))
    .action((keyPath: string) => {
      try {
        const config = envLoader.load();
        sshManager.addKey(keyPath, config.SSH_VOLUME_NAME);
        logger.success('SSH key added successfully.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to add SSH key: ${message}`);
        process.exit(1);
      }
    }));

  return command;
}
