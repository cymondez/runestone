import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');
const node = process.execPath;

function writeFakeDocker(binDir: string, fakeDockerJs: string): void {
  fs.writeFileSync(
    fakeDockerJs,
    `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const logPath = process.env.RUNESTONE_DOCKER_LOG;
const stateDir = process.env.RUNESTONE_FAKE_DOCKER_STATE;

function log() {
  if (logPath) fs.appendFileSync(logPath, args.join(' ') + '\\n');
}

function marker(kind, name) {
  return path.join(stateDir, kind + '-' + name.replace(/[^a-zA-Z0-9_.-]/g, '_'));
}

log();

if (args[0] === '--version') {
  console.log('Docker version 26.0.0, build fake');
  process.exit(0);
}

if (args[0] === 'compose' && args[1] === 'version') {
  console.log('Docker Compose version v2.27.0');
  process.exit(0);
}

if (args[0] === 'network' && args[1] === 'inspect') {
  const file = marker('network', args[2]);
  if (fs.existsSync(file)) {
    console.log(JSON.stringify([{ Name: args[2], Driver: 'bridge', Scope: 'local' }]));
    process.exit(0);
  }
  process.exit(1);
}

if (args[0] === 'network' && args[1] === 'create') {
  const name = args[args.length - 1];
  fs.writeFileSync(marker('network', name), 'created');
  console.log(name);
  process.exit(0);
}

if (args[0] === 'network' && args[1] === 'rm') {
  fs.rmSync(marker('network', args[2]), { force: true });
  console.log(args[2]);
  process.exit(0);
}

if (args[0] === 'volume' && args[1] === 'inspect') {
  const file = marker('volume', args[2]);
  if (fs.existsSync(file)) {
    console.log(JSON.stringify([{ Name: args[2], Driver: 'local' }]));
    process.exit(0);
  }
  process.exit(1);
}

if (args[0] === 'volume' && args[1] === 'create') {
  const name = args[2];
  fs.writeFileSync(marker('volume', name), 'created');
  console.log(name);
  process.exit(0);
}

if (args[0] === 'volume' && args[1] === 'rm') {
  fs.rmSync(marker('volume', args[2]), { force: true });
  console.log(args[2]);
  process.exit(0);
}

if (args[0] === 'compose') {
  if (args.includes('ps')) {
    console.log(JSON.stringify([
      { ID: 'abc123', Name: 'runestone', State: 'running', Status: 'Up 5 seconds', Service: 'runestone' }
    ]));
  }
  process.exit(0);
}

if (args[0] === 'run') {
  console.log('id_ed25519');
  process.exit(0);
}

console.error('Unhandled fake docker command: ' + args.join(' '));
process.exit(1);
`,
    'utf8'
  );

  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'docker.cmd'), `@echo off\r\n"${node}" "${fakeDockerJs}" %*\r\n`, 'utf8');
  } else {
    const dockerPath = path.join(binDir, 'docker');
    fs.writeFileSync(dockerPath, `#!/bin/sh\n"${node}" "${fakeDockerJs}" "$@"\n`, 'utf8');
    fs.chmodSync(dockerPath, 0o755);
  }
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(node, [path.join(root, 'bin', 'runestone'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env
  });
}

