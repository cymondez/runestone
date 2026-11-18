import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  DEFAULT_TOPIC,
  GUIDE_TOPIC,
  GUIDE_TOPIC_ORDER,
  compositeTopicOrder,
  selectableTopicIds,
  TOPICS,
  TemplateError,
  UnknownTopicError,
  findTopic,
  installedFactPointers,
  renderAiContext,
  renderAiContextSequence,
  renderAiPromptContext,
  topicIds
} from '../../src/utils/tool-docs';
import { listTopicAssets } from '../../src/utils/tool-docs/assets';
import { substitute } from '../../src/utils/tool-docs/render';
import {
  normalizeRouteDomain,
  normalizeServiceUrl,
  validateServiceName
} from '../../src/services/service-manager';
import { testEnv } from '../helpers/env';

const packageRoot = path.resolve(__dirname, '..', '..');

function config() {
  return testEnv('/tmp/runestone-test', {
    HOST_DOMAIN: 'example.test',
    PREFIX: 'mylab',
    NETWORK_NAME: 'mylab-network',
    WEB_ENTRYPOINT_NAME: 'plain',
    WEB_SECURE_ENTRYPOINT_NAME: 'secure'
  });
}

/**
 * The fact blocks, stubbed. This suite is about the renderer and the corpus, so
 * it must not depend on the snapshot module; a distinctive value also makes it
 * obvious in a failure whether a block expanded at all.
 */
function stubBlocks() {
  return {
    DOMAINS: () => '- STUB_DOMAINS',
    USED_NAMES: () => '- STUB_USED_NAMES',
    RUNTIME: () => '- STUB_RUNTIME',
    WARNINGS: () => '- STUB_WARNINGS',
    DNS_STATE: () => '- STUB_DNS_STATE',
    RESOURCES: () => '- STUB_RESOURCES'
  };
}

