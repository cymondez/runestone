import { Command } from 'commander';
import * as fs from 'fs';
import * as p from '@clack/prompts';
import { dim, green, red, yellow } from 'kleur';
import { contextBlocks } from '../services/agent-context/render';
import { buildOfflineSnapshot } from '../services/agent-context/snapshot';
import { ApplyResult, applyInstall, applyRemove, findOrphans } from '../services/skill/apply';
import { Plan, PlannedFile, planInstall, planRemove } from '../services/skill/plan';
import {
  ScopeError,
  UnknownTargetError,
  activeSkillHomeOverride,
  detectTargets,
  resolveRequestedTargets,
  resolveScope,
  targetsForScope
} from '../services/skill/scope';
import {
  NEUTRAL_INSTRUCTION_FILE,
  NEUTRAL_SKILLS_DIR,
  NEUTRAL_TARGET_ID,
  TARGETS,
  acceptedTargetIds,
  RenderContext,
  RenderedFile,
  TargetDefinition,
  findTarget,
  targetIds
} from '../services/skill/targets';
import { SKILL_HOME_OVERRIDE } from '../services/skill/scope';
import { envLoader } from '../utils/env-loader';
import { TOPICS, renderAiContext } from '../utils/tool-docs';
import { logger } from '../utils/logger';
import { padToWidth } from '../utils/text';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { planDependencies } from '../services/skill/fs-deps';

