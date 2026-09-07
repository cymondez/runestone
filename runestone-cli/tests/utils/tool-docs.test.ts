import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_TOPIC,
  TOPICS,
  TemplateError,
  UnknownTopicError,
  findTopic,
  renderAiContext,
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

describe('tool-docs renderer', () => {
  it('renders the compose topic byte-identically to the pre-refactor output', () => {
    // The fixture was produced from tool-docs/ai-prompt-context.tmp.md by the
    // renderer this module replaced, using the same values as the golden
    // integration test. If this fails, the corpus changed the one topic that
    // is not allowed to change without a deliberate compatibility decision.
    const expected = fs.readFileSync(
      path.join(packageRoot, 'tests', 'fixtures', 'tool-docs', 'compose-topic.expected.md'),
      'utf8'
    );

    expect(renderAiContext('compose', config())).toBe(expected);
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
      expect(renderAiContext(topic.id, config())).not.toContain(cr);
    }
  });

  it('keeps renderAiPromptContext meaning the compose topic', () => {
    expect(renderAiPromptContext(config())).toBe(renderAiContext(DEFAULT_TOPIC, config()));
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
      const rendered = renderAiContext(topic.id, config());
      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('${RUNESTONE_');
      expect(rendered.trim().length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown topic', () => {
    expect(() => renderAiContext('nope', config())).toThrow(UnknownTopicError);
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
    const rendered = renderAiContext('overview', config());
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

  it('states the two integration paths and how to choose between them', () => {
    expect(topic).toContain('runestone service add');
    expect(topic).toContain('Traefik labels');
    expect(findTopic('compose')).toBeDefined();
    expect(findTopic('service')).toBeDefined();
  });
});
