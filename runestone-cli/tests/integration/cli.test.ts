import { spawnSync } from 'child_process';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');
const node = process.execPath;

function runCli(args: string[]) {
  return spawnSync(node, [path.join(root, 'bin', 'runestone'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
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
    expect(result.stdout).toContain('up');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('certs');
    expect(result.stdout).toContain('keys');
  });

  it('prints package version', () => {
    const result = runCli(['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('1.0.0');
  });

  it('does not expose or accept a project option on up', () => {
    const help = runCli(['up', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).not.toContain('--project');

    const rejected = runCli(['up', '--project', 'somewhere']);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("unknown option '--project'");
  });

  it('supports the cert alias for certificate commands', () => {
    const result = runCli(['cert', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('create');
    expect(result.stdout).toContain('remove');
  });

  it('supports the keys list alias in help output', () => {
    const result = runCli(['keys', 'ls', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('List injected SSH keys');
  });
});
