import * as fs from 'fs';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { composeService } from '../../src/services/docker-compose';
import { networkService } from '../../src/services/docker-network';
import { runService } from '../../src/services/docker-run';
import { sshManager } from '../../src/services/ssh-manager';
import { volumeService } from '../../src/services/docker-volume';

const root = path.resolve(__dirname, '..', '..');
const srcDir = path.join(root, 'src');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath);
    }

    return [fullPath];
  });
}

describe('DESIGNE.md functional acceptance', () => {
  it('matches npm global tool package metadata and bin contract', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      name: string;
      bin: Record<string, string>;
      engines: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(packageJson.name).toBe('@developers-homelab/runestone-cli');
    expect(packageJson.bin.runestone).toBe('./bin/runestone');
    expect(packageJson.engines.node).toBe('>=18.0.0');
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        '@clack/prompts': expect.any(String),
        '@mkcert/node': expect.any(String),
        commander: expect.any(String),
        dotenv: expect.any(String),
        kleur: expect.any(String)
      })
    );
    expect(packageJson.devDependencies).toEqual(
      expect.objectContaining({
        typescript: expect.any(String),
        jest: expect.any(String),
        'ts-jest': expect.any(String)
      })
    );

    const bin = read('bin/runestone');
    expect(bin).toContain('#!/usr/bin/env node');
    expect(bin).toContain("../dist/cli.js");
  });

  it('exposes the DESIGNE.md command tree and aliases through Commander', () => {
    const program = createProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining(['setup', 'up', 'stop', 'down', 'status', 'certs', 'keys']));

    const up = program.commands.find((command) => command.name() === 'up');
    expect(up?.options.some((option) => option.long === '--project')).toBe(false);

    const certs = program.commands.find((command) => command.name() === 'certs');
    expect(certs?.aliases()).toContain('cert');
    expect(certs?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['create', 'remove']));

    const remove = certs?.commands.find((command) => command.name() === 'remove');
    expect(remove?.aliases()).toEqual(expect.arrayContaining(['rm', 'del']));

    const keys = program.commands.find((command) => command.name() === 'keys');
    expect(keys?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['ls', 'add']));

    const list = keys?.commands.find((command) => command.name() === 'ls');
    expect(list?.aliases()).toContain('list');
  });

  it('keeps Docker CLI execution behind services and docker checker utilities', () => {
    const sourceFiles = listFiles(srcDir).filter((file) => file.endsWith('.ts'));
    const forbiddenCallers = sourceFiles.filter((file) => {
      const relative = path.relative(srcDir, file).replace(/\\/g, '/');
      if (relative.startsWith('services/') || relative === 'utils/docker-checker.ts') {
        return false;
      }

      const content = fs.readFileSync(file, 'utf8');
      return /child_process|spawnSync|execSync/.test(content);
    });

    expect(forbiddenCallers).toEqual([]);
    expect(composeService).toEqual(
      expect.objectContaining({
        up: expect.any(Function),
        down: expect.any(Function),
        stop: expect.any(Function),
        restart: expect.any(Function),
        ps: expect.any(Function),
        pull: expect.any(Function),
        logs: expect.any(Function)
      })
    );
    expect(networkService).toEqual(
      expect.objectContaining({
        createNetwork: expect.any(Function),
        exists: expect.any(Function),
        removeNetwork: expect.any(Function),
        list: expect.any(Function)
      })
    );
    expect(volumeService).toEqual(
      expect.objectContaining({
        createVolume: expect.any(Function),
        exists: expect.any(Function),
        removeVolume: expect.any(Function),
        list: expect.any(Function)
      })
    );
    expect(runService.run).toEqual(expect.any(Function));
    expect(sshManager).toEqual(
      expect.objectContaining({
        addKeys: expect.any(Function),
        addKey: expect.any(Function),
        listKeys: expect.any(Function),
        scanHomeDirectory: expect.any(Function)
      })
    );
  });

  it('uses clack for setup, mkcert node API for certs, and does not depend on Makefile behavior', () => {
    const setup = read('src/commands/setup.ts');
    const allSource = listFiles(srcDir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(setup).toContain("@clack/prompts");
    expect(setup).not.toContain('enquirer');
    expect(allSource).toContain("@mkcert/node");
    expect(allSource).toContain('mkcert.generate');
    expect(allSource).not.toMatch(/Makefile|make\s+[a-z]/i);
  });

  it('keeps setup prompts aligned with the expected interactive flow', () => {
    const setup = read('src/commands/setup.ts');
    const up = read('src/commands/up.ts');
    const explanationBeforePrompt = (explanation: string, prompt: string) => {
      expect(setup.indexOf(explanation)).toBeGreaterThanOrEqual(0);
      expect(setup.indexOf(prompt)).toBeGreaterThanOrEqual(0);
      expect(setup.indexOf(explanation)).toBeLessThan(setup.indexOf(prompt));
    };

    expect(setup).toContain('Runestone path');
    expect(setup).toContain('!options.project && !options.envPath && !existingConfig?.ENV_FILE_EXISTS');
    expect(setup).toContain('return envLoader.load(envPath, projectDir)');
    expect(up).toContain('config = await runSetup(options.env ? { envPath: config.ENV_PATH } : {})');
    expect(up).not.toContain('project: config.PROJECT_DIR');
    expect(setup).toContain('HTTP entrypoint name');
    expect(setup).toContain('HTTP entrypoint port');
    expect(setup).toContain('HTTPS entrypoint name');
    expect(setup).toContain('HTTPS entrypoint port');
    expect(setup).toContain('Mailpit SMTP port');
    expect(setup).toContain('Install local CA for SSL certificates?');
    expect(setup).toContain('Runestone settings changed. Restart runestone now?');
    expect(setup).toContain('maybeCheckDockerDomain');
    expect(setup).toContain('if (domain === DEFAULT_ENV.HOST_DOMAIN)');
    expect(setup).toContain('Check whether this Docker domain resolves to this machine?');
    expect(setup).toContain('Runestone uses hosts under *.${domain}, so the check only verifies wildcard DNS.');
    expect(setup).toContain('runestone-wildcard-check.${domain}');
    expect(setup).toContain('Docker domain check failed. Ignore and continue?');
    expect(setup).toContain('HTTP entrypoint & HTTP entrypoint port');
    expect(setup).toContain('HTTPS entrypoint & HTTPS entrypoint port');
    expect(setup).toContain('childPrompt');
    expect(setup).toContain('`${title}\\n${descriptions.map((line) => `  - ${line}`).join');
    explanationBeforePrompt('Runestone stores its .env', "promptText('Runestone path'");
    explanationBeforePrompt('This base domain is used', "promptText('Docker domain'");
    explanationBeforePrompt('The prefix is used for Docker resource names', "promptText('Project prefix'");
    explanationBeforePrompt('HTTP entrypoint & HTTP entrypoint port', "childPrompt('HTTP entrypoint name')");
    explanationBeforePrompt('HTTP entrypoint & HTTP entrypoint port', "childPrompt('HTTP entrypoint port')");
    explanationBeforePrompt('HTTPS entrypoint & HTTPS entrypoint port', "childPrompt('HTTPS entrypoint name')");
    explanationBeforePrompt('HTTPS entrypoint & HTTPS entrypoint port', "childPrompt('HTTPS entrypoint port')");
    explanationBeforePrompt('Defaults to 1025. Applications use this host port', "childPrompt('Mailpit SMTP port')");
    explanationBeforePrompt('This trusts the local mkcert CA', "message: 'Install local CA for SSL certificates?'");
    expect(setup).toContain("initialValue: existingConfig ? existingConfig.MKCERT_INSTALLED === 'true' : true");
    expect(setup).not.toContain('Port mapping');
    expect(setup).not.toContain('Project directory:');
  });
});