describe('tool-docs renderer', () => {
  it('gives a compose override that keeps the service on its own network', () => {
    // This replaced a byte-for-byte prefix check against the pre-A1 brief. That
    // check was a milestone property: it proved the refactor changed nothing,
    // and this change has to change the brief, because one of its sentences was
    // wrong. "Attach the exposed service to the runestone network", with a
    // snippet listing only that network, drops the implicit default network
    // once followed in an override, and the service loses its database.
    // Measured with docker compose config on 2026-10-14: networks listed as
    // [runestone] leave only runestone; [default, runestone] keep both.
    const rendered = renderAiContext('compose', config(), stubBlocks());
    const block = /```yaml\n([\s\S]*?)```/.exec(rendered);
    expect(block).not.toBeNull();

    const override = yaml.load((block as RegExpExecArray)[1]) as {
      services: Record<string, { networks: string[]; labels: string[] }>;
      networks: Record<string, { external: boolean; name: string }>;
    };
    const service = override.services['<compose-service>'];

    expect(service.networks).toEqual(['default', 'runestone']);
    expect(service.labels).toHaveLength(7);
    expect(service.labels).toContain('traefik.enable=true');
    expect(service.labels).toContain('traefik.http.routers.<router-id>.entrypoints=secure');
    expect(service.labels).toContain('traefik.docker.network=mylab-network');
    expect(override.networks.runestone).toEqual({ external: true, name: 'mylab-network' });
  });

  it('does not offer an HTTP router, because HTTP already redirects to HTTPS', () => {
    const rendered = renderAiContext('compose', config(), stubBlocks());

    expect(rendered).not.toContain('Optional HTTP entrypoint');
    expect(rendered).toContain('HTTP entrypoint `plain` already redirects every request to HTTPS');
  });

  it('renders the corpus with LF endings, whoever checked it out', () => {
    // The fixture comparison above is line-ending agnostic: it would pass with
    // both sides CRLF just as happily. That is not good enough, because the
    // corpus ships in the npm tarball and `core.autocrlf=true` on Windows
    // would otherwise publish CRLF assets while a Linux checkout published LF
    // — one byte per line of difference in what an agent receives, decided by
    // who ran `npm publish`. .gitattributes pins these paths to LF; this is
    // the assertion that notices if that pin is ever removed.
    const cr = String.fromCharCode(13);

    for (const topic of TOPICS) {
      expect(renderAiContext(topic.id, config(), stubBlocks())).not.toContain(cr);
    }
  });

  it('keeps renderAiPromptContext meaning the compose topic', () => {
    expect(renderAiPromptContext(config(), stubBlocks())).toBe(renderAiContext(DEFAULT_TOPIC, config(), stubBlocks()));
    expect(DEFAULT_TOPIC).toBe('compose');
  });

  it('substitutes a value containing regex replacement patterns literally', () => {
    // String.prototype.replace treats $&, $1, $' and $$ in a replacement
    // *string* as patterns. The predecessor of this module passed values as
    // replacement strings, which was harmless for the four env scalars and
    // would not have been once a URL or a certificate SAN was substituted.
    const awkward = "http://host/$&-$1-$'-$$-end";

    expect(substitute('{{URL}}', { URL: awkward })).toBe(awkward);
  });

  it('substitutes every occurrence of a placeholder', () => {
    expect(substitute('{{A}} {{B}} {{A}}', { A: 'x', B: 'y' })).toBe('x y x');
  });

  it('throws and names the placeholder when it is unknown', () => {
    expect(() => substitute('a {{NOPE}} b', {})).toThrow(TemplateError);
    expect(() => substitute('a {{NOPE}} b', {})).toThrow(/NOPE/);
  });

  it('throws and names the block when it is unknown', () => {
    expect(() => substitute('{{BLOCK:NOPE}}', {})).toThrow(/NOPE/);
  });

  it('expands a block that sits alone on its line', () => {
    expect(substitute('before\n{{BLOCK:B}}\nafter', {}, { B: () => 'x\ny' })).toBe('before\nx\ny\nafter');
  });

  it('refuses a block placeholder that is not alone on its line', () => {
    // Left alone this would reach the agent as literal text, so it is an error
    // rather than a passthrough.
    expect(() => substitute('text {{BLOCK:B}} more', {}, { B: () => 'x' })).toThrow(TemplateError);
  });

  it('leaves no unexpanded placeholder in any shipped topic', () => {
    for (const topic of TOPICS) {
      const rendered = renderAiContext(topic.id, config(), stubBlocks());
      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('${RUNESTONE_');
      expect(rendered.trim().length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown topic', () => {
    expect(() => renderAiContext('nope', config(), stubBlocks())).toThrow(UnknownTopicError);
  });

  it('keeps the manifest and the asset directory in bijection', () => {
    expect(listTopicAssets().sort()).toEqual(topicIds().sort());
  });

  it('gives every topic a summary and a brief', () => {
    for (const topic of TOPICS) {
      expect(topic.summary.trim().length).toBeGreaterThan(0);
      expect(topic.brief.trim().length).toBeGreaterThan(0);
      // The brief goes into the user's instruction file, which is always in
      // context. Three lines is the budget (spec 8.4).
      expect(topic.brief.split('\n').length).toBeLessThanOrEqual(3);
    }
  });

  it('generates the topic index from the manifest', () => {
    const rendered = renderAiContext('overview', config(), stubBlocks());
    for (const topic of TOPICS) {
      expect(rendered).toContain(`runestone docs --ai-context ${topic.id}`);
      expect(rendered).toContain(topic.summary);
    }
  });

  it('does not leave the superseded single-file renderer in place', () => {
    // Node and TypeScript both resolve ./tool-docs to the .ts file before the
    // directory, so leaving both would keep the old renderer silently live.
    expect(fs.existsSync(path.join(packageRoot, 'src', 'utils', 'tool-docs.ts'))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, 'tool-docs', 'ai-prompt-context.tmp.md'))).toBe(false);
  });
});

