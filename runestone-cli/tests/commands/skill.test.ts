import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { listDomainCertificates } from '../../src/services/cert-manager';
import { envLoader } from '../../src/utils/env-loader';
import { SKILL_TEMPLATE_VERSION, beginMarker, endMarker } from '../../src/services/skill/version';
import { testEnv } from '../helpers/env';

jest.mock('../../src/services/cert-manager', () => ({
  ...jest.requireActual('../../src/services/cert-manager'),
  listDomainCertificates: jest.fn()
}));

jest.mock('../../src/utils/env-loader', () => ({
  ...jest.requireActual('../../src/utils/env-loader'),
  envLoader: {
    ...jest.requireActual('../../src/utils/env-loader').envLoader,
    load: jest.fn(),
    hasRequiredVars: jest.fn()
  }
}));

/** A hash of every file under `dir`, for proving that nothing was written. */
function treeHash(dir: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      hash.update(path.relative(dir, full));
      if (entry.isDirectory()) {
        walk(full);
      } else {
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir);

  return hash.digest('hex');
}

describe('runestone skill', () => {
  let root: string;
  let logs: string[];

  async function run(...args: string[]) {
    await createProgram().parseAsync(['node', 'runestone', 'skill', ...args]);
  }

  function output(): string {
    return logs.join('\n');
  }

  beforeEach(() => {
    process.exitCode = undefined;
    // t() resolves the locale on every call, so the suite has to pin it or the
    // assertions below depend on the machine's language.
    process.env.RUNESTONE_LANG = 'en';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-skill-'));
    logs = [];

    for (const stream of ['log', 'error', 'warn'] as const) {
      jest.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }

    (envLoader.load as jest.Mock).mockReturnValue(
      testEnv('/tmp/runestone-home', { HOST_DOMAIN: 'example.test', PREFIX: 'mylab' })
    );
    (envLoader.hasRequiredVars as jest.Mock).mockReturnValue(true);
    (listDomainCertificates as jest.Mock).mockReturnValue([]);
  });

  afterEach(() => {
    process.exitCode = undefined;
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.RUNESTONE_SKILL_HOME;
    delete process.env.RUNESTONE_LANG;
  });

  describe('writing nothing', () => {
    it('leaves the directory byte-identical after a dry run', async () => {
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Mine\n\nProse.\n', 'utf8');
      const before = treeHash(root);

      await run('install', '--dry-run', root);

      // Including the absence of a backup file: a plan that quietly created a
      // .bak would be a write.
      expect(treeHash(root)).toBe(before);
      expect(fs.existsSync(path.join(root, 'AGENTS.md.bak'))).toBe(false);
    });

    it('leaves the directory byte-identical after status', async () => {
      fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
      const before = treeHash(root);

      await run('status', root);

      expect(treeHash(root)).toBe(before);
    });

    it('refuses to write without --dry-run, rather than pretending the flag is a choice', async () => {
      // Naming a flag for the only behaviour there is would claim the user has
      // an option they do not. This build plans and declines.
      fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
      const before = treeHash(root);

      await run('install', root);

      expect(process.exitCode).toBe(1);
      expect(treeHash(root)).toBe(before);
    });
  });

  describe('target detection', () => {
    it.each([
      ['.agents', 'agents'],
      ['.claude', 'claude'],
      ['.cursor', 'cursor'],
      ['.vscode', 'copilot']
    ])('selects only the runtime whose directory is present: %s', async (marker, expected) => {
      // Detection is what stops a Cursor-only repository acquiring a stray
      // .claude/ directory it never asked for.
      fs.mkdirSync(path.join(root, marker), { recursive: true });

      await run('install', '--dry-run', root);

      const text = output();
      const others = { agents: '.agents/skills', claude: '.claude/skills', cursor: '.cursor/rules', copilot: '.github/skills' };
      expect(text).toContain(path.join(...others[expected as keyof typeof others].split('/')));

      for (const [id, dir] of Object.entries(others)) {
        if (id !== expected) {
          expect(text).not.toContain(path.join(...dir.split('/')));
        }
      }
    });

    it('reports that it found nothing rather than guessing', async () => {
      await run('install', '--dry-run', root);

      expect(process.exitCode).toBe(1);
      expect(output()).toContain('No agent runtime detected');
    });

    it('treats codex as the neutral instruction file, not a fourth copy', async () => {
      await run('install', '--dry-run', '--target', 'codex', root);

      expect(output()).toContain('AGENTS.md');
      expect(output()).not.toContain('.codex');
    });
  });

  describe('user-settable paths', () => {
    it('honours --skills-dir for a runtime the table does not know', async () => {
      await run('install', '--dry-run', '--skills-dir', '.weird/skills', root);

      expect(output()).toContain(path.join('.weird', 'skills', 'runestone', 'SKILL.md'));
      expect(output()).not.toContain(path.join('.agents', 'skills'));
    });

    it('honours --instructions-file', async () => {
      await run('install', '--dry-run', '--instructions-file', 'RULES.md', root);

      expect(output()).toContain('RULES.md');
    });
  });

  describe('scope', () => {
    it('rejects a directory together with --user', async () => {
      await run('status', root, '--user');

      expect(process.exitCode).toBe(1);
      expect(output()).toContain('--user');
    });

    it('rejects --user for a runtime with no user-level path', async () => {
      // Cursor keeps user rules in application settings, so "succeeding" would
      // leave the user with files nothing reads.
      await run('install', '--dry-run', '--user', '--target', 'cursor');

      expect(process.exitCode).toBe(1);
      expect(output()).toContain('cursor');
    });

    it('reports the home override loudly whenever it is set', async () => {
      // An override that silently changes where files land is the kind that
      // ruins an afternoon; AGENTS.md requires it to be visible.
      process.env.RUNESTONE_SKILL_HOME = path.join(root, 'fake-home');
      fs.mkdirSync(path.join(root, 'fake-home', '.agents'), { recursive: true });

      await run('status', '--user');

      expect(output()).toContain('RUNESTONE_SKILL_HOME');
      expect(output()).toContain(path.join(root, 'fake-home'));
    });
  });

  describe('status', () => {
    it('says nothing is installed when nothing is', async () => {
      fs.mkdirSync(path.join(root, '.agents'), { recursive: true });

      await run('status', root);

      expect(output()).toContain('No Runestone agent guidance is installed here');
    });

    it('reports a current install, an out-of-date one and one edited here', async () => {
      fs.mkdirSync(path.join(root, '.agents', 'skills', 'runestone'), { recursive: true });

      // Out of date: our marker, an older template version.
      fs.writeFileSync(
        path.join(root, 'AGENTS.md'),
        `# Mine\n\n${beginMarker(SKILL_TEMPLATE_VERSION - 1)}\nold\n${endMarker()}\n`,
        'utf8'
      );
      // Edited here: our marker at the current version, different bytes.
      fs.writeFileSync(
        path.join(root, '.agents', 'skills', 'runestone', 'SKILL.md'),
        `---\n# runestone:generated skill-template=${SKILL_TEMPLATE_VERSION}\nname: runestone\n---\n\nedited by hand\n`,
        'utf8'
      );

      await run('status', root);

      const text = output();
      expect(text).toContain('out of date');
      expect(text).toContain('edited here');
    });

    it('hides the header with --no-header', async () => {
      fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Mine\n', 'utf8');

      await run('status', root, '--no-header');

      expect(output()).not.toContain('State');
    });
  });

  describe('blockers replace the plan', () => {
    it('refuses on two begin markers and names the offsets', async () => {
      fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'AGENTS.md'),
        `${beginMarker()}\na\n${endMarker()}\n\n${beginMarker()}\nb\n${endMarker()}\n`,
        'utf8'
      );

      await run('install', '--dry-run', root);

      expect(process.exitCode).toBe(1);
      const text = output();
      expect(text).toContain('begin markers');
      // A blocked run has no plan to describe, so the plan must not appear.
      expect(text).not.toContain('would change');
      expect(text).not.toContain('create');
    });

    it('refuses on a begin marker with no end', async () => {
      fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
      fs.writeFileSync(path.join(root, 'AGENTS.md'), `${beginMarker()}\nunclosed\n`, 'utf8');

      await run('install', '--dry-run', root);

      expect(process.exitCode).toBe(1);
      expect(output()).toContain('no matching end marker');
    });
  });

  it('never bakes a live fact into an installed file', async () => {
    // An installed file outlives the moment it was written, so a snapshot of
    // "Runestone is running" would be a lie within minutes. Offline scalars are
    // fine; anything from a probe is not.
    fs.mkdirSync(path.join(root, '.agents'), { recursive: true });

    await run('install', '--dry-run', root);

    const text = output();
    expect(text).not.toContain('Runestone is not running');
    expect(text).not.toContain('router IDs already registered');
  });
});
