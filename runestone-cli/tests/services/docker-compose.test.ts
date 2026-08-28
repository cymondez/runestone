import { spawnSync } from 'child_process';
import * as path from 'path';
import { COMPOSE_SERVICES, composeService } from '../../src/services/docker-compose';

jest.mock('child_process', () => ({
  spawnSync: jest.fn()
}));

const spawnSyncMock = spawnSync as jest.MockedFunction<typeof spawnSync>;

function ok(stdout = '') {
  return {
    status: 0,
    stdout,
    stderr: '',
    pid: 1,
    output: [null, stdout, ''],
    signal: null
  };
}

describe('composeService', () => {
  beforeEach(() => {
    spawnSyncMock.mockReturnValue(ok() as never);
  });

  it('starts compose with project directory, compose file, wait, and recreate flags', () => {
    const composePath = path.resolve('fixtures', 'compose.yml');

    composeService.up(composePath, { wait: true, forceRecreate: true, noDeps: true });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'docker',
      [
        'compose',
        '--project-directory',
        path.dirname(composePath),
        '-f',
        composePath,
        'up',
        '-d',
        '--wait',
        '--force-recreate',
        '--no-deps'
      ],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('adds teardown flags for volumes and images', () => {
    const composePath = path.resolve('compose.yml');

    composeService.down(composePath, { removeVolumes: true, removeImages: true });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['down', '--remove-orphans', '--volumes', '--rmi', 'all']),
      expect.any(Object)
    );
  });

  it('never passes a profile, so a profiled service stays out of every command', () => {
    // The dns service sits behind `profiles: [dns]`. As long as no invocation
    // names that profile, `up` / `stop` / `down` behave exactly as they did
    // before the service existed — which is what keeps the feature off.
    const composePath = path.resolve('compose.yml');

    composeService.up(composePath, { wait: true });
    composeService.stop(composePath);
    composeService.down(composePath);
    composeService.restart(composePath, [COMPOSE_SERVICES.runestone]);
    composeService.pull(composePath);

    expect(spawnSyncMock.mock.calls.length).toBe(5);
    for (const call of spawnSyncMock.mock.calls) {
      expect(call[1]).not.toContain('--profile');
      expect(call[1]).not.toContain('dns');
    }
  });

  it('restarts only the named services', () => {
    const composePath = path.resolve('compose.yml');

    composeService.restart(composePath, [COMPOSE_SERVICES.runestone]);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'docker',
      [
        'compose',
        '--project-directory',
        path.dirname(composePath),
        '-f',
        composePath,
        'restart',
        'runestone'
      ],
      expect.any(Object)
    );
  });

  it('never issues an unscoped restart', () => {
    expect(() => composeService.restart(path.resolve('compose.yml'), [])).toThrow(
      'composeService.restart requires at least one service name'
    );
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('parses docker compose ps JSON array output', () => {
    spawnSyncMock.mockReturnValueOnce(
      ok(JSON.stringify([{ ID: 'abc', Name: 'runestone', State: 'running', Status: 'Up', Service: 'runestone' }])) as never
    );

    expect(composeService.ps('compose.yml')).toEqual([
      {
        Id: 'abc',
        Name: 'runestone',
        State: 'running',
        Status: 'Up',
        Service: 'runestone'
      }
    ]);
  });

  it('parses docker compose ps JSON-lines output', () => {
    spawnSyncMock.mockReturnValueOnce(
      ok('{"ID":"a","Name":"one","State":"running","Status":"Up","Service":"app"}\n') as never
    );

    expect(composeService.ps('compose.yml')[0]).toMatchObject({
      Id: 'a',
      Name: 'one',
      Service: 'app'
    });
  });

  it('throws when docker compose exits with an error', () => {
    spawnSyncMock.mockReturnValueOnce({ ...ok(), status: 1, stderr: 'bad compose' } as never);

    expect(() => composeService.stop('compose.yml')).toThrow('bad compose');
  });
  describe('reporting a failure', () => {
    // Compose draws progress with carriage returns. Printed raw, the terminal
    // replays the overwrites and the last write wins — which is a progress
    // line, not the error. A real port conflict reached a user as
    // "Container runestone-dns Creating".
    function failed(stderr: string) {
      return {
        status: 1,
        stdout: '',
        stderr,
        pid: 1,
        output: [null, '', stderr],
        signal: null
      };
    }

    it('reports what went wrong, not the progress line that overwrote it', () => {
      const stderr =
        ' Container runestone-dns Creating \r'
        + ' Container runestone-dns Created \r'
        + ' Container runestone-dns Starting \r'
        + 'Error response from daemon: Bind for 0.0.0.0:53 failed: port is already allocated';
      spawnSyncMock.mockReturnValue(failed(stderr) as never);

      expect(() => composeService.up('compose.yml')).toThrow(/port is already allocated/);
      expect(() => composeService.up('compose.yml')).not.toThrow(/Creating/);
    });

    it('falls back to the last line when everything looks like progress', () => {
      spawnSyncMock.mockReturnValue(
        failed(' Container a Creating \r Container a Created') as never
      );

      expect(() => composeService.up('compose.yml')).toThrow(/Container a Created/);
    });

    it('says something rather than nothing when compose printed nothing', () => {
      spawnSyncMock.mockReturnValue(failed('') as never);

      expect(() => composeService.up('compose.yml')).toThrow(/unknown error/);
    });
  });

});
