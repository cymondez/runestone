/**
 * Where the agent corpus gets installed, and in what shape.
 *
 * Pure: paths and strings, no filesystem.
 *
 * The install-path landscape is not stable — every runtime scans a different
 * set of directories and the set changes between releases — so any path written
 * into logic is a path that will eventually be wrong. Everything here is
 * therefore data in one table, each row carrying the documentation it came from
 * and the date it was checked, so that a path change is a one-line edit and an
 * out-of-date row is visible.
 *
 * The resolution order the table implements (spec 8.2):
 *
 *   1. the neutral default   `.agents/skills/`, read by Codex, Cursor and
 *                            VS Code / Copilot from one write
 *   2. documented exceptions Claude Code reads `.claude/skills/`, not the
 *                            neutral paths
 *   3. user-settable paths   `--skills-dir`, for a runtime not in this table
 *                            or a path that moved
 *
 * **Runestone installs skills, and nothing else.** It never writes into
 * `AGENTS.md`, `CLAUDE.md` or any other file carrying the user's own
 * instructions to their agent, and it installs no runtime-specific rules file
 * either. Every runtime in the table finds a skill by scanning its skills
 * directories, so the skill is the whole delivery.
 */

import { TOPICS, TopicDefinition } from '../../utils/tool-docs';
import { SKILL_TEMPLATE_VERSION, fileMarker, frontmatterMarker } from './version';

export interface RenderedFile {
  /** Slash-separated, relative to the target directory. */
  relativePath: string;
  content: string;
}

export interface TargetDefinition {
  id: string;
  title: string;
  /** Where the paths below were read from. */
  docsUrl: string;
  /** When they were last checked against that documentation. */
  verifiedOn: string;
  /**
   * Directories whose presence means this runtime is in use here. Detection is
   * what stops a repository using one runtime acquiring another's directory.
   * Directories only: an `AGENTS.md` or a `CLAUDE.md` is the user's own
   * instruction file, and Runestone neither writes nor reads those.
   */
  detect: string[];
  /** Home-relative destination, when the runtime has a real user-level path. */
  userScope?: string;
  render: (context: RenderContext) => RenderedFile[];
}

export interface RenderContext {
  /** Rendered topic bodies, keyed by topic id. */
  topics: Record<string, string>;
  hostDomain: string;
}

const SKILL_NAME = 'runestone';

/**
 * The `description` is the only part a runtime loads before deciding whether to
 * activate the skill, so it has to carry the words a relevant task will contain.
 * The Agent Skills specification caps it at 1024 characters and requires `name`
 * to match the parent directory; both are asserted by a test.
 */
const SKILL_DESCRIPTION =
  'Connect a project to Runestone, the local development environment that already runs Traefik (real HTTPS on local ' +
  'domains) and Mailpit (an SMTP mail catcher) for every project on this machine. Use when adding Runestone support to ' +
  'a project, choosing a local hostname, writing Traefik labels or a compose.override.yml, exposing a host dev server or ' +
  'an external URL, setting up email sending in development, or about to add a reverse proxy (Traefik, nginx-proxy, ' +
  'Caddy) or a mail catcher (Mailpit, MailHog, smtp4dev), which Runestone already provides. Also for diagnosing a 404, ' +
  'a 502, a certificate warning or a URL that works in the browser but not from another container.';

function frontmatter(version: number): string {
  return [
    '---',
    frontmatterMarker(version),
    `name: ${SKILL_NAME}`,
    `description: ${SKILL_DESCRIPTION}`,
    'metadata:',
    `  runestone-skill-template: "${version}"`,
    '---'
  ].join('\n');
}

/**
 * The skill body stays short and points at the references, because a runtime
 * loads the whole of it once the skill activates. The detail lives one level
 * down, which is what the specification's progressive disclosure is for.
 */
function skillBody(context: RenderContext): string {
  return [
    '',
    '# Runestone',
    '',
    'Runestone already runs Traefik and Mailpit for every project on this machine. Never add your own reverse proxy or',
    'mail catcher; connect the project to these. [overview](references/overview.md) lists the Mailpit SMTP addresses.',
    '',
    'Runestone is already installed and configured. Setting it up is not your job.',
    '',
    `Local domains end in \`${context.hostDomain}\`.`,
    '',
    '## Steps',
    '',
    '1. Choose the integration path. Ask one question: does the thing being exposed run in a container Traefik can',
    '   discover?',
    '   - Yes: Traefik labels plus the external Runestone network. Follow [compose](references/compose.md).',
    '   - No: `runestone service add`, which writes a Traefik file-provider entry. Follow [service](references/service.md).',
    '',
    '   Getting this wrong fails quietly: labels on a project with no container are inert, and a file-provider entry',
    '   pointing at `localhost` reaches the Runestone container rather than the host.',
    '2. Run `runestone docs --ai-context state`. It reports which hostnames a certificate covers, and which router IDs,',
    '   service IDs and hostnames are already taken, including by other projects, which is not visible any other way.',
    '3. Choose the hostname and the name yourself, from the project\'s directory name, and check them with',
    '   `runestone service check <name> --route <hostname>`, which changes nothing. Say in your report that you chose',
    '   them; do not stop to ask.',
    '4. Write the Compose override, or run `runestone service add` with the name, `--route` and `--url` all on the',
    '   command line: without a terminal it cannot ask for anything.',
    '5. Verify with the checks at the end of the reference you followed. Look at the response, not only its status:',
    '   an unrouted hostname gets Runestone\'s "Service not found!" page with status 200.',
    '6. Report what you changed, the URL, and anything you assumed.',
    '',
    'If the `runestone` command is not found, you are probably inside a container or a sandbox that cannot see the',
    'host. Ask the user to run the Runestone commands on the host.',
    '',
    '`runestone docs --ai-context` prints the same guidance from the installed CLI; `runestone docs --ai-context all`',
    'adds the live state and the troubleshooting topic.',
    '',
    '## Never run these yourself',
    '',
    'They change state outside this project. Propose them and let the user run them: `runestone dns enable`,',
    '`runestone dns disable`, `runestone certs install`, `runestone setup`, `runestone down`, `runestone up`,',
    '`runestone stop`. See [overview](references/overview.md) for what each one costs.',
    '',
    '## References',
    '',
    ...TOPICS.map((topic: TopicDefinition) => `- [${topic.id}](references/${topic.id}.md) — ${topic.summary}`),
    ''
  ].join('\n');
}

