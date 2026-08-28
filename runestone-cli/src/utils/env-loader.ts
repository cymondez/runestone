import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { pathHelpers } from './path-helpers';
import { toolState } from './tool-state';

export interface RunestoneEnv {
  HOST_DOMAIN: string;
  PREFIX: string;
  HTTPS_PORT: string;
  HTTP_PORT: string;
  SMTP_PORT: string;
  RUNESTONE_IMAGE: string;
  RUNESTONE_TAG: string;
  MKCERT_INSTALLED: string;
  RUNESTONE_VERSION: string;
  RUNESTONE_LANG: string;
  WEB_ENTRYPOINT_PORT: string;
  WEB_ENTRYPOINT_NAME: string;
  WEB_SECURE_ENTRYPOINT_PORT: string;
  WEB_SECURE_ENTRYPOINT_NAME: string;
  DNS_ENABLE: string;
  DNS_HOST_IP: string;
  DNS_BIND_IP: string;
  DNS_BIND_PREFIX: string;
  DNS_UPSTREAM: string;
  DNS_DAEMON_FALLBACK: string;
  DNS_AUTO_REORDER: string;
  DNS_CONTAINER_RESOLVER: string;
  DNS_UI_ENABLE: string;
  DNS_UI_USER: string;
  DNS_UI_PASS: string;
  PROJECT_DIR: string;
  ENV_PATH: string;
  COMPOSE_FILE_PATH: string;
  NETWORK_NAME: string;
  SSH_VOLUME_NAME: string;
  ENV_FILE_EXISTS: boolean;
  REQUIRED_VARS_PRESENT: boolean;
}

export type EnvInput = Partial<
  Pick<
    RunestoneEnv,
    | 'HOST_DOMAIN'
    | 'PREFIX'
    | 'HTTPS_PORT'
    | 'HTTP_PORT'
    | 'SMTP_PORT'
    | 'RUNESTONE_IMAGE'
    | 'RUNESTONE_TAG'
    | 'MKCERT_INSTALLED'
    | 'RUNESTONE_VERSION'
    | 'WEB_ENTRYPOINT_PORT'
    | 'WEB_ENTRYPOINT_NAME'
    | 'WEB_SECURE_ENTRYPOINT_PORT'
    | 'WEB_SECURE_ENTRYPOINT_NAME'
    | 'DNS_ENABLE'
    | 'DNS_HOST_IP'
    | 'DNS_BIND_IP'
    | 'DNS_BIND_PREFIX'
    | 'DNS_UPSTREAM'
    | 'DNS_DAEMON_FALLBACK'
    | 'DNS_AUTO_REORDER'
    | 'DNS_CONTAINER_RESOLVER'
    | 'DNS_UI_ENABLE'
    | 'DNS_UI_USER'
    | 'DNS_UI_PASS'
  >
>;

export const DEFAULT_ENV: Required<EnvInput> = {
  HOST_DOMAIN: 'local.developers-homelab.net',
  PREFIX: 'runestone',
  HTTPS_PORT: '443',
  HTTP_PORT: '80',
  SMTP_PORT: '1025',
  RUNESTONE_IMAGE: 'cymondez/runestone',
  RUNESTONE_TAG: '5.2',
  MKCERT_INSTALLED: 'false',
  RUNESTONE_VERSION: '5',
  WEB_ENTRYPOINT_PORT: '80',
  WEB_ENTRYPOINT_NAME: 'web',
  WEB_SECURE_ENTRYPOINT_PORT: '443',
  WEB_SECURE_ENTRYPOINT_NAME: 'websecure',
  // DNS is off by default and an absent DNS_ENABLE means disabled, so an
  // existing installation behaves exactly as before after an upgrade (spec 13).
  DNS_ENABLE: 'false',
  DNS_HOST_IP: '',
  DNS_BIND_IP: '',
  // Derived from DNS_BIND_IP, never set by hand: the host-address prefix the
  // Compose file puts in front of `53:53`, with its trailing colon, and **empty
  // for all interfaces**.
  //
  // Empty is not the same as writing `0.0.0.0` out. Verified on Windows with
  // Docker Desktop: `-p 53:53/udp` publishes successfully alongside the
  // Internet Connection Sharing service that already holds `0.0.0.0:53/udp`,
  // while `-p 0.0.0.0:53:53/udp` fails with an address-in-use error. WSL2
  // enables that service, so spelling the address out breaks the default
  // Windows installation (spec 6.1).
  DNS_BIND_PREFIX: '',
  // Deliberately empty. The never-empty guarantee of spec 8.4 belongs to
  // determineUpstreams, not to this default: if the loader supplied 1.1.1.1
  // here, that value would look like a choice the user made, and the detection
  // step would never run — which is exactly wrong on a network that only
  // permits its own internal resolvers.
  DNS_UPSTREAM: '',
  DNS_DAEMON_FALLBACK: '',
  DNS_AUTO_REORDER: 'false',
  DNS_CONTAINER_RESOLVER: '',
  DNS_UI_ENABLE: 'true',
  DNS_UI_USER: '',
  DNS_UI_PASS: ''
};

function readEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return dotenv.parse(fs.readFileSync(envPath));
}

export const envLoader = {
  load(cliEnvPath?: string, projectArg?: string): RunestoneEnv {
    const projectDir = pathHelpers.resolveProjectDir(projectArg);
    const envPath = pathHelpers.resolveEnvPath(cliEnvPath, projectDir);
    const envFileExists = fs.existsSync(envPath);
    const parsed = readEnvFile(envPath);
    const merged = { ...DEFAULT_ENV, ...parsed };
    const prefix = merged.PREFIX || DEFAULT_ENV.PREFIX;

    return {
      HOST_DOMAIN: merged.HOST_DOMAIN || DEFAULT_ENV.HOST_DOMAIN,
      PREFIX: prefix,
      HTTPS_PORT: merged.HTTPS_PORT || DEFAULT_ENV.HTTPS_PORT,
      HTTP_PORT: merged.HTTP_PORT || DEFAULT_ENV.HTTP_PORT,
      SMTP_PORT: merged.SMTP_PORT || DEFAULT_ENV.SMTP_PORT,
      RUNESTONE_IMAGE: merged.RUNESTONE_IMAGE || DEFAULT_ENV.RUNESTONE_IMAGE,
      RUNESTONE_TAG: merged.RUNESTONE_TAG || DEFAULT_ENV.RUNESTONE_TAG,
      MKCERT_INSTALLED: merged.MKCERT_INSTALLED || DEFAULT_ENV.MKCERT_INSTALLED,
      RUNESTONE_VERSION: merged.RUNESTONE_VERSION || DEFAULT_ENV.RUNESTONE_VERSION,
      RUNESTONE_LANG: toolState.readLocale() || 'en',
      WEB_ENTRYPOINT_PORT: merged.WEB_ENTRYPOINT_PORT || merged.HTTP_PORT || DEFAULT_ENV.WEB_ENTRYPOINT_PORT,
      WEB_ENTRYPOINT_NAME: merged.WEB_ENTRYPOINT_NAME || DEFAULT_ENV.WEB_ENTRYPOINT_NAME,
      WEB_SECURE_ENTRYPOINT_PORT:
        merged.WEB_SECURE_ENTRYPOINT_PORT || merged.HTTPS_PORT || DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_PORT,
      WEB_SECURE_ENTRYPOINT_NAME: merged.WEB_SECURE_ENTRYPOINT_NAME || DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_NAME,
      DNS_ENABLE: merged.DNS_ENABLE || DEFAULT_ENV.DNS_ENABLE,
      DNS_HOST_IP: merged.DNS_HOST_IP ?? DEFAULT_ENV.DNS_HOST_IP,
      DNS_BIND_IP: merged.DNS_BIND_IP ?? DEFAULT_ENV.DNS_BIND_IP,
      DNS_BIND_PREFIX: merged.DNS_BIND_PREFIX ?? DEFAULT_ENV.DNS_BIND_PREFIX,
      // Empty means "nothing chosen", which is what lets detection run.
      DNS_UPSTREAM: merged.DNS_UPSTREAM ?? DEFAULT_ENV.DNS_UPSTREAM,
      DNS_DAEMON_FALLBACK: merged.DNS_DAEMON_FALLBACK ?? DEFAULT_ENV.DNS_DAEMON_FALLBACK,
      DNS_AUTO_REORDER: merged.DNS_AUTO_REORDER || DEFAULT_ENV.DNS_AUTO_REORDER,
      DNS_CONTAINER_RESOLVER: merged.DNS_CONTAINER_RESOLVER ?? DEFAULT_ENV.DNS_CONTAINER_RESOLVER,
      DNS_UI_ENABLE: merged.DNS_UI_ENABLE || DEFAULT_ENV.DNS_UI_ENABLE,
      DNS_UI_USER: merged.DNS_UI_USER ?? DEFAULT_ENV.DNS_UI_USER,
      DNS_UI_PASS: merged.DNS_UI_PASS ?? DEFAULT_ENV.DNS_UI_PASS,
      PROJECT_DIR: projectDir,
      ENV_PATH: envPath,
      COMPOSE_FILE_PATH: pathHelpers.resolveComposePath(projectArg),
      NETWORK_NAME: `${prefix}-network`,
      SSH_VOLUME_NAME: `${prefix}-ssh`,
      ENV_FILE_EXISTS: envFileExists,
      REQUIRED_VARS_PRESENT: Boolean(parsed.HOST_DOMAIN && parsed.PREFIX)
    };
  },

  write(envPath: string, config: EnvInput): void {
    const dir = path.dirname(envPath);
    fs.mkdirSync(dir, { recursive: true });

    const existing = readEnvFile(envPath);
    const merged = { ...existing, ...config };
    const content = Object.entries(merged)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    fs.writeFileSync(envPath, `${content}\n`, 'utf8');
  },

  exists(envPath: string): boolean {
    return fs.existsSync(path.resolve(envPath));
  },

  hasRequiredVars(config: RunestoneEnv): boolean {
    return config.ENV_FILE_EXISTS && config.REQUIRED_VARS_PRESENT;
  }
};
