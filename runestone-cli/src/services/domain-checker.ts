import { promises as dns } from 'dns';
import * as net from 'net';
import * as os from 'os';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface LocalAddressInfo {
  addresses: string[];
  hasExternalIpv6: boolean;
}

export interface HostResolutionCheck {
  host: string;
  resolved: ResolvedAddress[];
  matched: ResolvedAddress[];
  warnings: string[];
  errors: string[];
  status: 'pass' | 'warn' | 'fail';
}

export interface DomainResolutionCheck {
  domain: string;
  wildcardProbeHost: string;
  checkedHosts: HostResolutionCheck[];
  localAddresses: string[];
  hasExternalIpv6: boolean;
  status: 'pass' | 'warn' | 'fail';
}

function stripIpv6Scope(address: string): string {
  return address.split('%')[0];
}

function normalizeIpv4Mapped(address: string): string {
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    return lower.slice('::ffff:'.length);
  }

  return lower;
}

function normalizeAddress(address: string): string {
  return normalizeIpv4Mapped(stripIpv6Scope(address).trim());
}

export function getLocalAddressInfo(): LocalAddressInfo {
  const addresses = new Set<string>(['127.0.0.1', '::1']);
  let hasExternalIpv6 = false;

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const normalized = normalizeAddress(entry.address);
      if (normalized && net.isIP(normalized)) {
        addresses.add(normalized);
      }
      if (entry.family === 'IPv6' && !entry.internal) {
        hasExternalIpv6 = true;
      }
    }
  }

  return {
    addresses: [...addresses],
    hasExternalIpv6
  };
}

export function checkHostResolution(
  host: string,
  resolved: ResolvedAddress[],
  localInfo: LocalAddressInfo
): HostResolutionCheck {
  const localAddresses = new Set(localInfo.addresses.map(normalizeAddress));
  const matched = resolved.filter((record) => localAddresses.has(normalizeAddress(record.address)));
  const ipv4Resolved = resolved.filter((record) => record.family === 4);
  const ipv6Resolved = resolved.filter((record) => record.family === 6);
  const ipv4Matched = matched.some((record) => record.family === 4);
  const ipv6Matched = matched.some((record) => record.family === 6);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (resolved.length === 0) {
    errors.push(`${host} did not resolve to any A or AAAA records.`);
  }

  if (ipv6Resolved.length > 0 && !localInfo.hasExternalIpv6 && !ipv6Matched) {
    warnings.push(`${host} has IPv6 records, but this machine does not appear to have external IPv6 enabled.`);
  }

  if (matched.length === 0) {
    errors.push(`${host} does not resolve to 127.0.0.1, ::1, or any local network interface address.`);
  } else if (ipv4Matched && ipv6Resolved.length > 0 && !ipv6Matched) {
    warnings.push(`${host} resolves to this machine over IPv4, but its IPv6 records do not match this machine.`);
  } else if (ipv6Matched && ipv4Resolved.length > 0 && !ipv4Matched) {
    warnings.push(`${host} resolves to this machine over IPv6, but its IPv4 records do not match this machine.`);
  }

  const status = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

  return {
    host,
    resolved,
    matched,
    warnings,
    errors,
    status
  };
}

export function wildcardProbeHost(domain: string): string {
  return `runestone-wildcard-check.${domain.trim()}`;
}

export async function checkDomainResolvesToThisMachine(domain: string): Promise<DomainResolutionCheck> {
  const normalizedDomain = domain.trim();
  const localInfo = getLocalAddressInfo();
  const probeHost = wildcardProbeHost(normalizedDomain);
  const hosts = [probeHost];
  const checkedHosts: HostResolutionCheck[] = [];

  for (const host of hosts) {
    try {
      const resolved = await dns.lookup(host, { all: true, verbatim: true });
      checkedHosts.push(checkHostResolution(host, resolved, localInfo));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checkedHosts.push({
        host,
        resolved: [],
        matched: [],
        warnings: [],
        errors: [`${host} could not be resolved: ${message}`],
        status: 'fail'
      });
    }
  }

  const status = checkedHosts.some((host) => host.status === 'fail')
    ? 'fail'
    : checkedHosts.some((host) => host.status === 'warn')
      ? 'warn'
      : 'pass';

  return {
    domain: normalizedDomain,
    wildcardProbeHost: probeHost,
    checkedHosts,
    localAddresses: localInfo.addresses,
    hasExternalIpv6: localInfo.hasExternalIpv6,
    status
  };
}