/**
 * An online topic is nothing but live facts, so its installed copy says where
 * to get them. The rendered topic began "Everything below was read at the
 * moment this command ran. Do not copy it into a file", and was then written
 * into a file.
 */
function liveTopicStub(topicId: string): string {
  return [
    `# Runestone: ${topicId}`,
    '',
    'This topic is the live state of this machine, so it is not stored in this file. Run:',
    '',
    `    runestone docs --ai-context ${topicId}`,
    ''
  ].join('\n');
}

function skillFiles(skillsDir: string, context: RenderContext, version: number): RenderedFile[] {
  const root = `${skillsDir}/${SKILL_NAME}`;

  return [
    {
      relativePath: `${root}/SKILL.md`,
      content: `${frontmatter(version)}${skillBody(context)}`
    },
    ...TOPICS.map((topic) => ({
      relativePath: `${root}/references/${topic.id}.md`,
      content: `${fileMarker(version)}\n\n${topic.tier === 'online' ? liveTopicStub(topic.id) : context.topics[topic.id]}`
    }))
  ];
}

export const NEUTRAL_SKILLS_DIR = '.agents/skills';

/**
 * The target used when nothing is detected and there is nobody to ask.
 *
 * `.agents/skills` is read by Codex, Cursor and VS Code, so writing it is
 * useful in a project that has none of their directories yet — which is the
 * ordinary state of a project the first time anyone runs this.
 */
export const NEUTRAL_TARGET_ID = 'agents';

export const TARGETS: readonly TargetDefinition[] = [
  {
    id: 'agents',
    title: 'Neutral: .agents/skills',
    docsUrl: 'https://agents.md',
    verifiedOn: '2026-09-07',
    detect: [NEUTRAL_SKILLS_DIR, '.agents'],
    userScope: '.agents/skills',
    render: (context) => skillFiles(NEUTRAL_SKILLS_DIR, context, SKILL_TEMPLATE_VERSION)
  },
  {
    id: 'claude',
    title: 'Claude Code',
    docsUrl: 'https://code.claude.com/docs/en/skills',
    verifiedOn: '2026-09-07',
    detect: ['.claude/skills', '.claude'],
    userScope: '.claude/skills',
    // The documented exception: Claude Code does not read .agents/skills, so it
    // needs its own copy.
    render: (context) => skillFiles('.claude/skills', context, SKILL_TEMPLATE_VERSION)
  },
  {
    // `copilot-vscode`, not `copilot`, because `mcp --client copilot` is the
    // Copilot *CLI* — a different product with its own configuration file. The
    // two were briefly both called `copilot`, which read as though installing
    // one would configure the other.
    id: 'copilot-vscode',
    title: 'GitHub Copilot in VS Code',
    docsUrl: 'https://code.visualstudio.com/docs/agent-customization/agent-skills',
    verifiedOn: '2026-09-07',
    detect: ['.github/skills', '.vscode'],
    userScope: '.copilot/skills',
    render: (context) => skillFiles('.github/skills', context, SKILL_TEMPLATE_VERSION)
  }
] as const;

export function targetIds(): string[] {
  return TARGETS.map((target) => target.id);
}

export function findTarget(id: string): TargetDefinition | undefined {
  return TARGETS.find((target) => target.id === id);
}

/**
 * Codex scans `.agents/skills`, which the neutral target already writes, so it
 * is an alias rather than a second copy of the same skill.
 */
export const TARGET_ALIASES: Readonly<Record<string, string>> = { codex: 'agents' };

/**
 * Everything `--target` accepts, aliases included.
 *
 * `targetIds()` is the canonical set and is what the table iterates. This is
 * what a user should be shown, because the two differ: `--target codex` works,
 * and someone who mistypes and reads the error would otherwise never learn
 * that. An accepted value missing from the advertised list is a value nobody
 * finds.
 */
export function acceptedTargetIds(): string[] {
  return [...targetIds(), ...Object.entries(TARGET_ALIASES).map(([alias, id]) => `${alias} (= ${id})`)];
}

export function resolveTargetId(id: string): string {
  return TARGET_ALIASES[id] ?? id;
}
