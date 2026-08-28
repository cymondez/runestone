import {
  isRemoteEndpoint,
  readDockerContext,
  resolveTargetIp,
  verifyDomainResolution
} from '../../../src/services/dns/environment';

const TARGET = '192.168.65.254';

describe('docker environment probes', () => {
  describe('isRemoteEndpoint', () => {
    it.each([
      ['unix:///var/run/docker.sock', false],
      ['npipe:////./pipe/dockerDesktopLinuxEngine', false],
      ['NPIPE:////./pipe/docker_engine', false],
      ['tcp://10.0.0.5:2376', true],
      ['ssh://user@host', true],
      ['', false]
    ])('reads %s as remote=%s', (endpoint, expected) => {
      expect(isRemoteEndpoint(endpoint)).toBe(expected);
    });
  });

  describe('readDockerContext', () => {
    it('splits the name from the endpoint', () => {
      const context = readDockerContext({
        context: () => ({ ok: true, stdout: 'desktop-linux|npipe:////./pipe/x' })
      });

      expect(context).toEqual({ name: 'desktop-linux', endpoint: 'npipe:////./pipe/x', remote: false });
    });

    it('reports nothing when docker cannot answer', () => {
      expect(readDockerContext({ context: () => ({ ok: false, stdout: '', message: 'no docker' }) })).toBeUndefined();
    });
  });

  describe('resolveTargetIp', () => {
    it('takes the IPv4 address out of the container output', () => {
      expect(resolveTargetIp('image', { runInContainer: () => ({ ok: true, stdout: `${TARGET}\n` }) })).toEqual({
        ip: TARGET
      });
    });

    it('ignores non-address noise from an image with a chatty entrypoint', () => {
      const stdout = `level=info msg="starting"\n${TARGET}\n`;

      expect(resolveTargetIp('image', { runInContainer: () => ({ ok: true, stdout }) }).ip).toBe(TARGET);
    });

    it('reports the failure rather than inventing an address', () => {
      const result = resolveTargetIp('image', { runInContainer: () => ({ ok: true, stdout: '' }) });

      expect(result.ip).toBeUndefined();
      expect(result.error).toContain('no IPv4 address');
    });

    it('reports a container that could not run', () => {
      const result = resolveTargetIp('image', {
        runInContainer: () => ({ ok: false, stdout: '', message: 'image not found' })
      });

      expect(result.error).toBe('image not found');
    });
  });

  describe('verifyDomainResolution', () => {
    it('accepts an answer containing the Target IP', () => {
      const result = verifyDomainResolution('image', 'traefik.example.test', TARGET, {
        runInContainer: () => ({ ok: true, stdout: `${TARGET}\n` })
      });

      expect(result).toEqual({ ok: true, answers: [TARGET] });
    });

    it('rejects an answer that is some other address', () => {
      // The whole feature exists to stop a wrong answer from looking like a
      // right one, so "it answered" is not the same as "it answered correctly".
      const result = verifyDomainResolution('image', 'traefik.example.test', TARGET, {
        runInContainer: () => ({ ok: true, stdout: '127.0.0.1\n' })
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('expected 192.168.65.254');
    });

    it('rejects an empty answer', () => {
      const result = verifyDomainResolution('image', 'traefik.example.test', TARGET, {
        runInContainer: () => ({ ok: true, stdout: '' })
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('no answer');
    });

    it('reports a query that could not be run', () => {
      const result = verifyDomainResolution('image', 'traefik.example.test', TARGET, {
        runInContainer: () => ({ ok: false, stdout: '', message: 'network unreachable' })
      });

      expect(result).toEqual({ ok: false, answers: [], error: 'network unreachable' });
    });
  });
});
