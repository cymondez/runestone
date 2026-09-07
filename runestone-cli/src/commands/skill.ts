import { Command } from 'commander';
import { dim, green, red, yellow } from 'kleur';
import { contextBlocks } from '../services/agent-context/render';
import { buildOfflineSnapshot } from '../services/agent-context/snapshot';
import { Plan, PlannedFile, planInstall } from '../services/skill/plan';
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

/** Resolve scope, targets and files, or report why it cannot be done. */
function prepare(dir: string | undefined, options: SharedOptions):
  | { root: string; targets: TargetDefinition[]; files: RenderedFile[] }
  | undefined {
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
      logger.error(t('skill.error.unknownTarget', { target: error.message, targets: targetIds().join(', ') }));
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }

  const { supported, unsupported } = targetsForScope(requested, resolved.scope);
  if (unsupported.length > 0) {
    logger.error(
      t('skill.error.userScopeUnsupported', { targets: unsupported.map((target) => target.id).join(', ') })
    );
    process.exitCode = 1;
    return undefined;
  }
  if (supported.length === 0) {
    logger.error(t('skill.error.noTargets', { root: resolved.root }));
    process.exitCode = 1;
    return undefined;
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
    .action((dir: string | undefined, options: SharedOptions) => {
      reportOverride();

      const prepared = prepare(dir, options);
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
    .action((dir: string | undefined, options: SharedOptions) => {
      reportOverride();

      const prepared = prepare(dir, options);
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

      printPlan(plan);

      if (plan.blockers.length > 0) {
        process.exitCode = 1;
        return;
      }

      if (!options.dryRun) {
        // Naming a flag for the only behaviour there is would claim the user
        // has a choice they do not. This build plans and refuses to write.
        logger.warn(t('skill.install.notYet'));
        process.exitCode = 1;
      }
    });
}

export function createSkillCommand(): Command {
  // No options of its own: a command whose only option is --help must not print
  // an Options section, and the integration suite asserts exactly that.
  return createCommand('skill')
    .description(t('commands.skill.description'))
    .addCommand(createInstallCommand())
    .addCommand(createStatusCommand());
}