describe('the service topic states the rules the validators actually enforce', () => {
  // Spec 5.2: the corpus is executed as instructions by something that does
  // not push back, so every rule it states is fed through the real validator
  // here. Prose and the message catalogue are not acceptable sources — the
  // repository already contains service.validation.urlNoPath, which describes
  // a rule with no call site anywhere in the package.
  const topic = fs.readFileSync(
    path.join(packageRoot, 'tool-docs', 'ai-context', 'service.md'),
    'utf8'
  );

  it('quotes the service-name pattern that validateServiceName applies', () => {
    expect(topic).toContain('^[a-z0-9][a-z0-9-]*$');

    expect(validateServiceName('web-api')).toBe('web-api');
    expect(validateServiceName('a1')).toBe('a1');
    expect(() => validateServiceName('-web')).toThrow();
    expect(() => validateServiceName('Web')).toThrow();
    expect(() => validateServiceName('web api')).toThrow();
  });

  it('is right that a route domain rejects a scheme, a port and a path', () => {
    expect(normalizeRouteDomain('API.example.test', 'example.test')).toBe('api.example.test');
    expect(() => normalizeRouteDomain('http://api.example.test', 'example.test')).toThrow();
    expect(() => normalizeRouteDomain('api.example.test:8080', 'example.test')).toThrow();
    expect(() => normalizeRouteDomain('api.example.test/path', 'example.test')).toThrow();
  });

  it('is right that a service URL accepts a path and a query', () => {
    // This is the claim most likely to be got wrong, because an unused message
    // in the catalogue asserts the opposite.
    expect(normalizeServiceUrl('http://host.docker.internal:3000/api?v=1'))
      .toBe('http://host.docker.internal:3000/api?v=1');
    expect(normalizeServiceUrl('http://host.docker.internal:3000/')).toBe('http://host.docker.internal:3000');
    expect(() => normalizeServiceUrl('ftp://host:21')).toThrow();
    expect(() => normalizeServiceUrl('host:3000')).toThrow();
  });

  it('offers at least one concrete example whose arguments pass the validators', () => {
    // The topic carries a syntax line using <placeholders> as well as runnable
    // examples. Only the runnable ones are claims about what the validators
    // accept, so the syntax line is excluded rather than special-cased.
    const examples = [...topic.matchAll(/runestone service add (\S+) --route (\S+) --url (\S+)/g)]
      .filter(([, name]) => !name.startsWith('<'));

    expect(examples.length).toBeGreaterThan(0);

    for (const [, name, route, url] of examples) {
      const resolvedRoute = route.replace('{{RUNESTONE_HOST_DOMAIN}}', 'example.test');

      expect(validateServiceName(name)).toBe(name);
      expect(normalizeRouteDomain(resolvedRoute, 'example.test')).toBe(resolvedRoute);
      expect(normalizeServiceUrl(url)).toBe(url);
    }
  });

  it('tells the agent not to use localhost in a service URL', () => {
    // The mirror image of the label-path mistake, and the reason
    // isContainerLoopbackUrl exists.
    expect(topic).toContain('host.docker.internal');
    expect(topic.toLowerCase()).toContain('localhost');
  });
});

describe('the overview topic names the commands an agent must not run', () => {
  const topic = fs.readFileSync(
    path.join(packageRoot, 'tool-docs', 'ai-context', 'overview.md'),
    'utf8'
  );

  it.each([
    'runestone dns enable',
    'runestone certs install',
    'runestone setup',
    'runestone down'
  ])('warns about %s', (command) => {
    expect(topic).toContain(command);
  });

  it('leaves the shared resource list to the user, and lists reading it as safe', () => {
    // The list is the user telling agents what runs on this machine; an agent
    // that adds to it would be telling itself.
    const mustNot = topic.slice(topic.indexOf('## Commands you must not run'), topic.indexOf('## Commands that are safe'));
    const safe = topic.slice(topic.indexOf('## Commands that are safe'), topic.indexOf('Project-integration writes'));

    expect(mustNot).toContain('runestone resource add');
    expect(safe).toContain('runestone resource list');
    expect(safe).not.toContain('resource add');
  });

  it('states the two integration paths and how to choose between them', () => {
    expect(topic).toContain('runestone service add');
    expect(topic).toContain('Traefik labels');
    expect(findTopic('compose')).toBeDefined();
    expect(findTopic('service')).toBeDefined();
  });
});

describe('the corpus says what Runestone already provides', () => {
  // Agents that did not know Traefik and Mailpit were already running added
  // their own to the project. The overview is the first topic of the guide, so
  // it is where an agent learns this before it writes anything.
  const overview = renderAiContext('overview', config(), stubBlocks());

  it('names Traefik and Mailpit as provided, with what not to add instead', () => {
    expect(overview).toContain('Runestone already provides these');
    for (const name of ['nginx-proxy', 'Caddy', 'MailHog', 'smtp4dev']) {
      expect(overview).toContain(name);
    }
    expect(overview).toContain('https://mailpit.example.test');
    expect(overview).toContain('https://traefik.example.test');
  });

  it('gives the Mailpit address for each place a sender can run', () => {
    expect(overview).toContain('`localhost:1025`');
    expect(overview).toContain('`mylab:1025`');
    expect(overview).toContain('`host.docker.internal:1025`');
    // host.docker.internal did not resolve in ordinary containers on a machine
    // measured for this change, so the address is never offered without the
    // line that makes it resolve.
    expect(overview).toContain('host.docker.internal:host-gateway');
  });

  it('tells both integration paths not to add a proxy or a mail catcher', () => {
    expect(renderAiContext('compose', config(), stubBlocks())).toContain('Add a Mailpit, MailHog, smtp4dev');
    expect(renderAiContext('service', config(), stubBlocks())).toContain('Start a reverse proxy or a mail catcher of your own');
  });
});

