import { DaemonHost } from './daemon-target';

/**
 * Upstream DNS determination (spec 8.4) and Bind IP determination (spec 6.1).
 *
 * Both are pure and take everything they need as arguments, so the platform
 * detection and the `dns.getServers()` call live at the caller's edge and the
 * rules themselves are testable offline.
 */

/** Shipped default of `DNS_UPSTREAM` and last resort of the detection path. */
export const DEFAULT_UPSTREAM = '1.1.1.1';

export type UpstreamOrigin = 'env' | 'daemon' | 'host' | 'default';

export interface UpstreamSources {
  /** `DNS_UPSTREAM` from `.env`, or `--upstream`. Authoritative when non-empty. */
  configured?: string | string[];
  /** Entries already in the daemon configuration's `dns` array. */
  daemonEntries?: string[];
  /** The host's own resolvers, from Node `dns.getServers()`. */
  hostResolvers?: string[];
  /** Excluded from detection, because pointing dnsmasq at us would be a loop. */
  targetIp?: string;
}

export interface UpstreamResolution {
  /** **Never empty** (spec 8.4). */
  upstreams: string[];
  /** Where each value came from, which the disclosure in 11.3 item 10 must show. */
  origins: Array<{ value: string; origin: UpstreamOrigin }>;
}

export function parseUpstreamList(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  const parts = Array.isArray(value) ? value : value.split(',');
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * Loopback addresses are excluded from detection: `127.0.0.53` is the
 * systemd-resolved stub, and a container forwarding to `127.0.0.1` would be
 * asking itself. The unspecified addresses are excluded on the same grounds —
 * they are not resolvers, so detecting one would be as good as detecting
 * nothing, and spec 8.4 requires the result to be usable rather than merely
 * non-empty.
 */
export function isUnusableUpstream(value: string): boolean {
  const address = value.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (address === '') {
    return true;
  }

  return (
    address.startsWith('127.') ||
    address === '::1' ||
    address === '0.0.0.0' ||
    address === '::' ||
    address.startsWith('169.254.')
  );
}

/**
 * Spec 8.4. Order: `DNS_UPSTREAM` when non-empty, then detection (daemon entries,
 * then the host's resolvers, both excluding loopback addresses and the Target
 * IP), then `1.1.1.1`. **It never aborts and never returns an empty list**: with
 * no upstream, dnsmasq runs with `no-resolv` and every container on the machine
 * loses internet name resolution the moment DNS is enabled.
 */
export function determineUpstreams(sources: UpstreamSources = {}): UpstreamResolution {
  const seen = new Set<string>();
  const origins: Array<{ value: string; origin: UpstreamOrigin }> = [];

  const add = (value: string, origin: UpstreamOrigin): void => {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    origins.push({ value, origin });
  };

  const configured = parseUpstreamList(sources.configured);
  if (configured.length > 0) {
    // Authoritative: this is what setup wrote, so the user's own choice is not
    // second-guessed here.
    for (const value of configured) {
      add(value, 'env');
    }

    return { upstreams: origins.map((entry) => entry.value), origins };
  }

  const detected: Array<[string[], UpstreamOrigin]> = [
    [sources.daemonEntries ?? [], 'daemon'],
    [sources.hostResolvers ?? [], 'host']
  ];

  for (const [candidates, origin] of detected) {
    for (const candidate of parseUpstreamList(candidates)) {
      if (isUnusableUpstream(candidate) || candidate === sources.targetIp) {
        continue;
      }

      add(candidate, origin);
    }
  }

  if (origins.length === 0) {
    add(DEFAULT_UPSTREAM, 'default');
  }

  return { upstreams: origins.map((entry) => entry.value), origins };
}

/**
 * Spec 6.1. On Docker Desktop the Target IP is an address inside the Docker VM,
 * so no host interface has it and a port cannot be published to it; on a native
 * engine the docker0 gateway genuinely exists on the host, and binding it avoids
 * the `127.0.0.53` address held by systemd-resolved without exposing port 53 to
 * the whole LAN.
 */
export function determineBindIp(input: { host: DaemonHost; targetIp: string }): string {
  return input.host === 'linux-engine' ? input.targetIp : '0.0.0.0';
}
