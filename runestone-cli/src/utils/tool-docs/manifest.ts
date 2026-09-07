/**
 * The topic corpus, as data. Pure: no filesystem, no process.
 *
 * `summary` and `brief` live here rather than in per-file frontmatter because
 * parsing frontmatter would need a YAML dependency that is currently a
 * devDependency only. They are different lengths on purpose:
 *
 *   summary  one line, for the generated topic index
 *   brief    one to three lines, for a block inside the user's instruction
 *            file — which is always in context, so the body would tax every
 *            request the user ever makes (spec 8.4)
 *
 * A test asserts this list and `tool-docs/ai-context/*.md` are in bijection.
 */

export type TopicTier = 'offline' | 'online';

export interface TopicDefinition {
  /** Asset basename, and the value accepted by `--ai-context <topic>`. */
  id: string;
  title: string;
  summary: string;
  brief: string;
  /** `online` means rendering it needs Docker or the Traefik API (spec 6.2). */
  tier: TopicTier;
}

/**
 * `compose` is first and is the default, which is a compatibility
 * requirement rather than an editorial one: a bare `--ai-context` has meant
 * this topic since 1.0.1, and the README ships example prompts containing
 * that exact invocation (spec 7.2).
 */
export const TOPICS: readonly TopicDefinition[] = [
  {
    id: 'compose',
    title: 'Compose integration',
    summary: 'Wire a project that runs in Docker into Runestone with Traefik labels.',
    brief: 'For a project that runs in Docker, routing is done with Traefik labels plus the external Runestone network.',
    tier: 'offline'
  },
  {
    id: 'service',
    title: 'Routing something that is not in Docker',
    summary: 'Route a host dev server, an already-running process, or an external URL with `runestone service add`.',
    brief: 'For anything not in Docker — a host dev server, an already-running process, an external URL — use `runestone service add`, not Compose labels.',
    tier: 'offline'
  },
  {
    id: 'troubleshoot',
    title: 'Troubleshooting',
    summary: 'Symptom to cause: 404, 502, certificate warnings, and working in the browser but not from another container.',
    brief: 'Before changing anything twice, match the symptom: 404 means no route, 502 means the route works but the target does not answer, and a URL that works in the browser but not from another container is the loopback problem.',
    tier: 'offline'
  },
  {
    id: 'overview',
    title: 'Overview',
    summary: 'What Runestone is, how to choose between the two integration paths, and which commands not to run.',
    brief: 'Runestone routes local HTTPS domains through Traefik. There are exactly two ways to connect a project, and some commands change the whole machine and must be left to the user.',
    tier: 'offline'
  }
] as const;

export const DEFAULT_TOPIC = 'compose';

export function topicIds(): string[] {
  return TOPICS.map((topic) => topic.id);
}

export function findTopic(id: string): TopicDefinition | undefined {
  return TOPICS.find((topic) => topic.id === id);
}
