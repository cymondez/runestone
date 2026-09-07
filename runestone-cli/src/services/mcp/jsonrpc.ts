/**
 * JSON-RPC 2.0 over newline-delimited stdio, and the slice of the Model Context
 * Protocol a read-only server needs.
 *
 * Hand-written rather than taken from the SDK. The reason is measured, not
 * aesthetic: the SDK brings 94 transitive production dependencies and about
 * 15 MB for a globally installed CLI, and bundling it to avoid that would ship
 * roughly 364 KB while making dependency security our problem instead of npm's.
 * The protocol surface actually required here is five methods, so this file is
 * the smaller liability.
 *
 * What we now own, and must not forget we own: **protocol drift**. MCP is
 * revising quickly. The process-level handshake test is the thing that catches
 * a break, and the version below is the thing to bump when the spec moves.
 *
 * Nothing here writes to stdout. The transport does, and only frames.
 */

/** The revision this server implements and will echo back. */
export const PROTOCOL_VERSION = '2025-06-18';

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** The subset of the standard codes this server can actually produce. */
export const ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603
} as const;

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function failure(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * A notification carries no id and must never be answered. Getting this wrong
 * is the classic hand-rolled bug: replying to `notifications/initialized`
 * leaves an unmatched response that some clients treat as a protocol error.
 */
export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined || message.id === null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Draft 7, which is what clients expect. */
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  /** Structured payload, for clients that can use it. */
  structuredContent?: unknown;
  /**
   * A condition the model can correct — an unknown topic, an invalid name — is
   * reported here rather than as a JSON-RPC error, so the message carrying the
   * fix reaches the model instead of the client's error path.
   */
  isError?: boolean;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface ServerHandlers {
  listTools: () => ToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Answer one message. Returns `undefined` for a notification, which is the
 * signal not to write anything at all.
 */
export async function handle(
  message: JsonRpcRequest,
  info: ServerInfo,
  handlers: ServerHandlers
): Promise<JsonRpcResponse | undefined> {
  const notification = isNotification(message);
  const id = notification ? null : (message.id as JsonRpcId);

  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return notification ? undefined : failure(id, ERROR.invalidRequest, 'Not a JSON-RPC 2.0 request.');
  }

  try {
    switch (message.method) {
      case 'initialize': {
        // Echo the client's version when we implement it; otherwise state ours
        // and let the client decide whether it can proceed.
        const requested = asRecord(message.params).protocolVersion;
        return success(id as JsonRpcId, {
          protocolVersion: requested === PROTOCOL_VERSION ? requested : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: info
        });
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;

      case 'ping':
        return success(id as JsonRpcId, {});

      case 'tools/list':
        return success(id as JsonRpcId, { tools: handlers.listTools() });

      case 'tools/call': {
        const params = asRecord(message.params);
        const name = params.name;
        if (typeof name !== 'string') {
          return failure(id, ERROR.invalidParams, 'tools/call requires a string "name".');
        }

        return success(id as JsonRpcId, await handlers.callTool(name, asRecord(params.arguments)));
      }

      default:
        return notification
          ? undefined
          : failure(id, ERROR.methodNotFound, `Unknown method '${message.method}'.`);
    }
  } catch (error) {
    // A genuine fault, as opposed to a condition the model can correct — those
    // come back as a successful result carrying isError.
    const detail = error instanceof Error ? error.message : String(error);
    return notification ? undefined : failure(id, ERROR.internal, detail);
  }
}

/**
 * Parse one line and answer it. Kept separate from the transport so the whole
 * protocol is testable without a stream.
 */
export async function handleLine(
  line: string,
  info: ServerInfo,
  handlers: ServerHandlers
): Promise<JsonRpcResponse | undefined> {
  let parsed: JsonRpcRequest;
  try {
    parsed = JSON.parse(line) as JsonRpcRequest;
  } catch {
    // No id is recoverable from unparseable input, so the response carries null,
    // which is what the specification requires.
    return failure(null, ERROR.parse, 'Invalid JSON.');
  }

  if (Array.isArray(parsed)) {
    // Batches are legal JSON-RPC and are not part of the MCP stdio transport.
    // Refusing explicitly beats answering something shaped wrongly.
    return failure(null, ERROR.invalidRequest, 'Batched requests are not supported.');
  }

  return handle(parsed, info, handlers);
}