describe('the corpus gives "service" one meaning per term', () => {
  // "service" means Runestone's components, a route added with `service add`,
  // a Traefik service ID and a Compose service. Agents read `runestone service`
  // as "the services Runestone provides", which it is not.
  it('defines the four meanings once, in the overview', () => {
    const overview = renderAiContext('overview', config(), stubBlocks());

    expect(overview).toContain('What "service" means in these topics');
    for (const term of ["Runestone's own components", 'A route added with `runestone service add`', 'Traefik router ID and Traefik service ID', 'Compose service']) {
      expect(overview).toContain(term);
    }
  });

  it.each(['overview', 'compose', 'service', 'troubleshoot', 'state'])('does not use the ambiguous phrasings in %s', (id) => {
    const rendered = renderAiContext(id, config(), stubBlocks());

    expect(rendered).not.toMatch(/routed service/i);
    expect(rendered).not.toMatch(/\bService path\b/);
    expect(rendered).not.toMatch(/Add a Traefik service/);
  });
});

describe('the corpus tells an agent how to verify, and what not to treat as read-only', () => {
  // Each of these was a sentence an agent following the text literally would
  // have got wrong. Found by read-only probe agents on 2026-10-14.
  const troubleshoot = renderAiContext('troubleshoot', config(), stubBlocks());
  const service = renderAiContext('service', config(), stubBlocks());
  const overview = renderAiContext('overview', config(), stubBlocks());

  it('says an unrouted hostname gets the "Service not found!" page with a 404', () => {
    // docker/traefik/dynamic/traefik.dynamic.yml routes every unrouted
    // *.HOST_DOMAIN to the catch-all; docker/catchall/nginx.conf answers every
    // path there with 404 and the "Service not found!" page.
    for (const topic of [troubleshoot, service, renderAiContext('compose', config(), stubBlocks())]) {
      expect(topic).toMatch(/"Service not found!" page (?:and|with) HTTP status 404/);
      expect(topic).not.toContain('status 200');
    }
  });

  it('covers a dev server refusing an unknown hostname', () => {
    for (const topic of [troubleshoot, service]) {
      expect(topic).toContain('server.allowedHosts');
      expect(topic).toContain('Invalid Host header');
    }
  });

  it('says which Vite versions check the hostname, and how to keep its port', () => {
    // GHSA-vg6x-rcgg-rjx6 added the check in 6.0.9, 5.4.12 and 4.5.6; without
    // --strictPort, Vite moves to another port and the route reaches nothing.
    expect(service).toContain('6.0.9, 5.4.12 and 4.5.6');
    expect(troubleshoot).toContain('6.0.9, 5.4.12 and 4.5.6');
    expect(service).toContain('--strictPort');
  });

  it('tells an app behind Traefik to trust the forwarded headers', () => {
    // Measured 2026-11-18: Traefik ends HTTPS and sends X-Forwarded-Proto https
    // to a backend reached over plain HTTP.
    for (const topic of [overview, troubleshoot]) {
      expect(topic).toContain('X-Forwarded-Proto');
      expect(topic).toContain('trust proxy');
    }
  });

  it('does not list doctor as read-only, because it offers to install things', () => {
    const readOnly = (text: string) => text.slice(text.indexOf('Read-only'), text.indexOf('\n\n', text.indexOf('Read-only') + 10));

    expect(readOnly(troubleshoot)).not.toContain('doctor');
    expect(readOnly(overview)).not.toContain('doctor');
    expect(troubleshoot).toContain('Ask the user to run it');
  });

  it('tells an agent how to run service add without a terminal', () => {
    expect(service).toContain('Running it without a terminal');
    expect(service).toContain('Pass the name, --route and --url on the command line, all three.');
  });

  it('tells the agent to choose the hostname rather than stop to ask', () => {
    for (const topic of [overview, service, renderAiContext('compose', config(), stubBlocks())]) {
      expect(topic).toMatch(/do not stop to ask|Do not stop to ask/);
    }
  });

  it('names the Windows curl failure so it is not mistaken for an untrusted CA', () => {
    expect(troubleshoot).toContain('CRYPT_E_NO_REVOCATION_CHECK');
    expect(troubleshoot).toContain('--ssl-no-revoke');
  });
});

