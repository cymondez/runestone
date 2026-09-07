import * as fs from 'fs';
import * as path from 'path';
import { CertificateListItem } from '../../../src/services/cert-manager';
import { ServiceListItem } from '../../../src/services/service-manager';
import {
  AgentContextDependencies,
  AgentContextSnapshot,
  buildOfflineSnapshot
} from '../../../src/services/agent-context/snapshot';
import {
  renderDnsState,
  renderDomains,
  renderRuntime,
  renderUsedNames,
  renderWarnings
} from '../../../src/services/agent-context/render';
import * as spawnModule from '../../../src/utils/spawn';
import { testEnv } from '../../helpers/env';

const runestoneDir = path.join('/tmp', 'runestone-agent-context');

function config(overrides = {}) {
  return testEnv(runestoneDir, { HOST_DOMAIN: 'example.test', PREFIX: 'mylab', ...overrides });
}

function certificate(overrides: Partial<CertificateListItem> = {}): CertificateListItem {
  return {
    status: '✓',
    sans: ['*.example.test'],
    issuer: 'mkcert development CA',
    validUntil: '2028-11-26',
    expiry: '811d',
    certFile: 'example.test.crt',
    keyFile: 'example.test.key',
    dynamicConfigFile: 'example.test.yml',
    ...overrides
  };
}

function service(overrides: Partial<ServiceListItem> = {}): ServiceListItem {
  return {
    group: null,
    name: 'api',
    route: 'api.example.test',
    url: 'http://host.docker.internal:3000',
    dynamicConfigExists: true,
    ...overrides
  };
}

function deps(
  certificates: CertificateListItem[],
  services: ServiceListItem[]
): Partial<AgentContextDependencies> {
  return {
    listCertificates: () => certificates,
    listServices: () => services,
    now: () => new Date('2026-09-07T00:00:00.000Z')
  };
}

