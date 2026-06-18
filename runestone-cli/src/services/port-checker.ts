import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';

interface NodeNetstatAddress {
  address?: string | null;
  port?: number;
}

interface NodeNetstatItem {
  protocol?: string;
  local?: NodeNetstatAddress;
  state?: string;
}

type NodeNetstatHandler = (item: NodeNetstatItem) => boolean | void;
type NodeNetstatDone = (error?: NodeJS.ErrnoException | null) => void;
type NodeNetstat = (
  options: { sync?: boolean; done?: NodeNetstatDone },
  handler: NodeNetstatHandler
) => void;

function addressHasPort(address: string, port: number): boolean {
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[:.]${escapedPort}$`).test(address.trim());
}

export function isListeningLineForPort(line: string, port: number): boolean {
  const parts = line.trim().split(/\s+/);
  if (parts.length === 0) {
    return false;
  }

  const hasListeningState = parts.some((part) => /^LISTEN(?:ING)?$/i.test(part));
  if (!hasListeningState) {
    return false;
  }

  const upperFirst = parts[0].toUpperCase();
  const localAddress =
    upperFirst === 'LISTEN'
      ? parts[3]
      : /^TCP\d*$/i.test(parts[0]) || /^UDP\d*$/i.test(parts[0])
        ? parts[3]?.toUpperCase() === 'LISTEN' || parts[3]?.toUpperCase() === 'LISTENING'
          ? parts[1]
          : parts[3]
        : undefined;

  return Boolean(localAddress && addressHasPort(localAddress, port));
}

export function isNodeNetstatItemListeningForPort(item: NodeNetstatItem, port: number): boolean {
  const protocol = item.protocol?.toLowerCase() ?? '';
  const state = item.state ?? '';
  return protocol.startsWith('tcp') && /^LISTEN(?:ING)?$/i.test(state) && item.local?.port === port;
}

function loadNodeNetstat(): NodeNetstat | undefined {
  try {
    return require('node-netstat') as NodeNetstat;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

function shouldFallbackFromNodeNetstat(error: NodeJS.ErrnoException | undefined | null): boolean {
  return error?.code === 'ENOENT';
}

async function nodeNetstatHasListeningPort(port: number): Promise<boolean | undefined> {
  const nodeNetstat = loadNodeNetstat();
  if (!nodeNetstat) {
    return undefined;
  }

  return new Promise((resolve, reject) => {
    let found = false;
    try {
      nodeNetstat(
        {
          sync: true,
          done: (error) => {
            if (shouldFallbackFromNodeNetstat(error)) {
              resolve(undefined);
              return;
            }
            if (error) {
              reject(error);
              return;
            }

            resolve(found);
          }
        },
        (item) => {
          if (isNodeNetstatItemListeningForPort(item, port)) {
            found = true;
            return false;
          }
          return undefined;
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

export function isProcNetTcpListeningLineForPort(line: string, port: number): boolean {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4 || !/^\d+:$/.test(parts[0])) {
    return false;
  }

  const localAddress = parts[1];
  const state = parts[3];
  const portHex = localAddress.split(':').pop();
  if (!portHex || state.toUpperCase() !== '0A') {
    return false;
  }

  return Number.parseInt(portHex, 16) === port;
}

function procNetHasListeningPort(port: number): boolean | undefined {
  const files = ['/proc/net/tcp', '/proc/net/tcp6'];
  let readAny = false;
  let found = false;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      readAny = true;
      found = found || content.split(/\r?\n/).some((line) => isProcNetTcpListeningLineForPort(line, port));
    } catch {
      continue;
    }
  }

  return readAny ? found : undefined;
}

function localProbeHosts(): string[] {
  const hosts = new Set<string>(['127.0.0.1', '::1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) {
        continue;
      }
      hosts.add(entry.address);
    }
  }
  return [...hosts];
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (connected: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function isPortAvailable(port: number): Promise<boolean> {
  const nodeNetstatListening = await nodeNetstatHasListeningPort(port);
  if (nodeNetstatListening !== undefined) {
    return !nodeNetstatListening;
  }

  if (process.platform === 'linux') {
    const listening = procNetHasListeningPort(port);
    if (listening !== undefined) {
      return !listening;
    }
  }

  for (const host of localProbeHosts()) {
    if (await canConnect(host, port)) {
      return false;
    }
  }

  return true;
}
