/**
 * The server: tool definitions, dispatch, and the stdio loop.
 *
 * **stdout carries protocol frames and nothing else.** That is why this module
 * imports no logger — `logger.info`, `logger.success` and `logger.debug` all
 * write to stdout, so "route warnings carefully" is not the rule; "do not
 * import it" is. Diagnostics go to stderr through `./log`.
 */

import * as readline from 'readline';
import { buildLiveSnapshot, buildOfflineSnapshot } from '../agent-context/snapshot';
import { RunestoneEnv, envLoader } from '../../utils/env-loader';
import { findTopic } from '../../utils/tool-docs';
import {
  JsonRpcResponse,
  PROTOCOL_VERSION,
  ServerHandlers,
  ServerInfo,
  ToolDefinition,
  ToolResult,
  handleLine
} from './jsonrpc';
import { CONTEXT_TOPICS, checkName, renderContextTopic } from './tools';
import { debug } from './log';

const OFFLINE_PROPERTY = {
  type: 'boolean',
  description: 'Read files only: skip Docker and the Traefik API.'
} as const;

export const TOOLS: ToolDefinition[] = [
  {
    name: 'runestone_context',
    description:
      'Guidance for connecting a project to Runestone: which of the two integration paths applies, the exact field ' +
      'rules, and how to diagnose a route that does not work. Start here.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: CONTEXT_TOPICS,
          description: 'Which topic to return. Defaults to overview.'
        },
        offline: OFFLINE_PROPERTY
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'runestone_status',
    description:
      'The machine facts as structured data: covered domains, certificates, routed services, container state, and the ' +
      'router names other projects have registered.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { offline: OFFLINE_PROPERTY },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'runestone_check_name',
    description:
      'Whether a service name and a route are free, and why not when they are not. A Traefik router ID is global, so a ' +
      'name free in this project may already be taken by another one. Call this before writing any configuration.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        serviceName: { type: 'string', description: 'Candidate service name.' },
        route: { type: 'string', description: 'Candidate hostname.' },
        offline: OFFLINE_PROPERTY
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }
];

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) };
}

export interface ServerDependencies {
  loadConfig: () => RunestoneEnv;
  isConfigured: (config: RunestoneEnv) => boolean;
}

export const defaultServerDependencies: ServerDependencies = {
  loadConfig: () => envLoader.load(),
  isConfigured: (config) => envLoader.hasRequiredVars(config)
};

/**
 * An unconfigured Runestone is a **successful** result here, unlike on the CLI
 * path where exit 1 with empty stdout is the contract. A tool call that fails
 * gives the model an error to route around; a tool call that succeeds and says
 * "Runestone is not set up, ask the user to run `runestone setup`" gives it
 * something to do.
 */
function notConfigured(): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text:
          'Runestone is installed but not configured on this machine, so there is nothing to connect a project to yet. ' +
          'Ask the user to run `runestone setup`.'
      }
    ],
    structuredContent: { configured: false }
  };
}

export function createHandlers(deps: Partial<ServerDependencies> = {}): ServerHandlers {
  const { loadConfig, isConfigured } = { ...defaultServerDependencies, ...deps };

  return {
    listTools: () => TOOLS,
    callTool: async (name, args) => {
      const config = loadConfig();
      if (!isConfigured(config)) {
        return notConfigured();
      }

      const offline = args.offline === true;
      const wantsLive = !offline && (name !== 'runestone_context' || args.topic === 'state' || args.topic === 'all');
      const snapshot = wantsLive ? await buildLiveSnapshot(config) : buildOfflineSnapshot(config);

      switch (name) {
        case 'runestone_context': {
          const topic = typeof args.topic === 'string' ? args.topic : 'overview';
          if (topic !== 'all' && !findTopic(topic)) {
            // Correctable by the model, so it is a result rather than an error:
            // the message naming the valid topics has to reach the model.
            return text(`Unknown topic '${topic}'. Available topics: ${CONTEXT_TOPICS.join(', ')}.`, true);
          }

          const body = renderContextTopic(topic, config, snapshot);
          return topic === 'state' || topic === 'all'
            ? { ...text(body), structuredContent: snapshot }
            : text(body);
        }

        case 'runestone_status':
          return {
            ...text(
              `Runestone on ${config.HOST_DOMAIN}: ${snapshot.services.length} routed service(s), ` +
                `${snapshot.domains.wildcards.length + snapshot.domains.covered.length} covered name(s).`
            ),
            structuredContent: snapshot
          };

        case 'runestone_check_name': {
          const serviceName = typeof args.serviceName === 'string' ? args.serviceName : undefined;
          const route = typeof args.route === 'string' ? args.route : undefined;
          if (serviceName === undefined && route === undefined) {
            return text('Give at least one of serviceName or route.', true);
          }

          const verdict = checkName({ serviceName, route }, config, snapshot);
          return { ...text(JSON.stringify(verdict, null, 2)), structuredContent: verdict };
        }

        default:
          return text(`Unknown tool '${name}'. Available tools: ${TOOLS.map((tool) => tool.name).join(', ')}.`, true);
      }
    }
  };
}

export const SERVER_INFO: ServerInfo = { name: 'runestone', version: '' };

/**
 * Read newline-delimited JSON from stdin, write newline-delimited JSON to
 * stdout, and resolve when the stream closes.
 *
 * Resolving rather than exiting matters: the caller lets the event loop drain
 * so buffered frames actually reach the client.
 */
export function serveStdio(
  info: ServerInfo,
  handlers: ServerHandlers,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): Promise<void> {
  return new Promise((resolve) => {
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const pending: Array<Promise<void>> = [];

    lines.on('line', (line) => {
      if (line.trim().length === 0) {
        return;
      }

      const answered = handleLine(line, info, handlers)
        .then((response?: JsonRpcResponse) => {
          if (response) {
            output.write(`${JSON.stringify(response)}\n`);
          }
        })
        .catch((error: unknown) => {
          debug(`unhandled: ${error instanceof Error ? error.message : String(error)}`);
        });

      pending.push(answered);
    });

    lines.on('close', () => {
      // Every in-flight answer is written before the promise settles, or a
      // client that closes promptly loses the reply it was waiting for.
      void Promise.all(pending).then(() => resolve());
    });
  });
}

export { PROTOCOL_VERSION };
