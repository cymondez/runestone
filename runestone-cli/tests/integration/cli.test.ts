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
      ['keys', 'add'],
      ['skill'],
      ['skill', 'install'],
      ['skill', 'status'],
      ['skill', 'remove']
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
      ['status'],
      ['certs'],
      ['certs', 'create'],
      ['keys'],
      ['keys', 'ls'],
      ['keys', 'add'],
      // The parent carries no options of its own, deliberately: every flag
      // lives on a subcommand so this assertion keeps holding.
      ['skill']
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

    // `stop` gained one in M7: --all is the only way to stop the dns service,
    // and it has to be visible for the disclosure about it to mean anything.
    const stop = runCli(['stop', '--help']);
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain('Options:');
    expect(stop.stdout).toContain('--all');
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
      // The corpus moved to {{...}} because the old delimiter collides with the
      // Compose interpolation the brief has to emit verbatim. Without this line
      // the assertion above no longer proves anything.
      expect(result.stdout).not.toContain('{{');
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

  it('prints every agent context topic offline, with a clean stderr', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-topics-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(homeDir, '.runestone');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, '.env'),
        ['HOST_DOMAIN=example.test', 'PREFIX=mylab', 'WEB_ENTRYPOINT_NAME=plain', 'WEB_SECURE_ENTRYPOINT_NAME=secure'].join('\n'),
        'utf8'
      );

      // Every shipped topic is offline, so each must succeed with no Docker on
      // this machine and must not write to stderr — that empty stderr is what
      // makes stdout safe to pipe straight into a prompt.
      // `state` is excluded here on purpose: it is the one online topic, so
      // its output depends on whether Docker happens to be running on the
      // machine the suite runs on. Its behaviour is asserted with injected
      // probes in tests/commands/docs.test.ts instead.
      for (const topic of ['compose', 'service', 'troubleshoot', 'overview']) {
        const result = runCli(['docs', '--ai-context', topic], {
          HOME: homeDir,
          USERPROFILE: homeDir,
          RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.length).toBeGreaterThan(0);
        expect(result.stdout).not.toContain('{{');
        // The footer is what makes the other topics discoverable from a bare
        // invocation, so it has to be on every one of them.
        expect(result.stdout).toContain('More Runestone context');
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports the second integration path, which the old context omitted', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-service-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(homeDir, '.runestone');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.env'), 'HOST_DOMAIN=example.test\nPREFIX=mylab\n', 'utf8');

      const result = runCli(['docs', '--ai-context', 'service'], {
        HOME: homeDir,
        USERPROFILE: homeDir,
        RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('runestone service add');
      // The mirror image of the label-path mistake: localhost inside the
      // Runestone container is that container.
      expect(result.stdout).toContain('host.docker.internal');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown topic and names the valid ones', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-badtopic-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(homeDir, '.runestone');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.env'), 'HOST_DOMAIN=example.test\nPREFIX=mylab\n', 'utf8');

      const result = runCli(['docs', '--ai-context', 'nope'], {
        HOME: homeDir,
        USERPROFILE: homeDir,
        RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
      });

      expect(result.status).toBe(1);
      // Empty stdout is the contract: exit 1 means this output is unusable, so
      // an agent piping stdout must never receive a partial document.
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Unknown topic');
      expect(result.stderr).toContain('compose');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires setup before printing any topic, not just the default', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-unconfigured-topics-'));
    const homeDir = path.join(tempDir, 'home');

    try {
      fs.mkdirSync(homeDir, { recursive: true });

      // `state` is excluded here on purpose: it is the one online topic, so
      // its output depends on whether Docker happens to be running on the
      // machine the suite runs on. Its behaviour is asserted with injected
      // probes in tests/commands/docs.test.ts instead.
      for (const topic of ['compose', 'service', 'troubleshoot', 'overview', 'state']) {
        const result = runCli(['docs', '--ai-context', topic], {
          HOME: homeDir,
          USERPROFILE: homeDir,
          RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('runestone setup');
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts --offline on the context path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-offline-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(homeDir, '.runestone');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.env'), 'HOST_DOMAIN=example.test\nPREFIX=mylab\n', 'utf8');

      const result = runCli(['docs', '--ai-context', '--offline'], {
        HOME: homeDir,
        USERPROFILE: homeDir,
        RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('# Runestone AI Compose Context');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('localizes the unknown-topic error in all three languages', () => {
    // MessageKey is derived from the `en` table alone, so a missing zh-TW or
    // ja-JP entry compiles and silently falls back to English at runtime.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-docs-locale-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(homeDir, '.runestone');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.env'), 'HOST_DOMAIN=example.test\nPREFIX=mylab\n', 'utf8');

      const env = {
        HOME: homeDir,
        USERPROFILE: homeDir,
        RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json')
      };

      const zh = runCli(['docs', '--ai-context', 'nope'], { ...env, RUNESTONE_LANG: 'zh-TW' });
      expect(zh.stderr).toContain('未知的主題');

      const ja = runCli(['docs', '--ai-context', 'nope'], { ...env, RUNESTONE_LANG: 'ja-JP' });
      expect(ja.stderr).toContain('不明なトピック');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('localizes the skill command in all three languages', () => {
    // MessageKey is derived from the `en` table alone, so a missing zh-TW or
    // ja-JP entry compiles and falls back to English at runtime without
    // anything failing. This is the check that notices.
    const en = runCli(['skill', '--help'], { RUNESTONE_LANG: 'en' });
    expect(en.stdout).toContain('Install the Runestone agent guidance');

    const zh = runCli(['skill', '--help'], { RUNESTONE_LANG: 'zh-TW' });
    expect(zh.stdout).toContain('把 Runestone 的 agent 指引安裝進專案');

    const ja = runCli(['skill', '--help'], { RUNESTONE_LANG: 'ja-JP' });
    expect(ja.stdout).toContain('agent ガイダンス');
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
