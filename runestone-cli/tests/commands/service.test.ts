import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import * as p from '@clack/prompts';
import { listDomainCertificates } from '../../src/services/cert-manager';
import { composeService } from '../../src/services/docker-compose';
import { readTraefikSnapshot } from '../../src/services/traefik-api';
import { envLoader, RunestoneEnv } from '../../src/utils/env-loader';

jest.mock('../../src/services/traefik-api', () => ({
  readTraefikSnapshot: jest.fn()
}));

jest.mock('../../src/services/cert-manager', () => ({
  createDomainCertificate: jest.fn(),
  listDomainCertificates: jest.fn()
}));

jest.mock('../../src/services/docker-compose', () => ({
  composeService: {
    ps: jest.fn(() => [{ State: 'running' }]),
    restart: jest.fn()
  }
}));

jest.mock('../../src/utils/env-loader', () => ({
  envLoader: {
    load: jest.fn()
  }
}));

jest.mock('@clack/prompts', () => ({
  confirm: jest.fn(),
  isCancel: jest.fn(() => false),
  cancel: jest.fn(),
  select: jest.fn(),
  text: jest.fn()
}));

const readTraefikSnapshotMock = readTraefikSnapshot as jest.MockedFunction<typeof readTraefikSnapshot>;
const listDomainCertificatesMock = listDomainCertificates as jest.MockedFunction<typeof listDomainCertificates>;
const confirmMock = p.confirm as jest.MockedFunction<typeof p.confirm>;
const selectMock = p.select as jest.MockedFunction<typeof p.select>;
const textMock = p.text as jest.MockedFunction<typeof p.text>;
const restartMock = composeService.restart as jest.MockedFunction<typeof composeService.restart>;

function config(projectDir: string): RunestoneEnv {
  return {
    HOST_DOMAIN: 'example.test',
    PREFIX: 'runestone',
    HTTPS_PORT: '443',
    HTTP_PORT: '80',
    SMTP_PORT: '1025',
    RUNESTONE_IMAGE: 'cymondez/runestone',
    RUNESTONE_TAG: '5.2',
    MKCERT_INSTALLED: 'true',
    RUNESTONE_VERSION: '5',
    RUNESTONE_LANG: 'en',
    WEB_ENTRYPOINT_PORT: '80',
    WEB_ENTRYPOINT_NAME: 'web',
    WEB_SECURE_ENTRYPOINT_PORT: '443',
    WEB_SECURE_ENTRYPOINT_NAME: 'websecure',
    PROJECT_DIR: projectDir,
    ENV_PATH: path.join(projectDir, '.env'),
    COMPOSE_FILE_PATH: path.join(projectDir, 'compose.yml'),
    NETWORK_NAME: 'runestone-network',
    SSH_VOLUME_NAME: 'runestone-ssh',
    ENV_FILE_EXISTS: true,
    REQUIRED_VARS_PRESENT: true
  };
}

