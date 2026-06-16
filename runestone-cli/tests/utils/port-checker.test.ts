import { spawnSync } from 'child_process';
import { isListeningLineForPort, isPortAvailable } from '../../src/services/port-checker';

jest.mock('child_process', () => ({
  spawnSync: jest.fn()
}));

const spawnSyncMock = spawnSync as jest.MockedFunction<typeof spawnSync>;

function netstat(stdout: string) {
  spawnSyncMock.mockReturnValue({
    status: 0,
    stdout,
    stderr: '',
    pid: 1,
    output: [null, stdout, ''],
    signal: null
  } as never);
}

describe('port-checker', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

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

  it('reports a port available when netstat only shows established connections', async () => {
    netstat('TCP    192.168.10.214:1025    172.187.86.73:443      ESTABLISHED     6964\n');

    await expect(isPortAvailable(1025)).resolves.toBe(true);
  });

  it('reports a port unavailable when netstat shows a listener', async () => {
    netstat('TCP    0.0.0.0:1025    0.0.0.0:0      LISTENING     6964\n');

    await expect(isPortAvailable(1025)).resolves.toBe(false);
  });
});
