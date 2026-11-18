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
 * `compose` is first because a bare `--ai-context` meant this topic from 1.0.1
 * until the guide replaced it, and the README ships example prompts with that
 * exact invocation (spec 7.2). The guide still contains it in full.
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
    id: 'state',
    title: 'Live state of this machine',
    summary: 'Read the machine now: usable hostnames, names already taken by any project, whether Runestone is up.',
    brief: 'Before choosing a hostname or a service name, run `runestone docs --ai-context state` — it reports what is already registered, including by other projects.',
    tier: 'online'
  },
  {
    id: 'overview',
    title: 'Overview',
    summary: 'What Runestone is, how to choose between the two integration paths, and which commands not to run.',
    brief: 'Runestone routes local HTTPS domains through Traefik. There are exactly two ways to connect a project, and some commands change the whole machine and must be left to the user.',
    tier: 'offline'
  }
] as const;

/**
 * What `renderAiPromptContext` renders, kept for its callers. It is no longer
 * what a bare `--ai-context` prints: that is `GUIDE_TOPIC`, below.
 */
export const DEFAULT_TOPIC = 'compose';

/**
 * What a bare `runestone docs --ai-context` prints, and what the MCP
 * `runestone_integration_guide` tool returns: how to connect a project, with
 * the choice between the two paths before either path. Not a manifest entry: it
 * has no asset.
 *
 * A bare `--ai-context` used to mean the compose topic alone, which told a
 * project with no container to "create compose.yml"; the choice lived only in
 * the footer. MCP was corrected the same way in C4 (spec 11.2). The guide
 * contains the compose topic in full, so a prompt written for the old
 * behaviour receives everything it did before, plus the choice it was missing.
 */
export const GUIDE_TOPIC = 'guide';

export const GUIDE_TOPIC_ORDER: readonly string[] = ['overview', 'compose', 'service'];

/** Renders every topic in one go. Not a manifest entry: it has no asset. */
export const ALL_TOPIC = 'all';

/**
 * The order `all` concatenates in, from specification 5.1.
 *
 * Deliberately not the manifest's own order: `overview` comes first because it
 * explains how to choose between the two integration paths, and reading the
 * specifics before that choice is backwards. A test asserts this list is a
 * permutation of the manifest, so a new topic cannot be silently omitted.
 */
export const ALL_TOPIC_ORDER: readonly string[] = ['overview', 'compose', 'service', 'state', 'troubleshoot'];

export function topicIds(): string[] {
  return TOPICS.map((topic) => topic.id);
}

/** Everything `--ai-context` accepts, `guide` and `all` included. */
export function selectableTopicIds(): string[] {
  return [GUIDE_TOPIC, ...topicIds(), ALL_TOPIC];
}

/** The topics a composite value renders, in order, or undefined for a single topic. */
export function compositeTopicOrder(id: string): readonly string[] | undefined {
  if (id === GUIDE_TOPIC) {
    return GUIDE_TOPIC_ORDER;
  }

  return id === ALL_TOPIC ? ALL_TOPIC_ORDER : undefined;
}

export function findTopic(id: string): TopicDefinition | undefined {
  return TOPICS.find((topic) => topic.id === id);
}