interface SharedOptions {
  target?: string[];
  yes?: boolean;
  skillsDir?: string;
  instructionsFile?: string;
  user?: boolean;
  dryRun?: boolean;
  force?: boolean;
  header?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * The corpus, rendered once. Only offline scalars go in: the installed files
 * outlive the moment they were written, so a live fact baked into one would be
 * a lie within minutes. They instruct the agent to run the state topic instead.
 */
function renderContext(): RenderContext {
  const config = envLoader.load();
  const snapshot = buildOfflineSnapshot(config);
  const blocks = contextBlocks(snapshot);

  const topics: Record<string, string> = {};
  for (const topic of TOPICS) {
    topics[topic.id] = renderAiContext(topic.id, config, blocks);
  }

  return { topics, hostDomain: config.HOST_DOMAIN };
}

/**
 * Redirect the generated paths when the user names one. This is layer three of
 * spec 8.2: the built-in table is a convenience, and a runtime whose paths have
 * moved must not require a new release to support.
 */
function applyPathOverrides(files: RenderedFile[], options: SharedOptions): RenderedFile[] {
  return files.map((file) => {
    if (options.skillsDir && file.relativePath.startsWith(`${NEUTRAL_SKILLS_DIR}/`)) {
      return { ...file, relativePath: file.relativePath.replace(NEUTRAL_SKILLS_DIR, options.skillsDir.replace(/\\/g, '/')) };
    }
    if (options.instructionsFile && file.relativePath === NEUTRAL_INSTRUCTION_FILE) {
      return { ...file, relativePath: options.instructionsFile.replace(/\\/g, '/') };
    }

    return file;
  });
}

function chosenTargets(root: string, options: SharedOptions): TargetDefinition[] {
  if (options.target && options.target.length > 0) {
    return resolveRequestedTargets(options.target);
  }

  // A path override is itself a statement of intent, so it implies the neutral
  // target rather than requiring --target alongside it.
  if (options.skillsDir || options.instructionsFile) {
    const neutral = findTarget('agents');
    return neutral ? [neutral] : [];
  }

  return detectTargets(root);
}

const ACTION_LABEL: Record<PlannedFile['action'], string> = {
  create: 'create',
  update: 'update',
  unchanged: 'unchanged',
  'skip-modified': 'skip',
  'backup-then-update': 'back up, then rewrite',
  'append-block': 'append a section',
  'replace-block': 'replace the section',
  'remove-orphan': 'remove (no longer generated)',
  delete: 'delete'
};

function colourFor(action: PlannedFile['action']): (text: string) => string {
  if (action === 'unchanged') {
    return dim;
  }
  if (action === 'skip-modified') {
    return yellow;
  }
  if (action === 'delete' || action === 'backup-then-update') {
    return red;
  }

  return green;
}

/**
 * One line per file, and the absolute path on every one of them. The user is
 * about to have files written into a directory they care about; a relative
 * path leaves them working out which directory.
 */
function printPlan(plan: Plan): void {
  if (plan.blockers.length > 0) {
    // Blockers replace the plan rather than appearing beneath it: a blocked run
    // has no plan to describe.
    logger.error(t('skill.plan.blocked', { count: String(plan.blockers.length) }));
    for (const blocker of plan.blockers) {
      console.log(`  ${red(blocker.absolutePath)}`);
      console.log(`    ${blocker.reason}`);
    }

    return;
  }

  const changing = plan.files.filter((file) => file.action !== 'unchanged');
  if (changing.length === 0) {
    logger.info(t('skill.plan.nothing'));
    return;
  }

  const width = Math.max(...changing.map((file) => ACTION_LABEL[file.action].length));
  logger.info(t('skill.plan.title', { count: String(changing.length), root: plan.root }));
  for (const file of changing) {
    const paint = colourFor(file.action);
    console.log(`  ${paint(padToWidth(ACTION_LABEL[file.action], width))}  ${file.absolutePath}`);
    if (file.backupPath) {
      console.log(`  ${padToWidth('', width)}  ${dim(`backup: ${file.backupPath}`)}`);
    }
    if (file.note) {
      console.log(`  ${padToWidth('', width)}  ${dim(file.note)}`);
    }
  }
}

function reportOverride(): void {
  const override = activeSkillHomeOverride();
  if (override) {
    logger.warn(t('skill.override.active', { variable: SKILL_HOME_OVERRIDE, value: override }));
  }
}

/**
 * Ask which runtimes to install for, when the directory gives no clue.
 *
 * `required` keeps an empty selection on the same prompt with the reason shown
 * in place, which is what the interaction rules in `AGENTS.md` ask for: an
 * error the user can fix belongs in the prompt they are already looking at,
 * not in a warning followed by a different question.
 */
async function promptForTargets(root: string): Promise<TargetDefinition[] | undefined> {
  const selected = await p.multiselect({
    message: t('skill.prompt.targets', { root }),
    options: TARGETS.map((target) => ({
      value: target.id,
      label: target.title,
      hint: target.docsUrl
    })),
    required: true
  });

  if (p.isCancel(selected)) {
    return undefined;
  }

  return resolveRequestedTargets(selected as string[]);
}

/**
 * Refuse rather than hang or silently proceed when there is nobody to ask.
 * Mirrors the one existing precedent, in `dns enable`.
 */
function needsConsentAndCannotAsk(options: SharedOptions): boolean {
  return !options.yes && !options.dryRun && !process.stdin.isTTY;
}

function reportApplied(result: ApplyResult): void {
  for (const file of result.written) {
    logger.success(file.backupPath ? `${file.absolutePath}  ${dim(`(backup: ${file.backupPath})`)}` : file.absolutePath);
  }
  for (const file of result.skipped) {
    if (file.action === 'skip-modified') {
      logger.warn(t('skill.applied.skipped', { path: file.absolutePath }));
    }
  }
  for (const directory of result.removedDirectories) {
    logger.info(t('skill.applied.removedDirectory', { path: directory }));
  }
}

/** Resolve scope, targets and files, or report why it cannot be done. */
async function prepare(
  dir: string | undefined,
  options: SharedOptions,
  interactive = false
): Promise<{ root: string; targets: TargetDefinition[]; files: RenderedFile[] } | undefined> {
  let resolved;
  try {
    resolved = resolveScope(dir, Boolean(options.user));
  } catch (error) {
    if (error instanceof ScopeError) {
      logger.error(t('skill.error.scopeConflict'));
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }

  let requested: TargetDefinition[];
  try {
    requested = chosenTargets(resolved.root, options);
  } catch (error) {
    if (error instanceof UnknownTargetError) {
      logger.error(t('skill.error.unknownTarget', { target: error.message, targets: acceptedTargetIds().join(', ') }));
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }

  const { supported, unsupported } = targetsForScope(requested, resolved.scope);
  // eslint-disable-next-line prefer-const
  if (unsupported.length > 0) {
    logger.error(
      t('skill.error.userScopeUnsupported', { targets: unsupported.map((target) => target.id).join(', ') })
    );
    process.exitCode = 1;
    return undefined;
  }
  if (supported.length === 0) {
    // Nothing detected. Ask, if there is somebody to ask; otherwise name the
    // two flags that settle it.
    if (interactive && resolved.scope === 'directory' && process.stdin.isTTY && !options.yes) {
      const chosen = await promptForTargets(resolved.root);
      if (!chosen) {
        logger.warn(t('skill.cancelled'));
        return undefined;
      }
      supported.push(...chosen);
    } else {
      // Nobody to ask: --dry-run, --user, --yes, or a non-interactive shell.
      // Specification 8.2 makes the neutral location the answer here rather
      // than an error, and it is the right one — a project with none of these
      // directories yet is the ordinary case, so failing here would break the
      // documented headline command for most first-time users.
      const neutral = findTarget(NEUTRAL_TARGET_ID);
      if (!neutral) {
        logger.error(t('skill.error.noTargets', { root: resolved.root }));
        process.exitCode = 1;
        return undefined;
      }

      logger.info(t('skill.usingNeutralTarget', { target: neutral.id, root: resolved.root }));
      supported.push(neutral);
    }
  }

  const context = renderContext();
  const files = applyPathOverrides(
    supported.flatMap((target) => target.render(context)),
    options
  );

  return { root: resolved.root, targets: supported, files };
}

function createStatusCommand(): Command {
  return createCommand('status')
    .description(t('commands.skill.status.description'))
    .argument('[dir]', 'directory to inspect')
    .option('--user', t('skill.option.user'))
    .option('--no-header', t('options.noHeader.description'))
    .action(async (dir: string | undefined, options: SharedOptions) => {
      reportOverride();

      const prepared = await prepare(dir, options, true);
      if (!prepared) {
        return;
      }

      // Status is read-only by construction: it plans and prints, and the plan
      // is the same value the real run would act on.
      const plan = planInstall(
        { root: prepared.root, targetIds: prepared.targets.map((target) => target.id), files: prepared.files, force: false },
        planDependencies()
      );

      const installed = plan.files.filter((file) => file.action !== 'create');
      if (installed.length === 0) {
        logger.info(t('skill.status.none'));
        logger.info(t('skill.status.scope', { scope: options.user ? 'user' : 'directory', root: prepared.root }));
        return;
      }

      logger.info(t('skill.status.scope', { scope: options.user ? 'user' : 'directory', root: prepared.root }));
      const rows: string[][] = installed.map((file) => [STATUS_LABEL[file.action], file.relativePath]);
      const headers = ['State', 'Path'];
      const widths = headers.map((header, column) =>
        Math.max(header.length, ...rows.map((row) => row[column].length))
      );

      if (options.header !== false) {
        console.log(`  ${headers.map((header, i) => padToWidth(header, widths[i])).join('  ')}`.trimEnd());
      }
      for (const row of rows) {
        console.log(`  ${row.map((cell, i) => padToWidth(cell, widths[i])).join('  ')}`.trimEnd());
      }
    });
}

/**
 * What each planned action means when the question is "what is installed?"
 * rather than "what would change?". Total rather than partial so that adding an
 * action to the planner cannot leave a row silently blank.
 */
const STATUS_LABEL: Record<PlannedFile['action'], string> = {
  create: 'not installed',
  update: 'out of date',
  unchanged: 'current',
  'skip-modified': 'edited here',
  'backup-then-update': 'edited here',
  'append-block': 'not installed',
  'replace-block': 'out of date',
  'remove-orphan': 'no longer generated',
  delete: 'installed'
};

function createInstallCommand(): Command {
  return createCommand('install')
    .description(t('commands.skill.install.description'))
    .argument('[dir]', 'directory to install into')
    .option('--target <name>', t('skill.option.target'), collect, [])
    .option('--skills-dir <path>', t('skill.option.skillsDir'))
    .option('--instructions-file <path>', t('skill.option.instructionsFile'))
    .option('--user', t('skill.option.user'))
    .option('--dry-run', t('skill.option.dryRun'))
    .option('--force', t('options.force.description'))
    .option('-y, --yes', t('options.yes.description'))
    .action(async (dir: string | undefined, options: SharedOptions) => {
      reportOverride();

      const prepared = await prepare(dir, options, true);
      if (!prepared) {
        return;
      }

      const plan = planInstall(
        {
          root: prepared.root,
          targetIds: prepared.targets.map((target) => target.id),
          files: prepared.files,
          force: Boolean(options.force)
        },
        planDependencies()
      );

      // Anything Runestone generated before and no longer produces is removed
      // in the same pass, so an upgrade does not leave files an agent will
      // still read.
      const expected = plan.files.map((file) => file.absolutePath);
      const orphans = findOrphans(prepared.root, expected, skillDirectoriesOf(prepared.targets, options));

      printPlan(plan);
      if (orphans.length > 0) {
        logger.info(t('skill.orphans', { count: String(orphans.length) }));
        for (const orphan of orphans) {
          console.log(`  ${red(orphan)}`);
        }
      }

      if (plan.blockers.length > 0) {
        process.exitCode = 1;
        return;
      }
      if (options.dryRun) {
        return;
      }

      const changing = plan.files.filter((file) => file.action !== 'unchanged' && file.action !== 'skip-modified');
      if (changing.length === 0 && orphans.length === 0) {
        return;
      }

      if (needsConsentAndCannotAsk(options)) {
        logger.error(t('skill.nonInteractive'));
        process.exitCode = 1;
        return;
      }

      if (!options.yes) {
        const confirmed = await p.confirm({
          message: t('skill.prompt.confirm', { count: String(changing.length + orphans.length) })
        });
        if (p.isCancel(confirmed) || !confirmed) {
          logger.warn(t('skill.cancelled'));
          return;
        }
      }

      const result = applyInstall(plan);
      for (const orphan of orphans) {
        fs.rmSync(orphan, { force: true });
      }

      logger.success(t('skill.applied.title', { count: String(result.written.length + orphans.length) }));
      reportApplied(result);
    });
}

/** Skill roots a set of targets writes into, honouring a path override. */
function skillDirectoriesOf(targets: TargetDefinition[], options: SharedOptions): string[] {
  const directories = new Set<string>();
  for (const target of targets) {
    for (const file of target.render({ topics: {}, hostDomain: '' })) {
      const match = /^(.*)\/runestone\/(?:SKILL\.md|references\/)/.exec(file.relativePath);
      if (match) {
        directories.add(options.skillsDir ? options.skillsDir.replace(/\\/g, '/') : match[1]);
      }
    }
  }

  return [...directories];
}

function createRemoveCommand(): Command {
  return createCommand('remove')
    .alias('rm')
    .alias('del')
    .description(t('commands.skill.remove.description'))
    .argument('[dir]', 'directory to remove from')
    .option('--target <name>', t('skill.option.target'), collect, [])
    .option('--skills-dir <path>', t('skill.option.skillsDir'))
    .option('--instructions-file <path>', t('skill.option.instructionsFile'))
    .option('--user', t('skill.option.user'))
    .option('--dry-run', t('skill.option.dryRun'))
    .option('--force', t('options.force.description'))
    .option('-y, --yes', t('options.yes.description'))
    .action(async (dir: string | undefined, options: SharedOptions) => {
      reportOverride();

      const prepared = await prepare(dir, options);
      if (!prepared) {
        return;
      }

      const plan = planRemove(
        {
          root: prepared.root,
          targetIds: prepared.targets.map((target) => target.id),
          files: prepared.files,
          force: Boolean(options.force)
        },
        planDependencies()
      );

      const expected = plan.files.map((file) => file.absolutePath);
      const orphans = findOrphans(prepared.root, expected, skillDirectoriesOf(prepared.targets, options));

      printPlan(plan);
      if (plan.blockers.length > 0) {
        process.exitCode = 1;
        return;
      }

      const removing = plan.files.filter((file) => file.action === 'delete');
      if (removing.length === 0 && orphans.length === 0) {
        logger.info(t('skill.removed.nothing'));
        return;
      }
      if (options.dryRun) {
        return;
      }

      if (needsConsentAndCannotAsk(options)) {
        logger.error(t('skill.nonInteractive'));
        process.exitCode = 1;
        return;
      }

      if (!options.yes) {
        const confirmed = await p.confirm({
          message: t('skill.prompt.confirm', { count: String(removing.length + orphans.length) })
        });
        if (p.isCancel(confirmed) || !confirmed) {
          logger.warn(t('skill.cancelled'));
          return;
        }
      }

      const result = applyRemove(plan);
      for (const orphan of orphans) {
        fs.rmSync(orphan, { force: true });
      }

      logger.success(t('skill.removed.title', { count: String(result.written.length + orphans.length) }));
      reportApplied(result);

      for (const file of plan.files.filter((file) => file.action === 'skip-modified')) {
        logger.warn(t('skill.kept', { path: file.absolutePath }));
      }
    });
}

export function createSkillCommand(): Command {
  // No options of its own: a command whose only option is --help must not print
  // an Options section, and the integration suite asserts exactly that.
  return createCommand('skill')
    .description(t('commands.skill.description'))
    .addCommand(createInstallCommand())
    .addCommand(createStatusCommand())
    .addCommand(createRemoveCommand());
}
