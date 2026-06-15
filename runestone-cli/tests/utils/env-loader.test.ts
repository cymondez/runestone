import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { envLoader } from '../../src/utils/env-loader';
import { pathHelpers } from '../../src/utils/path-helpers';
import { buildComposeFile, ensureProjectFiles } from '../../src/utils/project-files';

describe('env and project helpers', () => {
  let tempDir: string;
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-env-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads defaults but marks missing env as not configured', () => {
    const config = envLoader.load(undefined, tempDir);

    expect(config.HOST_DOMAIN).toBe('local.developers-homelab.net');
    expect(config.PREFIX).toBe('runestone');
    expect(envLoader.hasRequiredVars(config)).toBe(false);
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

  it('uses cwd .env before the runestone project .env', () => {
    const projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, '.env'), 'HOST_DOMAIN=cwd.test\nPREFIX=cwd\n');
    process.chdir(projectDir);

    expect(envLoader.load().HOST_DOMAIN).toBe('cwd.test');
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
