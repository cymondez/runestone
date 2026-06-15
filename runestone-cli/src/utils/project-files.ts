import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_ENV, EnvInput, RunestoneEnv, envLoader } from './env-loader';
import { pathHelpers } from './path-helpers';

export function buildComposeFile(): string {
  return `services:
  runestone:
    image: \${RUNESTONE_IMAGE:-cymondez/runstone}:\${RUNESTONE_TAG:-5.2}
    container_name: \${PREFIX:-runestone}
    restart: unless-stopped
    command: |-
      --providers.docker.network="\${PREFIX:-runestone}-network"
    environment:
      HOST_DOMAIN: \${HOST_DOMAIN:-docker.so}
      MAILPIT_HOST: mailpit.\${HOST_DOMAIN:-docker.so}
      TRAEFIK_HOST: traefik.\${HOST_DOMAIN:-docker.so}
      WEB_ENTRYPOINT_NAME: \${WEB_ENTRYPOINT_NAME:-web}
      WEB_ENTRYPOINT_PORT: \${WEB_ENTRYPOINT_PORT:-80}
      WEB_SECURE_ENTRYPOINT_NAME: \${WEB_SECURE_ENTRYPOINT_NAME:-websecure}
      WEB_SECURE_ENTRYPOINT_PORT: \${WEB_SECURE_ENTRYPOINT_PORT:-443}
    ports:
      - "\${WEB_ENTRYPOINT_PORT:-80}:\${WEB_ENTRYPOINT_PORT:-80}"
      - "\${WEB_SECURE_ENTRYPOINT_PORT:-443}:\${WEB_SECURE_ENTRYPOINT_PORT:-443}"
      - "\${SMTP_PORT:-1025}:1025"
    extra_hosts:
      - host.docker.internal:host-gateway
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./certs:/ssl
      - ./configuration:/configuration
      - ssh:/tmp/druid_ssh-agent/

networks:
  default:
    name: \${PREFIX:-runestone}-network
    external: true

volumes:
  ssh:
    name: \${PREFIX:-runestone}-ssh
    external: true
`;
}

export function defaultEnvInput(): EnvInput {
  return { ...DEFAULT_ENV };
}

export function ensureProjectFiles(config: RunestoneEnv, options?: { overwriteCompose?: boolean }): void {
  pathHelpers.ensureDir(config.PROJECT_DIR);
  pathHelpers.ensureDir(path.join(config.PROJECT_DIR, 'certs'));
  pathHelpers.ensureDir(path.join(config.PROJECT_DIR, 'configuration'));

  if (!fs.existsSync(config.ENV_PATH)) {
    envLoader.write(config.ENV_PATH, defaultEnvInput());
  }

  if (options?.overwriteCompose || !fs.existsSync(config.COMPOSE_FILE_PATH)) {
    fs.writeFileSync(config.COMPOSE_FILE_PATH, buildComposeFile(), 'utf8');
  }
}
