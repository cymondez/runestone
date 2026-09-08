/**
 * A fact that may not be obtainable.
 *
 * The agent-facing context has to stay useful when Docker is stopped or Traefik
 * is unreachable, and it must say so in words the agent can act on rather than
 * either throwing or quietly reporting an empty list. An empty list and "I could
 * not look" are different answers, and conflating them is how an agent concludes
 * that a name is free when it simply could not check.
 *
 * Nothing here prints. A failure becomes a value; the renderer decides how to
 * say it. `docs --ai-context` asserts an empty stderr, so a probe that wrote a
 * warning to stderr would break the contract that makes the output pipeable.
 */

export type ProbeFailure = 'skipped' | 'unavailable';

export type Probe<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ProbeFailure; readonly message?: string };

/** The fact was obtained. */
export function present<T>(value: T): Probe<T> {
  return { ok: true, value };
}

/** The fact was not asked for — an offline render, or `--offline`. */
export function skipped<T>(): Probe<T> {
  return { ok: false, reason: 'skipped' };
}

/** The fact was asked for and the source could not answer. */
export function unavailable<T>(message: string): Probe<T> {
  return { ok: false, reason: 'unavailable', message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run `read`, turning any throw into an `unavailable` value. */
export function probe<T>(read: () => T): Probe<T> {
  try {
    return present(read());
  } catch (error) {
    return unavailable(messageOf(error));
  }
}

/** The asynchronous form, for probes that issue a request. */
export async function probeAsync<T>(read: () => Promise<T>): Promise<Probe<T>> {
  try {
    return present(await read());
  } catch (error) {
    return unavailable(messageOf(error));
  }
}
