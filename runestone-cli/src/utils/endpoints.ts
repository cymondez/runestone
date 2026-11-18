/**
 * Where the things Runestone already runs can be reached.
 *
 * One place for these, because an AI agent that cannot find them installs its
 * own Traefik or Mailpit. `up` prints them, `status` reports them, and the agent
 * corpus states them; all three read from here. Pure: `.env` values in, strings
 * out, so they are safe in an installed skill file as well as in a live report.
 */

import { RunestoneEnv } from './env-loader';

/** Mailpit's SMTP port inside the Runestone container, before Compose publishes it. */
export const MAILPIT_CONTAINER_SMTP_PORT = 1025;

/** Traefik's dashboard, which is also where its API lives. */
export function traefikDashboardUrl(hostDomain: string): string {
  return `https://traefik.${hostDomain}`;
}

export function mailpitUiUrl(hostDomain: string): string {
  return `https://mailpit.${hostDomain}`;
}

/**
 * Mailpit's SMTP address, which depends on where the sender runs. None of them
 * needs a username, a password or TLS.
 *
 * `fromOtherContainers` needs `extra_hosts: host.docker.internal:host-gateway`
 * on the sending service. Measured on 2026-10-14: on Docker Desktop with
 * Runestone DNS enabled, `host.docker.internal` did not resolve in a container
 * on the default bridge, on the Runestone network, or on another user-defined
 * network, and resolved in all of them once that line was added.
 */
export interface SmtpEndpoints {
  /** A process running on the host. */
  fromHost: string;
  /** A container attached to the Runestone network, by the Runestone container's name. */
  fromRunestoneNetwork: string;
  /** Any other container, given the `extra_hosts` line above. */
  fromOtherContainers: string;
}

export function smtpEndpoints(config: Pick<RunestoneEnv, 'SMTP_PORT' | 'PREFIX'>): SmtpEndpoints {
  return {
    fromHost: `localhost:${config.SMTP_PORT}`,
    fromRunestoneNetwork: `${config.PREFIX}:${MAILPIT_CONTAINER_SMTP_PORT}`,
    fromOtherContainers: `host.docker.internal:${config.SMTP_PORT}`
  };
}
