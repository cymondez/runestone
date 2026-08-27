import { spawnSync } from 'child_process';
import * as path from 'path';
import { COMPOSE_SERVICES, composeService } from '../../src/services/docker-compose';
import { buildComposeFile } from '../../src/utils/project-files';

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

  it('names services that the generated compose file actually declares', () => {
    const compose = buildComposeFile();

    for (const service of Object.values(COMPOSE_SERVICES)) {
      expect(compose).toContain(`
  ${service}:
`);
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
});
