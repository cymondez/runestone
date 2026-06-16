import {
  checkDomainResolvesToThisMachine,
  checkHostResolution,
  LocalAddressInfo,
  wildcardProbeHost
} from '../../src/services/domain-checker';
import { promises as dns } from 'dns';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn()
  }
}));

const lookupMock = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

const localInfo: LocalAddressInfo = {
  addresses: ['127.0.0.1', '::1', '192.168.10.214', '2001:db8::10'],
  hasExternalIpv6: true
};

describe('domain-checker', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('passes when a host resolves to loopback', () => {
    const result = checkHostResolution('traefik.example.test', [{ address: '127.0.0.1', family: 4 }], localInfo);

    expect(result.status).toBe('pass');
    expect(result.matched).toHaveLength(1);
  });

  it('passes when a host resolves to any local network interface IP', () => {
    const result = checkHostResolution('traefik.example.test', [{ address: '192.168.10.214', family: 4 }], localInfo);

    expect(result.status).toBe('pass');
    expect(result.matched[0].address).toBe('192.168.10.214');
  });

  it('warns when IPv4 resolves locally but IPv6 records do not match this machine', () => {
    const result = checkHostResolution(
      'traefik.example.test',
      [
        { address: '192.168.10.214', family: 4 },
        { address: '2001:db8::99', family: 6 }
      ],
      localInfo
    );

    expect(result.status).toBe('warn');
    expect(result.warnings.join('\n')).toContain('IPv6 records do not match');
  });

  it('warns when IPv6 records exist but the machine has no external IPv6', () => {
    const result = checkHostResolution(
      'traefik.example.test',
      [
        { address: '192.168.10.214', family: 4 },
        { address: '2001:db8::99', family: 6 }
      ],
      { addresses: ['127.0.0.1', '::1', '192.168.10.214'], hasExternalIpv6: false }
    );

    expect(result.status).toBe('warn');
    expect(result.warnings.join('\n')).toContain('does not appear to have external IPv6 enabled');
  });

  it('fails when no A or AAAA record points to this machine', () => {
    const result = checkHostResolution('traefik.example.test', [{ address: '203.0.113.10', family: 4 }], localInfo);

    expect(result.status).toBe('fail');
    expect(result.errors.join('\n')).toContain('does not resolve to 127.0.0.1');
  });

  it('accepts IPv4-mapped IPv6 loopback addresses', () => {
    const result = checkHostResolution('traefik.example.test', [{ address: '::ffff:127.0.0.1', family: 6 }], localInfo);

    expect(result.status).toBe('pass');
    expect(result.matched).toHaveLength(1);
  });

  it('builds a concrete wildcard probe host instead of checking the bare domain', () => {
    expect(wildcardProbeHost('example.test')).toBe('runestone-wildcard-check.example.test');
  });

  it('checks only the wildcard probe host for a domain', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);

    const result = await checkDomainResolvesToThisMachine('example.test');

    expect(result.checkedHosts.map((host) => host.host)).toEqual(['runestone-wildcard-check.example.test']);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith('runestone-wildcard-check.example.test', {
      all: true,
      verbatim: true
    });
    expect(result.checkedHosts.map((host) => host.host)).not.toContain('traefik.example.test');
    expect(result.checkedHosts.map((host) => host.host)).not.toContain('mailpit.example.test');
  });
});
