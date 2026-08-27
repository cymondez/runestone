import { load } from 'js-yaml';
import { COMPOSE_SERVICES } from '../../src/services/docker-compose';
import { buildComposeFile } from '../../src/utils/project-files';

/**
 * The Compose file is embedded in the CLI and generated, not shipped as a static
 * file — which is the right call, because the DNS feature has to add a service,
 * a profile and port bindings conditionally. The cost of generating YAML from a
 * template literal is that a mis-indented line is invisible until
 * `docker compose` rejects it on a user's machine, so the generated document is
 * parsed here rather than pattern-matched.
 */

interface ComposeService {
  image?: string;
  container_name?: string;
  restart?: string;
  command?: string;
  environment?: Record<string, string>;
  ports?: string[];
  extra_hosts?: string[];
  volumes?: string[];
  profiles?: string[];
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  networks: Record<string, { name?: string; external?: boolean }>;
  volumes: Record<string, { name?: string; external?: boolean }>;
}

function parseCompose(): ComposeFile {
  return load(buildComposeFile()) as ComposeFile;
}

describe('generated compose file', () => {
  it('is valid YAML', () => {
    expect(() => parseCompose()).not.toThrow();
  });

  it('declares a service for every name the CLI scopes commands to', () => {
    // A scoped `docker compose restart <service>` fails outright if the name is
    // not in the file, so the constant and the template must not drift apart.
    const compose = parseCompose();

    for (const service of Object.values(COMPOSE_SERVICES)) {
      expect(Object.keys(compose.services)).toContain(service);
    }
  });

  it('describes the runestone service the way the CLI expects', () => {
    const runestone = parseCompose().services[COMPOSE_SERVICES.runestone];

    expect(runestone.image).toBe('${RUNESTONE_IMAGE:-cymondez/runestone}:${RUNESTONE_TAG:-5.2}');
    expect(runestone.container_name).toBe('${PREFIX:-runestone}');
    expect(runestone.restart).toBe('unless-stopped');
    expect(runestone.extra_hosts).toEqual(['host.docker.internal:host-gateway']);
  });

  it('publishes the web, secure web and SMTP ports', () => {
    const ports = parseCompose().services[COMPOSE_SERVICES.runestone].ports ?? [];

    expect(ports).toEqual([
      '${WEB_ENTRYPOINT_PORT:-80}:${WEB_ENTRYPOINT_PORT:-80}',
      '${WEB_SECURE_ENTRYPOINT_PORT:-443}:${WEB_SECURE_ENTRYPOINT_PORT:-443}',
      '${SMTP_PORT:-1025}:1025'
    ]);
  });

  it('mounts the docker socket, the certificates and the dynamic configuration', () => {
    const volumes = parseCompose().services[COMPOSE_SERVICES.runestone].volumes ?? [];

    expect(volumes).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(volumes).toContain('./certs:/ssl');
    expect(volumes).toContain('./configuration:/configuration');
  });

  it('passes the host domain through to the container', () => {
    const environment = parseCompose().services[COMPOSE_SERVICES.runestone].environment ?? {};

    expect(environment.HOST_DOMAIN).toBe('${HOST_DOMAIN:-local.developers-homelab.net}');
    expect(environment.PREFIX).toBe('${PREFIX:-runestone}');
  });

  it('joins the externally created prefixed network', () => {
    const network = parseCompose().networks.default;

    expect(network).toEqual({ name: '${PREFIX:-runestone}-network', external: true });
  });

  it('uses the externally created ssh volume', () => {
    expect(parseCompose().volumes.ssh).toEqual({ name: '${PREFIX:-runestone}-ssh', external: true });
  });
});