function expectSuccess(result: ReturnType<typeof runCli>, label: string): void {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

describe('runestone CLI actual execution integration', () => {
  let tempDir: string;
  let projectDir: string;
  let fakeBinDir: string;
  let dockerLog: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    const build = spawnSync(node, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], {
      cwd: root,
      encoding: 'utf8'
    });

    if (build.status !== 0) {
      throw new Error(build.stderr || build.stdout);
    }
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-exec-'));
    const homeDir = path.join(tempDir, 'home');
    projectDir = path.join(homeDir, '.runestone');
    fakeBinDir = path.join(tempDir, 'bin');
    const sshDir = path.join(homeDir, '.ssh');
    const stateDir = path.join(tempDir, 'docker-state');
    dockerLog = path.join(tempDir, 'docker.log');

    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.env'),
      [
        'HOST_DOMAIN=acceptance.test',
        'PREFIX=acceptance',
        'RUNESTONE_IMAGE=cymondez/runestone',
        'RUNESTONE_TAG=latest'
      ].join('\n') + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(sshDir, 'id_ed25519'), 'fake-private-key', 'utf8');
    fs.writeFileSync(path.join(sshDir, 'id_ed25519.pub'), 'fake-public-key', 'utf8');
    writeFakeDocker(fakeBinDir, path.join(tempDir, 'fake-docker.js'));

    env = {
      ...process.env,
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
      HOME: homeDir,
      USERPROFILE: homeDir,
      RUNESTONE_TOOL_STATE_PATH: path.join(tempDir, 'runestone.config.json'),
      RUNESTONE_DOCKER_LOG: dockerLog,
      RUNESTONE_FAKE_DOCKER_STATE: stateDir,
      FORCE_COLOR: '0'
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes lifecycle, status, key, and certificate-removal commands through the real CLI process', () => {
    const up = runCli(['up'], env);
    expectSuccess(up, 'runestone up');
    expect(up.stdout).toContain('runestone is ready');
    expect(fs.existsSync(path.join(projectDir, 'compose.yml'))).toBe(true);

    const status = runCli(['status'], env);
    expectSuccess(status, 'runestone status');
    expect(status.stdout).toContain('runestone');
    if (!status.stdout.includes('id_ed25519')) {
      throw new Error(`status did not list SSH keys\nstdout:\n${status.stdout}\ndocker log:\n${fs.readFileSync(dockerLog, 'utf8')}`);
    }

    const keyPath = path.join(tempDir, 'home', '.ssh', 'id_ed25519');
    const keyAdd = runCli(['keys', 'add', keyPath], env);
    expectSuccess(keyAdd, 'runestone keys add');
    expect(keyAdd.stdout).toContain('SSH key added successfully');

    const keyList = runCli(['keys', 'ls'], env);
    expectSuccess(keyList, 'runestone keys ls');
    expect(keyList.stdout).toContain('id_ed25519');

    const certDir = path.join(projectDir, 'certs');
    const dynamicDir = path.join(projectDir, 'configuration', 'certs');
    fs.mkdirSync(certDir, { recursive: true });
    fs.mkdirSync(dynamicDir, { recursive: true });
    fs.writeFileSync(path.join(certDir, 'example.test.crt'), 'cert');
    fs.writeFileSync(path.join(certDir, 'example.test.key'), 'key');
    fs.writeFileSync(
      path.join(dynamicDir, 'example.test.ssl.yml'),
      'tls:\n  certificates:\n    - certFile: /ssl/example.test.crt\n      keyFile: /ssl/example.test.key\n',
      'utf8'
    );
    const certRemove = runCli(['cert', 'del', 'example.test'], env);
    expectSuccess(certRemove, 'runestone cert del');
    expect(fs.existsSync(path.join(certDir, 'example.test.crt'))).toBe(false);
    expect(fs.existsSync(path.join(certDir, 'example.test.key'))).toBe(false);
    expect(fs.existsSync(path.join(dynamicDir, 'example.test.ssl.yml'))).toBe(false);

    const stop = runCli(['stop'], env);
    expectSuccess(stop, 'runestone stop');
    expect(stop.stdout).toContain('Containers stopped successfully');

    const down = runCli(['down', '--remove-network', '--remove-volumes'], env);
    expectSuccess(down, 'runestone down');
    expect(down.stdout).toContain('Teardown complete');

    const dockerCalls = fs.readFileSync(dockerLog, 'utf8');
    expect(dockerCalls).toContain('--version');
    expect(dockerCalls).toContain('compose version');
    expect(dockerCalls).toContain('network create --driver bridge acceptance-network');
    expect(dockerCalls).toContain('volume create acceptance-ssh');
    expect(dockerCalls).toContain('compose --project-directory');
    expect(dockerCalls).toContain('up -d --wait');
    expect(dockerCalls).toContain('restart');
    expect(dockerCalls).toContain('stop');
    expect(dockerCalls).toContain('down --remove-orphans --volumes');
  });
});
