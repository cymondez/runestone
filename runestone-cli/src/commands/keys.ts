import { Command } from 'commander';
import { green } from 'kleur';
import { sshManager } from '../services/ssh-manager';
import { envLoader } from '../utils/env-loader';
import { logger } from '../utils/logger';

interface KeysOptions {
  env?: string;
  project?: string;
}

export function createKeysCommand(): Command {
  const command = new Command('keys')
    .description('SSH key management for the runestone Docker environment')
    .option('-e, --env <path>', 'Path to .env file')
    .option('--project <path>', 'Runestone path or compose.yml path');

  command
    .command('ls')
    .alias('list')
    .description('List injected SSH keys')
    .action(() => {
      const options = command.opts<KeysOptions>();
      try {
        const config = envLoader.load(options.env, options.project);
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
    });

  command
    .command('add')
    .description('Add an SSH key to the runestone Docker volume')
    .argument('<path>', 'Path to the SSH private key file')
    .action((keyPath: string) => {
      const options = command.opts<KeysOptions>();
      try {
        const config = envLoader.load(options.env, options.project);
        sshManager.addKey(keyPath, config.SSH_VOLUME_NAME);
        logger.success('SSH key added successfully.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to add SSH key: ${message}`);
        process.exit(1);
      }
    });

  return command;
}