describe('service command', () => {
  let tempDir: string;
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;
  let warnSpy: jest.SpyInstance<void, Parameters<typeof console.warn>>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-service-command-'));
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(tempDir, 'runestone.config.json');
    process.env.RUNESTONE_LANG = 'en';
    (envLoader.load as jest.Mock).mockReturnValue(config(tempDir));
    readTraefikSnapshotMock.mockResolvedValue({ routers: [], services: [] });
    confirmMock.mockResolvedValue(true);
    selectMock.mockResolvedValue('none');
    listDomainCertificatesMock.mockReturnValue([
      {
        status: '✓',
        sans: ['*.example.test'],
        issuer: 'Runestone',
        validUntil: '2030-01-01',
        expiry: '100d',
        certFile: '',
        keyFile: '',
        dynamicConfigFile: ''
      }
    ]);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete process.env.RUNESTONE_TOOL_STATE_PATH;
    delete process.env.RUNESTONE_LANG;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('adds, lists, moves, repairs, and removes a service', async () => {
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'api',
      '--route',
      'api',
      '--url',
      'http://host.docker.internal:3000',
      '--group',
      'apps'
    ]);

    const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ name: string; group: string | null; route: string; url: string }>;
    };
    expect(state.services).toEqual([
      {
        name: 'api',
        group: 'apps',
        route: 'api.example.test',
        url: 'http://host.docker.internal:3000'
      }
    ]);
    expect(fs.existsSync(path.join(tempDir, 'configuration', 'services', 'api.service.yml'))).toBe(true);

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'move', 'api', 'none']);
    const ungroupedState = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ name: string; group: string | null }>;
    };
    expect(ungroupedState.services).toEqual([
      expect.objectContaining({ name: 'api', group: null })
    ]);
    await program.parseAsync(['node', 'runestone', 'service', 'repair', 'api']);
    await program.parseAsync(['node', 'runestone', 'service', 'list', '--no-header']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('api');
    expect(output).toContain('api.example.test');
    expect(output).toContain('ok');

    await program.parseAsync(['node', 'runestone', 'service', 'rm', 'api', '--force']);

    const nextState = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as { services: unknown[] };
    expect(nextState.services).toEqual([]);
    expect(fs.existsSync(path.join(tempDir, 'configuration', 'services', 'api.service.yml'))).toBe(false);
  });

  it('cleans a group while keeping services as ungrouped', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: 'apps', route: 'api.example.test', url: 'http://localhost:3000' },
          { name: 'web', group: 'apps', route: 'web.example.test', url: 'http://localhost:3001' }
        ]
      }),
      'utf8'
    );
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'clean', 'apps', '--force', '--keep-services']);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      services: Array<{ group: string | null }>;
    };
    expect(state.services.map((service) => service.group)).toEqual([null, null]);
  });

  it('restarts once when cleaning a group removes multiple dynamic configs', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: 'apps', route: 'api.example.test', url: 'http://localhost:3000' },
          { name: 'web', group: 'apps', route: 'web.example.test', url: 'http://localhost:3001' }
        ]
      }),
      'utf8'
    );
    const configDir = path.join(tempDir, 'configuration', 'services');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'api.service.yml'), '# Generated by runestone service-manager.\nhttp: {}\n', 'utf8');
    fs.writeFileSync(path.join(configDir, 'web.service.yml'), '# Generated by runestone service-manager.\nhttp: {}\n', 'utf8');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'clean', 'apps', '--force']);

    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it('prints service group tree with line connectors in detail mode', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'ollama', group: 'ollama', route: 'app.ollama.docker.so', url: 'http://host.docker.internal:11434' },
          { name: 'ollama-api', group: 'ollama', route: 'api.ollama.docker.so', url: 'http://host.docker.internal:11434' }
        ]
      }),
      'utf8'
    );
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'ls', '--tree', '--detail']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('ollama\n├── ollama  app.ollama.docker.so  http://host.docker.internal:11434');
    expect(output).toContain('└── ollama-api  api.ollama.docker.so  http://host.docker.internal:11434');
  });

  it('prompts for missing service group move arguments', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: '', route: 'api.example.test', url: 'http://localhost:3000' }
        ]
      }),
      'utf8'
    );
    textMock
      .mockResolvedValueOnce('api')
      .mockResolvedValueOnce('apps');
    selectMock.mockResolvedValueOnce('__runestone_create_group__');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'mv']);

    expect(textMock.mock.calls[0][0]).toMatchObject({ message: 'Service name' });
    expect(selectMock.mock.calls[0][0]).toMatchObject({ message: 'Group' });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Group' });
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      services: Array<{ name: string; group: string | null }>;
    };
    expect(state.services).toEqual([
      expect.objectContaining({ name: 'api', group: 'apps' })
    ]);
  });

  it('stores none group moves as null metadata', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: 'apps', route: 'api.example.test', url: 'http://localhost:3000' }
        ]
      }),
      'utf8'
    );
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'mv', 'api', 'none']);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      services: Array<{ name: string; group: string | null }>;
    };
    expect(state.services).toEqual([
      expect.objectContaining({ name: 'api', group: null })
    ]);
  });

  it('does not restart the container when moving a service between groups', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: null, route: 'api.example.test', url: 'http://localhost:3000' }
        ]
      }),
      'utf8'
    );
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'group', 'mv', 'api', 'apps']);

    expect(restartMock).not.toHaveBeenCalled();
  });

  it('prints service list headers with group and service name columns', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: 'apps', route: 'api.example.test', url: 'http://localhost:3000' },
          { name: 'web', group: '', route: 'web.example.test', url: 'http://localhost:3001' }
        ]
      }),
      'utf8'
    );
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'ls']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Group Name  Service Name  Route');
    expect(output).toContain('apps        api');
    expect(output).toContain('none        web');
    expect(output).toContain('URL');
    expect(output).toContain('Config');
  });

  it('offers to replace localhost upstream URLs with host.docker.internal', async () => {
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'ollama',
      '--route',
      'ollama',
      '--url',
      'http://127.0.0.1:11434'
    ]);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('host.docker.internal')
      })
    );
    const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ url: string }>;
    };
    expect(state.services[0].url).toBe('http://host.docker.internal:11434');
  });

  it('preserves upstream URL paths when replacing localhost during add', async () => {
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'ollama',
      '--route',
      'ollama',
      '--url',
      'http://127.0.0.1:11434/v1'
    ]);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('host.docker.internal')
      })
    );
    const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ url: string }>;
    };
    expect(state.services[0].url).toBe('http://host.docker.internal:11434/v1');
  });

  it('checks localhost upstream URLs before asking for group in interactive add', async () => {
    textMock
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('http://127.0.0.1:11434');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(textMock.mock.calls[0][0]).toMatchObject({ message: 'Route domain' });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Service URL' });
    expect(selectMock.mock.calls[0][0]).toMatchObject({ message: 'Group' });
    expect(confirmMock.mock.invocationCallOrder[0]).toBeLessThan(selectMock.mock.invocationCallOrder[0]);
  });

  it('lets interactive service add choose an existing group from a select menu', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: 'apps', route: 'api.example.test', url: 'http://localhost:3000' }
        ]
      }),
      'utf8'
    );
    textMock
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    selectMock.mockResolvedValueOnce('apps');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Group',
        options: expect.arrayContaining([
          expect.objectContaining({ value: 'none' }),
          expect.objectContaining({ value: 'apps', label: 'apps' }),
          expect.objectContaining({ value: '__runestone_create_group__' })
        ])
      })
    );
    expect(textMock).toHaveBeenCalledTimes(2);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      services: Array<{ name: string; group: string | null }>;
    };
    expect(state.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ollama', group: 'apps' })
    ]));
  });

  it('does not show existing group options when only ungrouped services exist', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'api', group: null, route: 'api.example.test', url: 'http://localhost:3000' },
          { name: 'web', group: 'none', route: 'web.example.test', url: 'http://localhost:3001' }
        ]
      }),
      'utf8'
    );
    textMock
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    selectMock.mockResolvedValueOnce('none');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          expect.objectContaining({ value: 'none' }),
          expect.objectContaining({ value: '__runestone_create_group__' })
        ]
      })
    );
  });

  it('keeps the URL prompt active when URL validation fails', async () => {
    textMock
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('http://')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(textMock.mock.calls[0][0]).toMatchObject({ message: 'Route domain' });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Service URL' });
    expect(textMock.mock.calls[2][0]).toMatchObject({ message: 'Service URL' });
    expect(selectMock.mock.calls[0][0]).toMatchObject({ message: 'Group' });
    expect(textMock.mock.calls[2][0]).toMatchObject({
      frame: { description: 'URL must be in the form http://host:port or https://host:port' }
    });
  });

  it('checks route host conflicts before asking for URL in interactive add', async () => {
    readTraefikSnapshotMock
      .mockResolvedValueOnce({ routers: [], services: [] })
      .mockResolvedValueOnce({
        routers: [{ name: 'other@docker', rule: 'Host(`app.ollama.example.test`)' }],
        services: []
      })
      .mockResolvedValueOnce({ routers: [], services: [] })
      .mockResolvedValueOnce({ routers: [], services: [] });
    textMock
      .mockResolvedValueOnce('app.ollama.example.test')
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(textMock.mock.calls[0][0]).toMatchObject({ message: 'Route domain' });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Route domain' });
    expect(textMock.mock.calls[2][0]).toMatchObject({ message: 'Service URL' });
    expect(selectMock.mock.calls[0][0]).toMatchObject({ message: 'Group' });
    expect(textMock.mock.calls[1][0]).toMatchObject({
      frame: { description: expect.stringContaining('Host(`app.ollama.example.test`)') }
    });
    expect((textMock.mock.calls[1][0] as unknown as { frame: { description: string } }).frame.description).toContain('other@docker');
  });

  it('uses a route base domain select when a route cannot create a wildcard certificate', async () => {
    textMock
      .mockResolvedValueOnce('app.ollam')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    selectMock
      .mockResolvedValueOnce('example.test')
      .mockResolvedValueOnce('none');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(selectMock.mock.calls[0][0]).toMatchObject({
      message: 'Route base domain',
      frame: { description: "Cannot create a wildcard certificate for 'app.ollam'. Use a route with at least three labels." },
      options: [
        expect.objectContaining({ value: 'example.test', label: 'app.ollam.example.test', hint: '*.example.test' }),
        expect.objectContaining({ value: '__runestone_manual_route__', label: 'Enter full route manually' })
      ]
    });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Service URL' });
    expect(selectMock.mock.calls[1][0]).toMatchObject({ message: 'Group' });
    const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ route: string }>;
    };
    expect(state.services[0].route).toBe('app.ollam.example.test');
  });

  it('merges route suffix with overlapping certificate base domain labels', async () => {
    listDomainCertificatesMock.mockReturnValue([
      {
        status: '✓',
        sans: ['*.ollama.docker.so', '*.docker.so'],
        issuer: 'Runestone',
        validUntil: '2030-01-01',
        expiry: '100d',
        certFile: '',
        keyFile: '',
        dynamicConfigFile: ''
      }
    ]);
    textMock
      .mockResolvedValueOnce('app.ollama')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    selectMock
      .mockResolvedValueOnce('ollama.docker.so')
      .mockResolvedValueOnce('none');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(selectMock.mock.calls[0][0]).toMatchObject({
      message: 'Route base domain',
      options: [
        expect.objectContaining({ value: 'ollama.docker.so', label: 'app.ollama.docker.so', hint: '*.ollama.docker.so' }),
        expect.objectContaining({ value: '__runestone_manual_route__', label: 'Enter full route manually' })
      ]
    });
    expect(selectMock.mock.calls[0][0].options).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'docker.so', label: 'app.ollama.docker.so' })
    ]));
    const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ route: string }>;
    };
    expect(state.services[0].route).toBe('app.ollama.docker.so');
  });

  it('uses the route base domain select during service modify', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'ollama', group: 'apps', route: 'old.ollama.example.test', url: 'http://host.docker.internal:11434' }
        ]
      }),
      'utf8'
    );
    textMock
      .mockResolvedValueOnce('app.ollama')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    selectMock
      .mockResolvedValueOnce('example.test')
      .mockResolvedValueOnce('none');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'modify', 'ollama']);

    expect(selectMock.mock.calls[0][0]).toMatchObject({
      message: 'Route base domain',
      frame: { description: "Cannot create a wildcard certificate for 'app.ollama'. Use a route with at least three labels." },
      options: [
        expect.objectContaining({ value: 'example.test', label: 'app.ollama.example.test', hint: '*.example.test' }),
        expect.objectContaining({ value: '__runestone_manual_route__', label: 'Enter full route manually' })
      ]
    });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Service URL' });
    expect(selectMock.mock.calls[1][0]).toMatchObject({ message: 'Group' });
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      services: Array<{ name: string; group: string | null; route: string; url: string }>;
    };
    expect(state.services).toEqual([
      expect.objectContaining({
        name: 'ollama',
        group: null,
        route: 'app.ollama.example.test',
        url: 'http://host.docker.internal:11434'
      })
    ]);
  });

  it('preserves upstream URL paths during service modify', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'ollama', group: 'apps', route: 'app.ollama.example.test', url: 'http://host.docker.internal:11434' }
        ]
      }),
      'utf8'
    );
    textMock
      .mockResolvedValueOnce('app.ollama.example.test')
      .mockResolvedValueOnce('http://127.0.0.1:11434/v1?debug=true');
    selectMock.mockResolvedValueOnce('apps');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'modify', 'ollama']);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      services: Array<{ url: string }>;
    };
    expect(state.services[0].url).toBe('http://host.docker.internal:11434/v1?debug=true');
  });

  it('keeps route host conflict feedback in the route prompt during service modify', async () => {
    const statePath = path.join(tempDir, 'runestone.config.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        services: [
          { name: 'ollama', group: 'apps', route: 'old.ollama.example.test', url: 'http://host.docker.internal:11434' }
        ]
      }),
      'utf8'
    );
    readTraefikSnapshotMock
      .mockResolvedValueOnce({
        routers: [{ name: 'other@docker', rule: 'Host(`api.example.test`)' }],
        services: []
      })
      .mockResolvedValueOnce({ routers: [], services: [] });
    textMock
      .mockResolvedValueOnce('api.example.test')
      .mockResolvedValueOnce('web.example.test')
      .mockResolvedValueOnce('http://host.docker.internal:11434');
    selectMock.mockResolvedValueOnce('none');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'modify', 'ollama']);

    expect(textMock.mock.calls[0][0]).toMatchObject({ message: 'Route domain' });
    expect(textMock.mock.calls[1][0]).toMatchObject({
      message: 'Route domain',
      frame: { description: expect.stringContaining('Host(`api.example.test`)') }
    });
    expect((textMock.mock.calls[1][0] as unknown as { frame: { description: string } }).frame.description).toContain('other@docker');
    expect(textMock.mock.calls[2][0]).toMatchObject({ message: 'Service URL' });
  });

  it('localizes wildcard certificate prompts and names the certificate that will be created', async () => {
    process.env.RUNESTONE_LANG = 'zh-TW';
    listDomainCertificatesMock.mockReturnValue([]);
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'ollama',
      '--route',
      'app.ollama.docker.so',
      '--url',
      'http://host.docker.internal:11434'
    ]);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '找不到可套用於 app.ollama.docker.so 的萬用字元憑證。是否建立 *.ollama.docker.so 憑證？'
      })
    );
  });

  it('warns instead of failing when removing a service that is not in metadata', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'rm', 'missing', '--force']);

    const output = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain("Service 'missing' was not found in Runestone metadata or dynamic config.");
  });

  it('removes stale dynamic config even when metadata is missing', async () => {
    const configDir = path.join(tempDir, 'configuration', 'services');
    fs.mkdirSync(configDir, { recursive: true });
    const serviceConfig = path.join(configDir, 'ollama.service.yml');
    fs.writeFileSync(serviceConfig, '# Generated by runestone service-manager.\nhttp: {}\n', 'utf8');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'rm', 'ollama', '--force']);

    expect(fs.existsSync(serviceConfig)).toBe(false);
    expect(restartMock).toHaveBeenCalled();
    const output = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain("Removing matching dynamic config only.");
  });

  it('rejects non-managed dynamic config when metadata is missing', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const configDir = path.join(tempDir, 'configuration', 'services');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'ollama.service.yml'), 'http: {}\n', 'utf8');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'rm', 'ollama', '--force']);

    const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('is not marked as Runestone-managed');
    expect(fs.existsSync(path.join(configDir, 'ollama.service.yml'))).toBe(true);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('explains Traefik-only name conflicts during add', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    readTraefikSnapshotMock.mockResolvedValue({
      routers: [{ name: 'ollama@file' }],
      services: []
    });
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'ollama',
      '--route',
      'ollama',
      '--url',
      'http://host.docker.internal:11434'
    ]);

    const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('file provider');
    expect(output).toContain('conflicts with router ollama@file');
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('asks for another service name before route details when interactive add has a name conflict', async () => {
    readTraefikSnapshotMock
      .mockResolvedValueOnce({
        routers: [{ name: 'ollama@docker' }],
        services: []
      })
      .mockResolvedValueOnce({ routers: [], services: [] })
      .mockResolvedValueOnce({ routers: [], services: [] });
    textMock
      .mockResolvedValueOnce('ollama2')
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('http://host.docker.internal:11434')
      .mockResolvedValueOnce('apps');
    selectMock.mockResolvedValueOnce('__runestone_create_group__');
    const program = createProgram();

    await program.parseAsync(['node', 'runestone', 'service', 'add', 'ollama']);

    expect(textMock.mock.calls[0][0]).toMatchObject({ message: 'Service name' });
    expect(textMock.mock.calls[1][0]).toMatchObject({ message: 'Route domain' });
    expect((textMock.mock.calls[0][0] as unknown as { frame: { description: string } }).frame.description).toContain('ollama@docker');
    expect((textMock.mock.calls[0][0] as unknown as { frame: { description: string } }).frame.description).toContain('docker provider');
    const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'runestone.config.json'), 'utf8')) as {
      services: Array<{ name: string; route: string; url: string; group: string | null }>;
    };
    expect(state.services).toEqual([
      {
        name: 'ollama2',
        route: 'ollama.example.test',
        url: 'http://host.docker.internal:11434',
        group: 'apps'
      }
    ]);
  });

  it('reports route host conflicts with provider source', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    readTraefikSnapshotMock.mockResolvedValueOnce({ routers: [], services: [] });
    readTraefikSnapshotMock.mockResolvedValueOnce({
      routers: [{ name: 'other@docker', rule: 'Host(`api.example.test`)' }],
      services: []
    });
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'api',
      '--route',
      'api',
      '--url',
      'http://host.docker.internal:3000'
    ]);

    const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Host(`api.example.test`)');
    expect(output).toContain('other@docker');
    expect(output).toContain('docker provider');
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('checks direct route host conflicts before localhost URL replacement prompts', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    readTraefikSnapshotMock.mockResolvedValueOnce({ routers: [], services: [] });
    readTraefikSnapshotMock.mockResolvedValueOnce({
      routers: [{ name: 'other@docker', rule: 'Host(`api.example.test`)' }],
      services: []
    });
    const program = createProgram();

    await program.parseAsync([
      'node',
      'runestone',
      'service',
      'add',
      'api',
      '--route',
      'api',
      '--url',
      'http://127.0.0.1:3000'
    ]);

    expect(confirmMock).not.toHaveBeenCalled();
    const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Host(`api.example.test`)');
    expect(output).toContain('other@docker');
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
