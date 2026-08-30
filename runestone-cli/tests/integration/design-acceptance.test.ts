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
        '@clack/core': expect.any(String),
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

    expect(commandNames).toEqual(expect.arrayContaining(['setup', 'doctor', 'docs', 'up', 'stop', 'down', 'status', 'certs', 'keys']));

    for (const command of program.commands) {
      expect(command.options.some((option) => option.short === '-e' || option.long === '--env')).toBe(false);
      expect(command.options.some((option) => option.long === '--project')).toBe(false);
    }

    const certs = program.commands.find((command) => command.name() === 'certs');
    expect(certs?.aliases()).toContain('cert');
    expect(certs?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['create', 'install', 'list', 'remove']));

    const remove = certs?.commands.find((command) => command.name() === 'remove');
    expect(remove?.aliases()).toEqual(expect.arrayContaining(['rm', 'del']));

    const keys = program.commands.find((command) => command.name() === 'keys');
    expect(keys?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['ls', 'add']));

    const list = keys?.commands.find((command) => command.name() === 'ls');
    expect(list?.aliases()).toContain('list');
  });

  it('never issues an unscoped docker compose restart', () => {
    // An unscoped `docker compose restart` restarts every service in the
    // project, so a certificate or service change would interrupt unrelated
    // long-lived services. The service list is a required parameter.
    expect(composeService.restart).toHaveLength(2);

    const callSites = listFiles(srcDir)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) => {
        const relative = path.relative(srcDir, file);
        const calls = fs.readFileSync(file, 'utf8').match(/composeService\.restart\([^)]*\)/g) ?? [];
        return calls.map((call) => ({ file: relative, call }));
      });

    expect(callSites.length).toBeGreaterThan(0);
    expect(callSites.filter((site) => !site.call.includes(','))).toEqual([]);
  });

  it('keeps Docker CLI execution behind services and docker checker utilities', () => {
    const sourceFiles = listFiles(srcDir).filter((file) => file.endsWith('.ts'));
    const forbiddenCallers = sourceFiles.filter((file) => {
      const relative = path.relative(srcDir, file).replace(/\\/g, '/');
      if (relative.startsWith('services/') || relative === 'utils/docker-checker.ts' || relative === 'utils/spawn.ts') {
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
    const i18n = read('src/i18n/index.ts');
    const allSource = listFiles(srcDir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(setup).toContain("@clack/prompts");
    expect(setup).toContain("@clack/core");
    expect(setup).not.toContain('enquirer');
    expect(allSource).toContain("@mkcert/node");
    expect(allSource).toContain('mkcert.generate');
    expect(i18n).not.toMatch(/@mkcert|mkcert/i);
    expect(allSource).not.toMatch(/Makefile|make\s+[a-z]/i);
  });

  it('keeps setup prompts aligned with the expected interactive flow', () => {
    const setup = read('src/commands/setup.ts');
    const up = read('src/commands/up.ts');
    expect(setup).toContain("activeT('setup.runestonePath.title')");
    expect(setup).toContain("activeT('setup.language.title')");
    expect(setup).toContain('!options.project && !options.envPath && !initialExistingConfig?.ENV_FILE_EXISTS');
    expect(setup).toContain('return envLoader.load(draft.envPath, draft.projectDir)');
    expect(setup).not.toContain('promptNavigation');
    expect(setup).not.toContain('setup.navigation');
    expect(setup).toContain("const BACK_KEY = '\\x1b'");
    expect(setup).toContain('function promptFooter');
    expect(setup).toContain("activeT('setup.hotkey.back')");
    expect(setup).toContain("activeT('setup.hotkey.next')");
    expect(setup).toContain("activeT('setup.hotkey.cancel')");
    expect(setup).toContain("key?.name === 'escape'");
    expect(setup).toContain("promptInternal.value = STEP_BACK");
    expect(setup).toContain("promptInternal.emit?.('finalize')");
    expect(setup).toContain("promptInternal.close?.()");
    expect(setup).toContain('const reviewAction = await promptReview(draft)');
    expect(setup.indexOf('const reviewAction = await promptReview(draft)')).toBeLessThan(setup.indexOf('envLoader.write(draft.envPath, configToWrite)'));
    expect(setup).toContain('toolState.writeSetupState({ runestonePath: draft.projectDir, locale: draft.selectedLocale })');
    expect(setup).not.toContain('RUNESTONE_LANG: draft.selectedLocale');
    expect(setup).not.toContain('initialExistingConfig.RUNESTONE_LANG');
    expect(read('src/utils/env-loader.ts')).not.toContain("| 'RUNESTONE_LANG'");
    expect(read('src/i18n/index.ts')).not.toContain('readEnvLocale');
    expect(read('src/utils/path-helpers.ts')).toContain('toolState.readRunestonePath()');
    expect(up).toContain('config = await runSetup()');
    expect(up).not.toContain('options.env');
    expect(up).not.toContain('project: config.PROJECT_DIR');
    expect(setup).toContain("activeT('setup.httpName.prompt')");
    expect(setup).toContain("activeT('setup.httpPort.prompt')");
    expect(setup).toContain("activeT('setup.httpsName.prompt')");
    expect(setup).toContain("activeT('setup.httpsPort.prompt')");
    expect(setup).toContain("activeT('setup.mailpit.prompt')");
    expect(setup).toContain("activeT('setup.localCa.prompt')");
    expect(setup).toContain("activeT('setup.restart.prompt')");
    expect(setup).toContain('maybeCheckDockerDomain');
    expect(setup).toContain('if (domain === DEFAULT_ENV.HOST_DOMAIN)');
    expect(setup).toContain("activeT('setup.domainCheck.prompt')");
    expect(setup).toContain("activeT('setup.domainCheck.description1'");
    expect(setup).toContain("activeT('setup.domainCheck.failContinue')");
    expect(setup).toContain("activeT('setup.httpGroup.title')");
    expect(setup).toContain("activeT('setup.httpsGroup.title')");
    expect(setup).toContain('childPrompt');
    expect(setup).toContain('function promptHeader');
    expect(setup).toContain('function promptDescription');
    expect(setup.indexOf('promptDescription(frame?.description)')).toBeLessThan(setup.indexOf('const value = this.value ? this.valueWithCursor'));
    expect(setup).toContain("{ description: activeT('setup.runestonePath.description') }");
    expect(setup).toContain("{ description: activeT('setup.dockerDomain.description') }");
    expect(setup).toContain("{ description: activeT('setup.projectPrefix.description') }");
    expect(setup).toContain("activeT('setup.httpGroup.description1')");
    expect(setup).toContain("activeT('setup.httpGroup.description2')");
    expect(setup).toContain("activeT('setup.httpsGroup.description1')");
    expect(setup).toContain("activeT('setup.httpsGroup.description2')");
    expect(setup).toContain("{ description: activeT('setup.mailpit.description') }");
    expect(setup).toContain("activeT('setup.localCa.description')");
    expect(setup).toContain("activeT('setup.localCa.descriptionSystem')");
    expect(setup).toContain("activeT('setup.localCa.descriptionNss')");
    expect(setup).toContain("draft.existingConfig ? draft.existingConfig.MKCERT_INSTALLED === 'true' : true");
    expect(setup).not.toContain('Port mapping');
    expect(setup).not.toContain('Project directory:');
  });
});