describe('the offline snapshot', () => {
  it('spawns no process', () => {
    // The offline tier is on the hot path of every agent prompt, so it must not
    // wait on a cold Docker daemon. buildDnsStatusReport looks like the obvious
    // source for DNS state and is NOT offline: its defaults reach `docker info`
    // and `docker compose ps`. This asserts the snapshot never went that way.
    const spawnSpy = jest.spyOn(spawnModule, 'spawnCommand');

    buildOfflineSnapshot(config(), deps([certificate()], [service()]));

    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('writes nothing to stdout or stderr', () => {
    // `docs --ai-context` asserts an empty stderr, which is what makes its
    // stdout safe to pipe into a prompt.
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    buildOfflineSnapshot(config(), deps([certificate()], [service()]));

    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    out.mockRestore();
    err.mockRestore();
  });

  it('survives a JSON round trip unchanged', () => {
    // The contract a future --json would publish. Catches a Date, an undefined,
    // a class instance or a Set slipping into the shape.
    const snapshot = buildOfflineSnapshot(config(), deps([certificate()], [service()]));

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.schemaVersion).toBe(1);
  });

  it('carries no display glyph and no escape sequence in any string', () => {
    // CertificateListItem.status is typed '✓' | '✗'. Passing it through would
    // ship a Unicode glyph as an enum value the first time --json exists.
    const snapshot = buildOfflineSnapshot(
      config(),
      deps([certificate(), certificate({ status: '✗', error: 'unreadable' })], [service()])
    );

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('✓');
    expect(serialized).not.toContain('✗');
    expect(serialized).not.toContain(String.fromCharCode(27));
    expect(snapshot.certificates[0].valid).toBe(true);
    expect(snapshot.certificates[1].valid).toBe(false);
  });

  it('reports an invalid certificate without letting it cover a hostname', () => {
    // An expired certificate that still contributed coverage would send an
    // agent to a hostname the browser refuses.
    const snapshot = buildOfflineSnapshot(
      config(),
      deps([certificate({ status: '✗', sans: ['*.broken.test'], error: 'expired' })], [])
    );

    expect(snapshot.certificates).toHaveLength(1);
    expect(snapshot.certificates[0].error).toBe('expired');
    expect(snapshot.domains.wildcards).toEqual([]);
    expect(snapshot.domains.covered).toEqual([]);
    expect(renderDomains(snapshot)).toContain('expired or unreadable');
  });

  it('separates wildcard coverage from individual names', () => {
    const snapshot = buildOfflineSnapshot(
      config(),
      deps([certificate({ sans: ['*.example.test', 'plain.example.test'] })], [])
    );

    expect(snapshot.domains.wildcards).toEqual(['*.example.test']);
    expect(snapshot.domains.covered).toEqual(['plain.example.test']);
    expect(renderDomains(snapshot)).toContain('covers exactly one label');
  });

  it('treats a missing certificate directory as empty rather than as a failure', () => {
    // listDomainCertificates already returns [] when certs/ is absent, so this
    // is the ordinary state of a machine where nothing has been created yet.
    const snapshot = buildOfflineSnapshot(config(), deps([], []));

    expect(snapshot.certificates).toEqual([]);
    expect(snapshot.warnings.join(' ')).toContain('No certificates have been created yet');
    expect(renderDomains(snapshot)).toContain('runestone certs create example.test');
  });

  it('surfaces a certificate read that throws, rather than reporting no certificates', () => {
    const snapshot = buildOfflineSnapshot(config(), {
      ...deps([], []),
      listCertificates: () => {
        throw new Error('permission denied');
      }
    });

    expect(snapshot.warnings[0]).toContain('could not be read');
    expect(snapshot.warnings[0]).toContain('permission denied');
  });

  it('does not warn about an empty service list, which is normal', () => {
    const snapshot = buildOfflineSnapshot(config(), deps([certificate()], []));

    expect(snapshot.services).toEqual([]);
    expect(snapshot.warnings.join(' ')).not.toContain('routed service');
    expect(renderUsedNames(snapshot)).toContain('No routed services are registered');
  });

  it('collects the names and routes an agent must not collide with', () => {
    const snapshot = buildOfflineSnapshot(
      config(),
      deps([certificate()], [service({ name: 'web', route: 'web.example.test' }), service()])
    );

    expect(snapshot.usedNames.serviceNames).toEqual(['api', 'web']);
    expect(snapshot.usedNames.routes).toEqual(['api.example.test', 'web.example.test']);
    expect(renderUsedNames(snapshot)).toContain('api, web');
  });

  it('marks a route with no covering certificate and says the browser will warn', () => {
    const snapshot = buildOfflineSnapshot(
      config(),
      deps([certificate({ sans: ['*.other.test'] })], [service()])
    );

    expect(snapshot.services[0].certificateCovered).toBe(false);
    expect(snapshot.warnings.join(' ')).toContain('the browser will warn');
  });

  it('flags a registered service whose dynamic configuration is missing', () => {
    const snapshot = buildOfflineSnapshot(
      config(),
      deps([certificate()], [service({ dynamicConfigExists: false })])
    );

    expect(snapshot.warnings.join(' ')).toContain('runestone service repair');
  });

  it('reads DNS state from .env rather than from the DNS status report', () => {
    expect(buildOfflineSnapshot(config({ DNS_ENABLE: 'true' }), deps([], [])).dns.enabled).toBe(true);
    expect(buildOfflineSnapshot(config({ DNS_ENABLE: 'false' }), deps([], [])).dns.enabled).toBe(false);
  });

  it('reports online facts as not-checked rather than as absent', () => {
    // "I did not look" and "there is nothing there" are different answers, and
    // conflating them is how an agent concludes a name is free.
    const snapshot = buildOfflineSnapshot(config(), deps([], []));

    expect(snapshot.containers.ok).toBe(false);
    expect(snapshot.traefik.ok).toBe(false);
    expect(snapshot.probeMode).toBe('offline');
    expect(renderUsedNames(snapshot)).toContain('were not checked');
    expect(renderRuntime(snapshot)).toContain('was not checked');
  });
});

describe('the block renderers', () => {
  const snapshot = (): AgentContextSnapshot => buildOfflineSnapshot(config(), deps([certificate()], [service()]));

  it('never renders an empty block', () => {
    for (const render of [renderDomains, renderUsedNames, renderRuntime, renderWarnings, renderDnsState]) {
      expect(render(snapshot()).trim().length).toBeGreaterThan(0);
    }
  });

  it('tells the agent not to enable container DNS itself', () => {
    const text = renderDnsState(buildOfflineSnapshot(config({ DNS_ENABLE: 'false' }), deps([], [])));

    expect(text).toContain('do not run');
    expect(text).toContain('runestone dns enable');
  });

  it('says nothing to flag when there is nothing to flag', () => {
    expect(renderWarnings(snapshot())).toBe('Nothing to flag.');
  });
});

describe('the snapshot module is not wired up yet', () => {
  it('is imported by nothing under src/', () => {
    // A2 is a risk-0 milestone: the module exists and no command path reaches
    // it, so it reverts with a single commit and cannot change any behaviour.
    const srcDir = path.resolve(__dirname, '..', '..', '..', 'src');

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });

    const importers = walk(srcDir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.includes(`${path.sep}agent-context${path.sep}`))
      // Match an import specifier, not any mention of the name — a comment
      // elsewhere that refers to this module is not a dependency on it.
      .filter((file) => /(?:from|require\()\s*'[^']*agent-context[^']*'/.test(fs.readFileSync(file, 'utf8')));

    expect(importers).toEqual([]);
  });
});
