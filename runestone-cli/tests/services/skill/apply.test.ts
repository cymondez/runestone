import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { applyInstall, applyRemove, findOrphans } from '../../../src/services/skill/apply';
import { planInstall, planRemove } from '../../../src/services/skill/plan';
import { TARGETS, RenderContext, findTarget } from '../../../src/services/skill/targets';
import { SKILL_TEMPLATE_VERSION } from '../../../src/services/skill/version';
import { TOPICS } from '../../../src/utils/tool-docs';

function context(): RenderContext {
  const topics: Record<string, string> = {};
  for (const topic of TOPICS) {
    topics[topic.id] = `# ${topic.title}\n\nBody for ${topic.id}.\n`;
  }

  return { topics, hostDomain: 'example.test' };
}

function deps() {
  return {
    readText: (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined),
    exists: (p: string) => fs.existsSync(p),
    backupPathFor: (p: string) => `${p}.bak`
  };
}

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

describe('applying a skill plan', () => {
  let root: string;

  function neutralFiles() {
    const target = findTarget('agents');
    if (!target) {
      throw new Error('the neutral target must exist');
    }

    return target.render(context());
  }

  function install(force = false) {
    const plan = planInstall(
      { root, targetIds: ['agents'], files: neutralFiles(), force },
      deps()
    );

    return { plan, result: applyInstall(plan) };
  }

  function remove(force = false) {
    const plan = planRemove({ root, targetIds: ['agents'], files: neutralFiles(), force }, deps());
    return { plan, result: applyRemove(plan) };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-apply-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes exactly the planned paths and nothing else', () => {
    const { plan, result } = install();

    const planned = new Set(plan.files.filter((file) => file.action !== 'unchanged').map((file) => file.absolutePath));
    const written = new Set(result?.written.map((file) => file.absolutePath));

    expect(written).toEqual(planned);
    for (const file of planned) {
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it('is a no-op the second time, and creates no second backup', () => {
    install();
    const afterFirst = treeHash(root);

    const { result } = install();

    expect(treeHash(root)).toBe(afterFirst);
    expect(result?.written).toEqual([]);
    expect(fs.existsSync(path.join(root, '.agents', 'skills', 'runestone', 'SKILL.md.bak'))).toBe(false);
  });

  it('removes a file the current template no longer generates', () => {
    install();
    const orphan = path.join(root, '.agents', 'skills', 'runestone', 'references', 'gone.md');
    fs.writeFileSync(orphan, `<!-- runestone:generated skill-template=${SKILL_TEMPLATE_VERSION} -->\n\nold topic\n`, 'utf8');

    const expected = planInstall({ root, targetIds: ['agents'], files: neutralFiles(), force: false }, deps())
      .files.map((file) => file.absolutePath);

    expect(findOrphans(root, expected, ['.agents/skills'])).toEqual([orphan]);
  });

  it('leaves a file beside the skill that Runestone did not generate', () => {
    install();
    const theirs = path.join(root, '.agents', 'skills', 'runestone', 'references', 'notes.md');
    fs.writeFileSync(theirs, '# My own notes\n', 'utf8');

    const expected = planInstall({ root, targetIds: ['agents'], files: neutralFiles(), force: false }, deps())
      .files.map((file) => file.absolutePath);

    expect(findOrphans(root, expected, ['.agents/skills'])).toEqual([]);
  });

  it('keeps a file the user edited unless forced, then backs it up before rewriting', () => {
    install();
    const skill = path.join(root, '.agents', 'skills', 'runestone', 'SKILL.md');
    const edited = `${fs.readFileSync(skill, 'utf8')}\n<!-- my own note -->\n`;
    fs.writeFileSync(skill, edited, 'utf8');

    install();
    expect(fs.readFileSync(skill, 'utf8')).toBe(edited);
    expect(fs.existsSync(`${skill}.bak`)).toBe(false);

    install(true);
    expect(fs.readFileSync(skill, 'utf8')).not.toBe(edited);
    expect(fs.readFileSync(`${skill}.bak`, 'utf8')).toBe(edited);
  });

  it('does not climb above the skill directory when cleaning up', () => {
    // `.agents/` is the user's, and it is the directory target detection looks
    // for: deleting it would silently change what a later install decides.
    fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
    install();
    remove();

    expect(fs.existsSync(path.join(root, '.agents'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.agents', 'skills', 'runestone'))).toBe(false);
  });

  it('detects that Runestone settings changed since the install', () => {
    install();

    // A different host domain renders different content at the same template
    // version, which is indistinguishable from a hand edit and is treated the
    // same way: keep what is there and report it.
    const target = findTarget('agents');
    const drifted = target?.render({ ...context(), hostDomain: 'other.test' }) ?? [];
    const plan = planInstall({ root, targetIds: ['agents'], files: drifted, force: false }, deps());

    expect(plan.files.some((file) => file.action === 'skip-modified')).toBe(true);
  });

  it('leaves no temporary file behind', () => {
    install();

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });

    expect(walk(root).filter((file) => file.includes('runestone-tmp'))).toEqual([]);
  });
});

describe('what Runestone is allowed to write', () => {
  // The instruction-file half of this feature was removed on 2026-09-09: an
  // AGENTS.md or a CLAUDE.md is the user's own file, and every runtime in the
  // table finds a skill by scanning its skills directories anyway. This is the
  // guard. It fails the moment a target emits a path outside its own skill
  // directory, which is the check the original user-scope gate never made.
  it.each(TARGETS.map((target) => [target.id, target] as const))('%s writes only inside a skills directory', (_id, target) => {
    const rendered = target.render(context());
    expect(rendered.length).toBeGreaterThan(0);

    for (const file of rendered) {
      expect(file.relativePath).toContain('/skills/runestone/');
      expect(path.basename(file.relativePath)).not.toBe('AGENTS.md');
      expect(path.basename(file.relativePath)).not.toBe('CLAUDE.md');
      expect(file.relativePath.endsWith('.mdc')).toBe(false);
    }
  });
});

describe('the generated skill matches the Agent Skills specification', () => {
  // The published validator (`skills-ref validate`) needs a network fetch, so
  // the spec's constraints are asserted directly here instead: same rules,
  // offline, and they fail on the exact field that broke.
  it.each(TARGETS.map((target) => [target.id, target] as const))('%s', (_id, target) => {
    for (const file of target.render(context())) {
      if (!file.relativePath.endsWith('SKILL.md')) {
        continue;
      }

      const match = /^---\n([\s\S]*?)\n---/.exec(file.content);
      expect(match).not.toBeNull();

      const front = yaml.load((match as RegExpExecArray)[1]) as Record<string, unknown>;
      const directory = path.basename(path.dirname(file.relativePath));

      // name: 1-64 chars, lowercase alphanumerics and hyphens, no leading,
      // trailing or consecutive hyphen, and it must match the parent directory.
      expect(front.name).toBe(directory);
      expect(String(front.name)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(String(front.name).length).toBeLessThanOrEqual(64);

      // description: 1-1024 chars, and it is the only part loaded before the
      // skill activates, so it has to carry the trigger words.
      expect(String(front.description).length).toBeGreaterThan(0);
      expect(String(front.description).length).toBeLessThanOrEqual(1024);
      expect(String(front.description)).toContain('Runestone');

      // metadata is a map of string keys to string values.
      for (const value of Object.values((front.metadata ?? {}) as Record<string, unknown>)) {
        expect(typeof value).toBe('string');
      }

      // allowed-tools is deliberately absent: restricting an agent's tools
      // inside someone else's project would break their workflow silently.
      expect(front['allowed-tools']).toBeUndefined();

      // Under 500 lines, per the progressive-disclosure guidance.
      expect(file.content.split('\n').length).toBeLessThan(500);
    }
  });
});
