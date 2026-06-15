import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { pathHelpers } from './path-helpers';

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
  WEB_ENTRYPOINT_PORT: string;
  WEB_ENTRYPOINT_NAME: string;
  WEB_SECURE_ENTRYPOINT_PORT: string;
  WEB_SECURE_ENTRYPOINT_NAME: string;
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
  >
>;

export const DEFAULT_ENV: Required<EnvInput> = {
  HOST_DOMAIN: 'docker.so',
  PREFIX: 'runestone',
  HTTPS_PORT: '443',
  HTTP_PORT: '80',
  SMTP_PORT: '1025',
  RUNESTONE_IMAGE: 'cymondez/runstone',
  RUNESTONE_TAG: '5.2',
  MKCERT_INSTALLED: 'false',
  RUNESTONE_VERSION: '5',
  WEB_ENTRYPOINT_PORT: '80',
  WEB_ENTRYPOINT_NAME: 'web',
  WEB_SECURE_ENTRYPOINT_PORT: '443',
  WEB_SECURE_ENTRYPOINT_NAME: 'websecure'
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
      WEB_ENTRYPOINT_PORT: merged.WEB_ENTRYPOINT_PORT || merged.HTTP_PORT || DEFAULT_ENV.WEB_ENTRYPOINT_PORT,
      WEB_ENTRYPOINT_NAME: merged.WEB_ENTRYPOINT_NAME || DEFAULT_ENV.WEB_ENTRYPOINT_NAME,
      WEB_SECURE_ENTRYPOINT_PORT:
        merged.WEB_SECURE_ENTRYPOINT_PORT || merged.HTTPS_PORT || DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_PORT,
      WEB_SECURE_ENTRYPOINT_NAME: merged.WEB_SECURE_ENTRYPOINT_NAME || DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_NAME,
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
