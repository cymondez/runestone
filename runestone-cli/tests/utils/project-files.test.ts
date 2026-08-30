import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load } from 'js-yaml';
import { COMPOSE_SERVICES, RUNESTONE_IMAGE } from '../../src/services/docker-compose';
import {
  COMPOSE_TEMPLATE_VERSION,
  buildComposeFile,
  buildDnsCustomConf,
  dnsCustomConfPath,
  ensureProjectFiles,
  readComposeTemplateVersion
} from '../../src/utils/project-files';
import { testEnv } from '../helpers/env';

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
  dns?: string[];
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  networks: Record<string, { name?: string; external?: boolean }>;
  volumes: Record<string, { name?: string; external?: boolean }>;
}

function parseCompose(text = buildComposeFile()): ComposeFile {
  return load(text) as ComposeFile;
}

describe('generated compose file', () => {
  it('is valid YAML', () => {
    expect(() => parseCompose()).not.toThrow();
  });

  it('carries the template version in its own header', () => {
    expect(readComposeTemplateVersion(buildComposeFile())).toBe(COMPOSE_TEMPLATE_VERSION);
    expect(readComposeTemplateVersion('services:\n  runestone: {}\n')).toBe('');
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

    expect(runestone.image).toBe(RUNESTONE_IMAGE);
    expect(runestone.container_name).toBe('${PREFIX:-runestone}');
    expect(runestone.restart).toBe('unless-stopped');
    expect(runestone.extra_hosts).toEqual(['host.docker.internal:host-gateway']);
  });

  it('writes both images literally, so no `.env` can decide which one runs', () => {
    const services = parseCompose().services;

    // The point of the change, not a restatement of the values: a `${...}` here
    // is substituted from `.env` as well as from the environment, so leaving one
    // in would let an installation created years ago pin a new CLI to an old
    // image. Asserting the absence is what stops it coming back.
    for (const name of [COMPOSE_SERVICES.runestone, COMPOSE_SERVICES.dns]) {
      expect(services[name].image).not.toContain('${');
    }
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

  describe('the dns service (spec 8.2)', () => {
    const dns = () => parseCompose().services.dns;

    it('sits behind the dns profile, so an ordinary up never starts it', () => {
      expect(dns().profiles).toEqual(['dns']);
    });

    it('pins the image and tag literally, so no environment variable can redirect it', () => {
      expect(dns().image).toBe('cymondez/runestone-dns:1.0');
      expect(dns().image).not.toContain('$');
    });

    it('publishes port 53 for both protocols through the derived bind prefix', () => {
      // The prefix, not DNS_BIND_IP itself. An all-interfaces bind must publish
      // `53:53/udp` and never `0.0.0.0:53:53/udp`: on Windows with Docker
      // Desktop the first succeeds alongside the Internet Connection Sharing
      // service that already holds `0.0.0.0:53/udp`, and the second does not
      // (spec 6.1).
      expect(dns().ports).toEqual(['${DNS_BIND_PREFIX:-}53:53/tcp', '${DNS_BIND_PREFIX:-}53:53/udp']);
    });

    it('restarts unless stopped, so a host reboot brings DNS back without the CLI', () => {
      expect(dns().restart).toBe('unless-stopped');
      expect(dns().container_name).toBe('${PREFIX:-runestone}-dns');
    });

    it('passes the target IP, the upstreams and the UI credentials to the entrypoint', () => {
      expect(dns().environment).toEqual({
        DNS_HOST_IP: '${DNS_HOST_IP:-}',
        DNS_UPSTREAM: '${DNS_UPSTREAM:-1.1.1.1}',
        HTTP_USER: '${DNS_UI_USER:-}',
        HTTP_PASS: '${DNS_UI_PASS:-}'
      });
    });

    it('sets its own resolver explicitly, so the daemon setting cannot point it at itself', () => {
      expect(dns().dns).toEqual(['${DNS_CONTAINER_RESOLVER:-1.1.1.1}']);
    });

    it('mounts the certificates read-only and the user rules writable', () => {
      expect(dns().volumes).toEqual(['./certs:/ssl:ro', './dns/custom.conf:/etc/dnsmasq.d/custom.conf']);
    });
  });
});

describe('ensureProjectFiles', () => {
  let projectDir: string;

  function config() {
    return testEnv(projectDir);
  }

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-project-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates the directories the dns service needs', () => {
    ensureProjectFiles(config());

    expect(fs.existsSync(path.join(projectDir, 'dns'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'certs'))).toBe(true);
  });

  it('creates custom.conf, because Docker would otherwise bind-mount a directory', () => {
    ensureProjectFiles(config());

    expect(fs.readFileSync(dnsCustomConfPath(projectDir), 'utf8')).toBe(buildDnsCustomConf());
  });

  it('never overwrites custom.conf', () => {
    ensureProjectFiles(config());
    fs.writeFileSync(dnsCustomConfPath(projectDir), 'address=/mine.test/127.0.0.1\n', 'utf8');

    ensureProjectFiles(config());

    expect(fs.readFileSync(dnsCustomConfPath(projectDir), 'utf8')).toBe('address=/mine.test/127.0.0.1\n');
  });

  it('writes the compose file when it is absent', () => {
    const update = ensureProjectFiles(config());

    expect(update).toEqual({ written: true, fromVersion: '', toVersion: COMPOSE_TEMPLATE_VERSION });
    expect(fs.readFileSync(config().COMPOSE_FILE_PATH, 'utf8')).toBe(buildComposeFile());
  });

  it('leaves a current compose file completely alone', () => {
    ensureProjectFiles(config());
    const before = fs.statSync(config().COMPOSE_FILE_PATH).mtimeMs;

    const update = ensureProjectFiles(config());

    expect(update.written).toBe(false);
    expect(update.backupPath).toBeUndefined();
    expect(fs.statSync(config().COMPOSE_FILE_PATH).mtimeMs).toBe(before);
  });

  it('regenerates a file that predates versioning, keeping the old one', () => {
    // What an installation from before the marker existed looks like.
    fs.writeFileSync(config().COMPOSE_FILE_PATH, 'services:\n  runestone:\n    image: old\n', 'utf8');

    const update = ensureProjectFiles(config());

    expect(update.written).toBe(true);
    expect(update.fromVersion).toBe('');
    expect(update.toVersion).toBe(COMPOSE_TEMPLATE_VERSION);
    expect(update.backupPath).toBe(`${config().COMPOSE_FILE_PATH}.bak`);
    expect(fs.readFileSync(update.backupPath as string, 'utf8')).toContain('image: old');
    expect(fs.readFileSync(config().COMPOSE_FILE_PATH, 'utf8')).toBe(buildComposeFile());
  });

  it('never overwrites an existing backup', () => {
    fs.writeFileSync(config().COMPOSE_FILE_PATH, 'services:\n  runestone:\n    image: first\n', 'utf8');
    ensureProjectFiles(config());
    fs.writeFileSync(config().COMPOSE_FILE_PATH, 'services:\n  runestone:\n    image: second\n', 'utf8');

    const update = ensureProjectFiles(config());

    expect(update.backupPath).toBe(`${config().COMPOSE_FILE_PATH}.bak2`);
    expect(fs.readFileSync(`${config().COMPOSE_FILE_PATH}.bak`, 'utf8')).toContain('image: first');
    expect(fs.readFileSync(`${config().COMPOSE_FILE_PATH}.bak2`, 'utf8')).toContain('image: second');
  });

  it('does not write a backup when the stale file happens to be identical', () => {
    // Same bytes, marker stripped: there is nothing of the user's to preserve.
    fs.writeFileSync(config().COMPOSE_FILE_PATH, buildComposeFile(), 'utf8');
    fs.writeFileSync(
      config().COMPOSE_FILE_PATH,
      buildComposeFile().replace(`# runestone-compose-template: ${COMPOSE_TEMPLATE_VERSION}`, '# other'),
      'utf8'
    );

    const update = ensureProjectFiles(config());

    expect(update.written).toBe(true);
    expect(update.backupPath).toBe(`${config().COMPOSE_FILE_PATH}.bak`);
  });

  it('regenerates on request even when the version matches', () => {
    ensureProjectFiles(config());
    fs.writeFileSync(config().COMPOSE_FILE_PATH, 'services: {}\n', 'utf8');

    const update = ensureProjectFiles(config(), { overwriteCompose: true });

    expect(update.written).toBe(true);
    expect(fs.readFileSync(config().COMPOSE_FILE_PATH, 'utf8')).toBe(buildComposeFile());
  });

  it('leaves an existing .env untouched, comments and all', () => {
    const envText = '# my notes\nHOST_DOMAIN=example.test\n';
    fs.writeFileSync(config().ENV_PATH, envText, 'utf8');

    ensureProjectFiles(config());

    expect(fs.readFileSync(config().ENV_PATH, 'utf8')).toBe(envText);
  });
});
