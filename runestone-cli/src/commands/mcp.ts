import { Command } from 'commander';
import { createHandlers, serveStdio } from '../services/mcp/server';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { packageVersion } from '../utils/version';

/**
 * A thin shell. Everything real lives under `src/services/mcp/`, which is also
 * where the rule that this process must not write to stdout is enforced.
 *
 * Nothing in this file may import the logger or a prompt library: both write to
 * stdout, and stdout is the protocol stream.
 */
export function createMcpCommand(): Command {
  const serve = createCommand('serve')
    .description(t('commands.mcp.serve.description'))
    .action(async () => {
      await serveStdio({ name: 'runestone', version: packageVersion() }, createHandlers());
      // Deliberately not process.exit(): the event loop drains so buffered
      // frames actually reach the client.
    });

  return createCommand('mcp').description(t('commands.mcp.description')).addCommand(serve);
}