describe('the guide a bare --ai-context prints', () => {
  it('is overview, compose and service, offline, overview first', () => {
    expect(GUIDE_TOPIC_ORDER).toEqual(['overview', 'compose', 'service']);
    for (const id of GUIDE_TOPIC_ORDER) {
      expect(findTopic(id)?.tier).toBe('offline');
    }
    expect(compositeTopicOrder(GUIDE_TOPIC)).toBe(GUIDE_TOPIC_ORDER);
    expect(selectableTopicIds()).toContain(GUIDE_TOPIC);
  });

  it('starts with the steps, before either path', () => {
    const overview = renderAiContext('overview', config(), stubBlocks());

    expect(overview.indexOf('How to connect a project, step by step')).toBeLessThan(
      overview.indexOf('There are exactly two ways to connect a project')
    );
    expect(overview).toContain('If the `runestone` command is not found');
  });
});

describe('the topic footer', () => {
  it('advertises the two composites as well as every topic', () => {
    // A re-run probe agent found guide and all only through `docs --help`; the
    // footer it had read on every page listed neither.
    const footer = renderAiContext('service', config(), stubBlocks());

    expect(footer).toContain('`runestone docs --ai-context guide`');
    expect(footer).toContain('`runestone docs --ai-context all`');
  });

  it('asks before committing what carries this machine domain, not before writing it', () => {
    const compose = renderAiContext('compose', config(), stubBlocks());
    const service = renderAiContext('service', config(), stubBlocks());

    expect(compose).toContain('Write the file without asking, but ask before committing it.');
    expect(compose).toContain('Recreating the containers restarts the user');
    expect(service).toContain('add the Runestone hostname there before you verify');
  });
});

describe('several topics rendered as one document', () => {
  // The guide printed the footer once per topic and the hostname lists twice.
  const blocks = () => ({
    ...stubBlocks(),
    DOMAINS: () => '- STUB_DOMAINS',
    USED_NAMES: () => '- STUB_USED_NAMES'
  });

  it('prints the footer once, at the end', () => {
    const text = renderAiContextSequence(GUIDE_TOPIC_ORDER, config(), blocks());

    expect(text.match(/More Runestone context/g)).toHaveLength(1);
    expect(text.trimEnd().endsWith('Every topic in one go, including the live state and troubleshooting.')).toBe(true);
  });

  it('prints each fact block in full once, then points back to it', () => {
    const text = renderAiContextSequence(GUIDE_TOPIC_ORDER, config(), blocks());

    expect(text.match(/STUB_DOMAINS/g)).toHaveLength(1);
    expect(text.match(/STUB_USED_NAMES/g)).toHaveLength(1);
    expect(text).toContain('- As listed earlier in this output.');
  });

  it('renders a single topic exactly as renderAiContext does', () => {
    expect(renderAiContextSequence(['service'], config(), blocks())).toBe(renderAiContext('service', config(), blocks()));
  });
});

describe('the corpus says how the host resolves Runestone hostnames', () => {
  it('states it in the overview and gives the DNS failure its own symptom', () => {
    // All three re-run probes resolved the domain by hand with nslookup,
    // because nothing said how it resolves (docs/DOMAINS.md does).
    expect(renderAiContext('overview', config(), stubBlocks())).toContain('are meant to resolve to 127.0.0.1 on\nthis machine');
    const troubleshoot = renderAiContext('troubleshoot', config(), stubBlocks());
    expect(troubleshoot).toContain('the browser cannot find the hostname at all');
    expect(troubleshoot).toContain('do not change it yourself');
  });
});

describe('the corpus warns about names on the shared network', () => {
  it('says how a sibling name can collide, where to look, and what to call it instead', () => {
    const compose = renderAiContext('compose', config(), stubBlocks());

    expect(compose).toContain('Names on the shared network:');
    expect(compose).toContain('`<project>-<service>-1`');
    expect(renderAiContext('troubleshoot', config(), stubBlocks())).toContain("reaches another project's service");
  });
});

describe('the corpus points at service check for names', () => {
  it('tells both paths and the overview to check a name before using it', () => {
    for (const id of ['overview', 'compose', 'service']) {
      expect(renderAiContext(id, config(), stubBlocks())).toContain('runestone service check');
    }
  });
});

describe('shared resources in the corpus', () => {
  it('puts the declared resources in the overview and the state topic', () => {
    expect(renderAiContext('overview', config(), stubBlocks())).toContain('## Shared resources the user declared');
    expect(renderAiContext('overview', config(), stubBlocks())).toContain('STUB_RESOURCES');
    expect(renderAiContext('state', config(), stubBlocks())).toContain('STUB_RESOURCES');
  });

  it('never writes them into an installed file', () => {
    expect(Object.keys(installedFactPointers())).toContain('RESOURCES');
  });
});
