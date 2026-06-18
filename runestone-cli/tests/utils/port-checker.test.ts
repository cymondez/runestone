import * as net from 'net';
import {
  isListeningLineForPort,
  isNodeNetstatItemListeningForPort,
  isPortAvailable,
  isProcNetTcpListeningLineForPort
} from '../../src/services/port-checker';

function listen(host: string): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a TCP port'));
        return;
      }

      resolve({ server, port: address.port });
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('port-checker', () => {
  it('does not treat established Windows connections as occupied ports', () => {
    const line = 'TCP    192.168.10.214:1025    172.187.86.73:443      ESTABLISHED     6964';

    expect(isListeningLineForPort(line, 1025)).toBe(false);
  });

  it('treats Windows LISTENING sockets as occupied ports', () => {
    const line = 'TCP    0.0.0.0:1025    0.0.0.0:0      LISTENING     6964';

    expect(isListeningLineForPort(line, 1025)).toBe(true);
  });

  it('matches exact ports only', () => {
    const line = 'TCP    0.0.0.0:11025    0.0.0.0:0      LISTENING     6964';

    expect(isListeningLineForPort(line, 1025)).toBe(false);
  });

  it('supports Linux netstat LISTEN output', () => {
    const line = 'tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN';

    expect(isListeningLineForPort(line, 443)).toBe(true);
  });

  it('supports Linux /proc/net/tcp LISTEN output', () => {
    const line = '   0: 0100007F:0401 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 0 1 0000000000000000 100 0 0 10 0';

    expect(isProcNetTcpListeningLineForPort(line, 1025)).toBe(true);
  });

  it('supports node-netstat parsed LISTEN output', () => {
    expect(
      isNodeNetstatItemListeningForPort(
        {
          protocol: 'tcp',
          local: { address: '127.0.0.1', port: 1025 },
          state: 'LISTEN'
        },
        1025
      )
    ).toBe(true);
  });

  it('ignores node-netstat parsed established connections', () => {
    expect(
      isNodeNetstatItemListeningForPort(
        {
          protocol: 'tcp',
          local: { address: '127.0.0.1', port: 1025 },
          state: 'ESTABLISHED'
        },
        1025
      )
    ).toBe(false);
  });

  it('ignores non-LISTEN Linux /proc/net/tcp output', () => {
    const line = '   1: 0100007F:0401 0100007F:01BB 01 00000000:00000000 00:00000000 00000000 1000 0 0 1 0000000000000000 100 0 0 10 0';

    expect(isProcNetTcpListeningLineForPort(line, 1025)).toBe(false);
  });

  it('reports a port unavailable when a TCP listener accepts local connections', async () => {
    const { server, port } = await listen('127.0.0.1');
    try {
      await expect(isPortAvailable(port)).resolves.toBe(false);
    } finally {
      await close(server);
    }
  });

  it('reports a port available after the local listener is closed', async () => {
    const { server, port } = await listen('127.0.0.1');
    await close(server);

    await expect(isPortAvailable(port)).resolves.toBe(true);
  });
});
