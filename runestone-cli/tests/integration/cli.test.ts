import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');
const node = process.execPath;

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(node, [path.join(root, 'bin', 'runestone'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RUNESTONE_LANG: 'en',
      ...extraEnv,
      FORCE_COLOR: '0'
    }
  });
}

describe('runestone CLI integration', () => {
  beforeAll(() => {
    const build = spawnSync(node, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], {
      cwd: root,
      encoding: 'utf8'
    });

    if (build.status !== 0) {
      throw new Error(build.stderr || build.stdout);
    }
  });

  it('prints top-level help with DESIGNE.md command set', () => {
    const result = runCli(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('setup');
    expect(result.stdout).toContain('doctor');
    expect(result.stdout).toContain('docs');
    expect(result.stdout).toContain('up');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('certs');
    expect(result.stdout).toContain('keys');
  });

  it('prints package version', () => {
    const result = runCli(['--version']);
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('does not expose or accept test-only env/project options on any command', () => {
    const commands = [
      ['setup'],
      ['doctor'],
      ['docs'],
      ['up'],
      ['stop'],
      ['down'],
      ['status'],
      ['certs'],
      ['certs', 'create'],
      ['certs', 'list'],
      ['certs', 'remove'],
      ['keys'],
      ['keys', 'ls'],
      ['keys', 'add']
    ];

    for (const command of commands) {
      const help = runCli([...command, '--help']);
      expect(help.status).toBe(0);
      expect(help.stdout).not.toContain('--env');
      expect(help.stdout).not.toContain('--project');

      const envRejected = runCli([...command, '--env', '.env']);
      expect(envRejected.status).not.toBe(0);
      expect(envRejected.stderr).toContain("unknown option '--env'");

      const projectRejected = runCli([...command, '--project', 'somewhere']);
      expect(projectRejected.status).not.toBe(0);
      expect(projectRejected.stderr).toContain("unknown option '--project'");
    }
  });

  it('hides the options section when help only has the built-in help option', () => {
    const commands = [
      ['setup'],
      ['doctor'],
      ['stop'],
      ['status'],
      ['certs'],
      ['certs', 'create'],
      ['keys'],
      ['keys', 'ls'],
      ['keys', 'add']
    ];

    for (const command of commands) {
      const help = runCli([...command, '--help']);
      expect(help.status).toBe(0);
      expect(help.stdout).not.toContain('Options:');
      expect(help.stdout).not.toContain('-h, --help');
      expect(help.stdout.split('\n')[0]).not.toContain('[options]');
    }
  });

  it('keeps the options section for commands with real options', () => {
    const docs = runCli(['docs', '--help']);
    expect(docs.status).toBe(0);
    expect(docs.stdout).toContain('Options:');
    expect(docs.stdout).toContain('--ai-context');

    const up = runCli(['up', '--help']);
    expect(up.status).toBe(0);
    expect(up.stdout).toContain('Options:');
    expect(up.stdout).toContain('--force-recreate');
    expect(up.stdout).toContain('--no-deps');

    const down = runCli(['down', '--help']);
    expect(down.status).toBe(0);
    expect(down.stdout).toContain('Options:');
    expect(down.stdout).toContain('--remove-network');
    expect(down.stdout).toContain('--remove-volumes');

    const certRemove = runCli(['certs', 'remove', '--help']);
    expect(certRemove.status).toBe(0);
    expect(certRemove.stdout).toContain('Options:');
    expect(certRemove.stdout).toContain('--force');
  });

  it('supports the cert alias for certificate commands', () => {
    const result = runCli(['cert', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('create');
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('remove');
    expect(result.stdout).not.toContain('help [command]');
  });

  it('supports the keys list alias in help output', () => {
    const result = runCli(['keys', 'ls', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('List injected SSH keys');
  });

  it('prints AI compose context with current Runestone setup values', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(homeDir, '.runestone');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, '.env'),
        [
          'HOST_DOMAIN=example.test',
          'PREFIX=mylab',
          'WEB_ENTRYPOINT_NAME=plain',
          'WEB_SECURE_ENTRYPOINT_NAME=secure'
        ].join('\n') + '\n',
        'utf8'
      );

      const result = runCli(['docs', '--ai-context'], {
        HOME: homeDir,
        USERPROFILE: homeDir,
        RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('# Runestone AI Compose Context');
      expect(result.stdout).toContain('External Docker network: mylab-network');
      expect(result.stdout).toContain('Host domain suffix: example.test');
      expect(result.stdout).toContain('HTTPS entrypoint name: secure');
      expect(result.stdout).toContain('Optional HTTP entrypoint name: plain');
      expect(result.stdout).toContain('traefik.http.routers.<router-id>.entrypoints=secure');
      expect(result.stdout).toContain('traefik.http.routers.<router-id>.rule=Host(`<host-prefix>.example.test`)');
      expect(result.stdout).toContain('traefik.docker.network=mylab-network');
      expect(result.stdout).not.toContain('${RUNESTONE_');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires setup before printing AI compose context', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-unconfigured-'));
    const homeDir = path.join(tempDir, 'home');

    try {
      fs.mkdirSync(homeDir, { recursive: true });

      const result = runCli(['docs', '--ai-context'], {
        HOME: homeDir,
        USERPROFILE: homeDir,
        RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Runestone is not configured yet');
      expect(result.stderr).toContain('runestone setup');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('localizes command descriptions for zh-TW and ja-JP', () => {
    const zh = runCli(['up', '--help'], { RUNESTONE_LANG: 'zh-TW' });
    expect(zh.status).toBe(0);
    expect(zh.stdout).toContain('啟動 Runestone 環境');

    const ja = runCli(['up', '--help'], { RUNESTONE_LANG: 'ja-JP' });
    expect(ja.status).toBe(0);
    expect(ja.stdout).toContain('Runestone 環境を起動します');

    const doctor = runCli(['doctor', '--help'], { RUNESTONE_LANG: 'zh-TW' });
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain('檢查並修復 Runestone 主機環境');
  });
});
