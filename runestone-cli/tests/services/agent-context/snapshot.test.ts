import * as fs from 'fs';
import * as path from 'path';
import { CertificateListItem } from '../../../src/services/cert-manager';
import { ServiceListItem } from '../../../src/services/service-manager';
import {
  AgentContextDependencies,
  AgentContextSnapshot,
  CONTAINER_PROBE_TIMEOUT_MS,
  buildLiveSnapshot,
  buildOfflineSnapshot
} from '../../../src/services/agent-context/snapshot';
import {
  renderDnsState,
  renderDomains,
  renderRuntime,
  renderUsedNames,
  renderWarnings
} from '../../../src/services/agent-context/render';
import { composeService } from '../../../src/services/docker-compose';
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

describe('the live snapshot', () => {
  const containers = [{ Id: '1', Name: 'runestone', State: 'running', Status: 'Up 1 hour', Service: 'runestone' }];
  const traefik = {
    routers: [{ name: 'mine@file', rule: 'Host(`api.example.test`)' }, { name: 'other@docker' }],
    services: [{ name: 'mine@file' }]
  };

  function liveDeps(overrides: Partial<AgentContextDependencies> = {}): Partial<AgentContextDependencies> {
    return {
      ...deps([certificate()], [service()]),
      listContainers: () => containers,
      readTraefik: async () => traefik,
      ...overrides
    };
  }

  it('reports names registered by other projects, which is why this tier exists', async () => {
    // A router ID is global to Traefik, so a name free in this project's own
    // service list can already be taken by a project the agent cannot see.
    const snapshot = await buildLiveSnapshot(config(), liveDeps());

    expect(snapshot.probeMode).toBe('live');
    expect(snapshot.traefik.ok).toBe(true);
    expect(renderUsedNames(snapshot)).toContain('other@docker');
  });

  it('normalises an absent Traefik rule to null so the shape survives JSON', async () => {
    // TraefikNamedResource.rule is optional, and an absent key vanishes
    // through JSON.stringify, which would make the published shape unstable.
    const snapshot = await buildLiveSnapshot(config(), liveDeps());

    expect(snapshot.traefik.ok).toBe(true);
    if (snapshot.traefik.ok) {
      expect(snapshot.traefik.value.routers[1].rule).toBeNull();
    }
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('still succeeds, and says why, when Docker cannot be reached', async () => {
    const snapshot = await buildLiveSnapshot(
      config(),
      liveDeps({
        listContainers: () => {
          throw new Error('Cannot connect to the Docker daemon');
        }
      })
    );

    expect(snapshot.containers.ok).toBe(false);
    expect(snapshot.warnings.join(' ')).toContain('Cannot connect to the Docker daemon');
    // The distinction that matters: unavailable, not skipped, so the renderer
    // says "could not be reached" rather than "was not checked".
    expect(renderRuntime(snapshot)).toContain('Docker could not be reached');
    expect(renderRuntime(snapshot)).toContain('runestone up');
  });

  it('still succeeds, and refuses to imply a name is free, when Traefik cannot be reached', async () => {
    const snapshot = await buildLiveSnapshot(
      config(),
      liveDeps({
        readTraefik: async () => {
          throw new Error('socket hang up');
        }
      })
    );

    expect(snapshot.traefik.ok).toBe(false);
    expect(snapshot.warnings.join(' ')).toContain('could not be checked');
    const text = renderUsedNames(snapshot);
    expect(text).toContain('unknown');
    expect(text).toContain('unverified rather than free');
  });

  it('survives both probes failing at once', async () => {
    const snapshot = await buildLiveSnapshot(
      config(),
      liveDeps({
        listContainers: () => {
          throw new Error('docker down');
        },
        readTraefik: async () => {
          throw new Error('traefik down');
        }
      })
    );

    expect(snapshot.probeMode).toBe('live');
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('bounds the container probe well below the thirty seconds ps defaults to', () => {
    // Asserted at the call site by inspecting the argument, not by measuring
    // wall-clock time, which would make the test slow and flaky.
    const psSpy = jest.spyOn(composeService, 'ps').mockReturnValue(containers);

    return buildLiveSnapshot(config(), { ...deps([], []), readTraefik: async () => traefik }).then(() => {
      expect(psSpy).toHaveBeenCalledWith(expect.any(String), CONTAINER_PROBE_TIMEOUT_MS);
      expect(CONTAINER_PROBE_TIMEOUT_MS).toBeLessThan(30000);
      psSpy.mockRestore();
    });
  });

  it('does not reach for the DNS status report, which is not offline and is not needed', () => {
    // Spec 6.1 listed buildDnsStatusReport in the online tier. It is not used:
    // it spawns `docker info` AND a second `docker compose ps`, and the only
    // fact it adds over .env is whether the daemon entry is actually in
    // effect — which `runestone dns status` exists to answer and which the
    // troubleshoot topic already points the agent at. A third spawn for that
    // is a bad trade on a path an agent calls repeatedly.
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'services', 'agent-context', 'snapshot.ts'),
      'utf8'
    );

    expect(source).not.toContain('buildDnsStatusReport');
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

describe('who is allowed to reach the snapshot module', () => {
  it('is imported only from the command paths that are meant to have it', () => {
    // A2 asserted that nothing imported this module, which was true of that
    // milestone and is deliberately false from A3 onward. A milestone property
    // does not belong in a permanent test, so the assertion became this one:
    // an allowlist.
    //
    // It earns its place because the module is cheap to import and tempting to
    // reuse. Reaching it from `up` or `setup` would put certificate and service
    // reads on a path run several times a day, and — once the online tier
    // exists — a Docker probe with it. Adding a consumer should be a decision,
    // which means seeing this list change in a diff.
    const allowed = [
      path.join('src', 'commands', 'docs.ts'),
      // Renders the corpus for installation. It uses the offline builder only:
      // an installed file outlives the moment it was written, so a live fact
      // baked into one would be a lie within minutes.
      path.join('src', 'commands', 'skill.ts'),
      // The MCP tools answer questions about right now, so unlike the
      // installer they may — and for collision checking must — use the live
      // builder. The answer is consumed immediately and never written down.
      path.join('src', 'services', 'mcp', 'server.ts'),
      path.join('src', 'services', 'mcp', 'tools.ts')
    ];

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
      .filter((file) => /(?:from|require\()\s*'[^']*agent-context[^']*'/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(path.resolve(srcDir, '..'), file))
      .sort();

    expect(importers).toEqual(allowed.sort());
  });

  it('does not let the installer reach the live builder', () => {
    // The comment in the allowlist above is a claim; this is the assertion.
    // An installed file carries offline scalars and tells the agent to run the
    // state topic for anything live, which is the whole reason to install a
    // skill rather than paste a blob of context.
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', 'src', 'commands', 'skill.ts'),
      'utf8'
    );

    expect(source).toContain('buildOfflineSnapshot');
    expect(source).not.toContain('buildLiveSnapshot');
  });
});
