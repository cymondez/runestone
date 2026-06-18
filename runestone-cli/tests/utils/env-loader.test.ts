import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { envLoader } from '../../src/utils/env-loader';
import { pathHelpers } from '../../src/utils/path-helpers';
import { buildComposeFile, ensureProjectFiles } from '../../src/utils/project-files';
import { toolState } from '../../src/utils/tool-state';

describe('env and project helpers', () => {
  let tempDir: string;
  let cwd: string;
  let originalToolStatePath: string | undefined;

  beforeEach(() => {
    cwd = process.cwd();
    originalToolStatePath = process.env.RUNESTONE_TOOL_STATE_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-env-'));
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(tempDir, 'tool', 'runestone.config.json');
  });

  afterEach(() => {
    process.chdir(cwd);
    if (originalToolStatePath === undefined) {
      delete process.env.RUNESTONE_TOOL_STATE_PATH;
    } else {
      process.env.RUNESTONE_TOOL_STATE_PATH = originalToolStatePath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads defaults but marks missing env as not configured', () => {
    const config = envLoader.load(undefined, tempDir);

    expect(config.HOST_DOMAIN).toBe('local.developers-homelab.net');
    expect(config.PREFIX).toBe('runestone');
    expect(envLoader.hasRequiredVars(config)).toBe(false);
  });

  it('stores the default tool state file under ~/.runestone', () => {
    delete process.env.RUNESTONE_TOOL_STATE_PATH;

    try {
      expect(toolState.stateFilePath()).toBe(path.join(os.homedir(), '.runestone', 'runestone.config.json'));
    } finally {
      process.env.RUNESTONE_TOOL_STATE_PATH = path.join(tempDir, 'tool', 'runestone.config.json');
    }
  });

  it('prefers explicit env path and derives resource names', () => {
    const envPath = path.join(tempDir, 'custom.env');
    fs.writeFileSync(envPath, 'HOST_DOMAIN=local.test\nPREFIX=stone\n');

    const config = envLoader.load(envPath);

    expect(config.HOST_DOMAIN).toBe('local.test');
    expect(config.NETWORK_NAME).toBe('stone-network');
    expect(config.SSH_VOLUME_NAME).toBe('stone-ssh');
    expect(envLoader.hasRequiredVars(config)).toBe(true);
  });

  it('uses the tool-level Runestone path pointer instead of cwd .env', () => {
    const configuredDir = path.join(tempDir, 'configured-runestone');
    const cwdDir = path.join(tempDir, 'cwd-project');
    fs.mkdirSync(configuredDir);
    fs.mkdirSync(cwdDir);
    fs.writeFileSync(path.join(configuredDir, '.env'), 'HOST_DOMAIN=configured.test\nPREFIX=configured\n');
    fs.writeFileSync(path.join(cwdDir, '.env'), 'HOST_DOMAIN=cwd.test\nPREFIX=cwd\n');
    toolState.writeRunestonePath(configuredDir);
    process.chdir(cwdDir);

    const config = envLoader.load();
    expect(config.HOST_DOMAIN).toBe('configured.test');
    expect(config.PROJECT_DIR).toBe(path.resolve(configuredDir));
    expect(config.ENV_PATH).toBe(path.join(path.resolve(configuredDir), '.env'));
  });

  it('stores Runestone path and locale in tool state instead of .env', () => {
    const projectDir = path.join(tempDir, 'custom-runestone');
    const envPath = path.join(projectDir, '.env');
    toolState.writeSetupState({ runestonePath: projectDir, locale: 'zh-TW' });
    envLoader.write(envPath, { HOST_DOMAIN: 'custom.test', PREFIX: 'custom' });

    expect(toolState.readRunestonePath()).toBe(path.resolve(projectDir));
    expect(toolState.readLocale()).toBe('zh-TW');
    expect(JSON.parse(fs.readFileSync(toolState.stateFilePath(), 'utf8'))).toEqual({
      runestonePath: path.resolve(projectDir),
      locale: 'zh-TW'
    });
    expect(fs.readFileSync(envPath, 'utf8')).not.toMatch(/RUNESTONE_PATH|RUNESTONE_LANG|PROJECT_DIR|ENV_PATH|COMPOSE_FILE_PATH/i);
    expect(envLoader.load(envPath, projectDir).RUNESTONE_LANG).toBe('zh-TW');
  });

  it('writes compose and project directories', () => {
    const projectDir = path.join(tempDir, 'project');
    const config = envLoader.load(path.join(projectDir, '.env'), projectDir);
    ensureProjectFiles(config);

    expect(fs.existsSync(path.join(projectDir, 'compose.yml'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'certs'))).toBe(true);
    expect(buildComposeFile()).toContain('services:');
  });

  it('normalizes Windows paths for WSL-style mounts', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });

    expect(pathHelpers.normalizePath('C:\\Users\\dev\\.ssh')).toBe('/mnt/c/Users/dev/.ssh');

    Object.defineProperty(process, 'platform', original as PropertyDescriptor);
  });
});
