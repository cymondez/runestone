import {
  DEFAULT_UPSTREAM,
  bindPrefix,
  determineBindIp,
  determineUpstreams,
  isUnusableUpstream,
  parseUpstreamList
} from '../../../src/services/dns/upstream';

describe('upstream DNS determination (spec 8.4)', () => {
  it('treats a configured list as authoritative', () => {
    const result = determineUpstreams({
      configured: '10.0.0.1, 10.0.0.2',
      daemonEntries: ['8.8.8.8'],
      hostResolvers: ['192.168.1.1']
    });

    expect(result.upstreams).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(result.origins).toEqual([
      { value: '10.0.0.1', origin: 'env' },
      { value: '10.0.0.2', origin: 'env' }
    ]);
  });

  it('falls through to detection when the configured value is blank', () => {
    expect(determineUpstreams({ configured: '  ,  ', hostResolvers: ['192.168.1.1'] }).upstreams).toEqual([
      '192.168.1.1'
    ]);
  });

  it('prefers daemon entries over the host resolvers', () => {
    const result = determineUpstreams({
      daemonEntries: ['8.8.8.8'],
      hostResolvers: ['192.168.1.1']
    });

    expect(result.origins).toEqual([
      { value: '8.8.8.8', origin: 'daemon' },
      { value: '192.168.1.1', origin: 'host' }
    ]);
  });

  it('excludes the Target IP so dnsmasq is never pointed back at itself', () => {
    const result = determineUpstreams({
      daemonEntries: ['192.168.65.254', '8.8.8.8'],
      targetIp: '192.168.65.254'
    });

    expect(result.upstreams).toEqual(['8.8.8.8']);
  });

  it.each([
    ['the systemd-resolved stub', '127.0.0.53'],
    ['plain loopback', '127.0.0.1'],
    ['IPv6 loopback', '::1'],
    ['the unspecified address', '0.0.0.0'],
    ['the IPv6 unspecified address', '::'],
    ['a link-local address', '169.254.1.1']
  ])('excludes %s from detection', (_label, address) => {
    expect(isUnusableUpstream(address)).toBe(true);
    expect(determineUpstreams({ hostResolvers: [address] }).upstreams).toEqual([DEFAULT_UPSTREAM]);
  });

  it('keeps ordinary resolvers, including bracketed IPv6', () => {
    expect(isUnusableUpstream('8.8.8.8')).toBe(false);
    expect(determineUpstreams({ hostResolvers: ['[2001:4860:4860::8888]'] }).upstreams).toEqual([
      '[2001:4860:4860::8888]'
    ]);
  });

  it('deduplicates while keeping the first occurrence in place', () => {
    const result = determineUpstreams({
      daemonEntries: ['8.8.8.8', '1.0.0.1'],
      hostResolvers: ['1.0.0.1', '8.8.8.8', '9.9.9.9']
    });

    expect(result.upstreams).toEqual(['8.8.8.8', '1.0.0.1', '9.9.9.9']);
  });

  it('uses the public default as the last resort, and says so', () => {
    expect(determineUpstreams()).toEqual({
      upstreams: [DEFAULT_UPSTREAM],
      origins: [{ value: DEFAULT_UPSTREAM, origin: 'default' }]
    });
  });

  it.each([
    ['nothing at all', {}],
    ['empty everything', { configured: '', daemonEntries: [], hostResolvers: [] }],
    ['only loopback', { hostResolvers: ['127.0.0.53', '127.0.0.1'] }],
    ['only the Target IP', { daemonEntries: ['192.168.65.254'], targetIp: '192.168.65.254' }],
    ['whitespace only', { configured: '   ', hostResolvers: ['  '] }],
    ['a configured array of blanks', { configured: ['', ' '] }]
  ])('is never empty: %s', (_label, sources) => {
    const result = determineUpstreams(sources);

    expect(result.upstreams.length).toBeGreaterThan(0);
    expect(result.upstreams).not.toContain('');
    expect(result.upstreams.length).toBe(result.origins.length);
  });

  describe('parseUpstreamList', () => {
    it('splits, trims and drops empties', () => {
      expect(parseUpstreamList(' 1.1.1.1 , ,8.8.8.8 ')).toEqual(['1.1.1.1', '8.8.8.8']);
    });

    it('accepts an array as given', () => {
      expect(parseUpstreamList([' 1.1.1.1 ', ''])).toEqual(['1.1.1.1']);
    });

    it('treats undefined as nothing', () => {
      expect(parseUpstreamList(undefined)).toEqual([]);
    });
  });
});

describe('bind IP determination (spec 6.1)', () => {
  it('binds the docker0 gateway on a native Linux engine', () => {
    expect(determineBindIp({ host: 'linux-engine', targetIp: '172.17.0.1' })).toBe('172.17.0.1');
  });

  it('binds every interface on Docker Desktop, because the Target IP is inside the Docker VM', () => {
    expect(determineBindIp({ host: 'docker-desktop', targetIp: '192.168.65.254' })).toBe('0.0.0.0');
  });

  describe('the published-port prefix', () => {
    // Measured on Windows with Docker Desktop (M6b): the Internet Connection
    // Sharing service, which WSL2 turns on, already holds `0.0.0.0:53/udp`.
    // `docker compose up` publishing `53:53/udp` starts and containers reach the
    // service at the Target IP; publishing `0.0.0.0:53:53/udp` fails outright.
    // Spelling out an all-interfaces bind therefore breaks the default Windows
    // installation, and these two forms are not interchangeable.
    it('leaves an all-interfaces bind unspelled', () => {
      expect(bindPrefix('0.0.0.0')).toBe('');
      expect(bindPrefix('')).toBe('');
      expect(bindPrefix('  ')).toBe('');
      expect(bindPrefix('::')).toBe('');
    });

    it('spells out an address that names one interface', () => {
      // The native Linux engine case, where binding the docker0 gateway is the
      // entire point: it avoids systemd-resolved and keeps 53 off the LAN.
      expect(bindPrefix('172.17.0.1')).toBe('172.17.0.1:');
      expect(bindPrefix('127.0.0.1')).toBe('127.0.0.1:');
    });
  });
});
