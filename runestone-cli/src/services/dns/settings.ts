import { RunestoneEnv } from '../../utils/env-loader';
import { OwnedEntryInput } from './daemon-config';

/**
 * Reading the DNS settings out of `.env` (spec 7.1). Kept in one place because
 * "is DNS on" is asked from several commands, and each of them answering it
 * slightly differently is how a feature ends up half-enabled.
 */

export type DnsSettingsSource = Pick<
  RunestoneEnv,
  | 'DNS_ENABLE'
  | 'DNS_HOST_IP'
  | 'DNS_BIND_IP'
  | 'DNS_UPSTREAM'
  | 'DNS_DAEMON_FALLBACK'
  | 'DNS_AUTO_REORDER'
  | 'DNS_UI_ENABLE'
  | 'DNS_UI_USER'
  | 'DNS_UI_PASS'
>;

export function isTruthy(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

/** An absent or unrecognised `DNS_ENABLE` means disabled (spec 13). */
export function isDnsEnabled(config: Pick<DnsSettingsSource, 'DNS_ENABLE'>): boolean {
  return isTruthy(config.DNS_ENABLE);
}

export function isAutoReorderEnabled(config: Pick<DnsSettingsSource, 'DNS_AUTO_REORDER'>): boolean {
  return isTruthy(config.DNS_AUTO_REORDER);
}

export function isDnsUiEnabled(config: Pick<DnsSettingsSource, 'DNS_UI_ENABLE'>): boolean {
  return isTruthy(config.DNS_UI_ENABLE);
}

/** Unset means the UI has no authentication at all, which must be disclosed. */
export function isDnsUiAuthConfigured(config: Pick<DnsSettingsSource, 'DNS_UI_USER' | 'DNS_UI_PASS'>): boolean {
  return config.DNS_UI_USER.trim() !== '' && config.DNS_UI_PASS.trim() !== '';
}

/** The optional second owned entry of spec 9.7. Empty means off. */
export function daemonFallbackValue(
  config: Pick<DnsSettingsSource, 'DNS_DAEMON_FALLBACK'>
): string | undefined {
  const value = config.DNS_DAEMON_FALLBACK.trim();
  return value === '' ? undefined : value;
}

/**
 * The entries Runestone would own, in the order they are inserted at the front of
 * the daemon `dns` array: the Target IP first, the 9.7 fallback second.
 */
export function ownedEntryInputs(
  config: Pick<DnsSettingsSource, 'DNS_HOST_IP' | 'DNS_DAEMON_FALLBACK'>
): OwnedEntryInput[] {
  const entries: OwnedEntryInput[] = [];
  const targetIp = config.DNS_HOST_IP.trim();

  if (targetIp !== '') {
    entries.push({ role: 'target', value: targetIp });
  }

  const fallback = daemonFallbackValue(config);
  if (fallback !== undefined) {
    entries.push({ role: 'fallback', value: fallback });
  }

  return entries;
}
