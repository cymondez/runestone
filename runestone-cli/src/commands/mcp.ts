import { Command } from 'commander';
import { MCP_CLIENTS, clientIds, findClient, renderClientConfig } from '../services/mcp/config';
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

  // `config` prints; the user pastes. Writing another tool's configuration
  // file on the user's behalf is the same class of act as writing the Docker
  // daemon's, and this project treats that as the highest risk there is.
  //
  // The stdout rule is scoped to `serve`. This subcommand's whole job is to
  // put text on stdout so it can be piped or copied.
  const config = createCommand('config')
    .description(t('commands.mcp.config.description'))
    .option('--client <name>', t('mcp.config.option.client'))
    .action((options: { client?: string }) => {
      const requested = options.client ? findClient(options.client) : undefined;
      if (options.client && !requested) {
        process.stderr.write(
          `${t('mcp.config.unknownClient', { client: options.client, clients: clientIds().join(', ') })}\n`
        );
        process.exitCode = 1;
        return;
      }

      const clients = requested ? [requested] : MCP_CLIENTS;
      const blocks = clients.map((client) => {
        const lines = [`# ${client.title} — ${t('mcp.config.where', { location: client.location })}`];
        if (client.note) {
          lines.push(`# ${client.note}`);
        }

        return `${lines.join('\n')}\n${renderClientConfig(client)}`;
      });

      process.stdout.write(`${blocks.join('\n\n')}\n`);
    });

  return createCommand('mcp')
    .description(t('commands.mcp.description'))
    .addCommand(serve)
    .addCommand(config);
}
