import {
  isRemoteEndpoint,
  readDockerContext,
  resolveTargetIp,
  verifyDomainResolution
} from '../../../src/services/dns/environment';
import { desktopRestartIsSafe, readDesktopVersion } from '../../../src/services/dns/environment';

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
describe('deciding whether Docker Desktop may be restarted automatically', () => {
  // Older Docker Desktop stopped the running containers when it restarted, and
  // `unless-stopped` means "restart unless it was stopped" — so those never came
  // back. Fixed in DESKTOP_SAFE_RESTART_VERSION, which is what makes an
  // automatic restart safe to attempt at all.
  function version(raw: string) {
    return readDesktopVersion({ platformName: () => ({ ok: true, stdout: raw }) });
  }

  it('reads the application version, not the CLI plugin version', () => {
    expect(version('Docker Desktop 4.88.1 (237512)')).toEqual({
      raw: 'Docker Desktop 4.88.1 (237512)',
      version: '4.88.1'
    });
  });

  it('accepts the version that fixed it, and anything newer', () => {
    expect(desktopRestartIsSafe(version('Docker Desktop 4.86.0 (1)'))).toBe(true);
    expect(desktopRestartIsSafe(version('Docker Desktop 4.86.1 (1)'))).toBe(true);
    expect(desktopRestartIsSafe(version('Docker Desktop 4.88.1 (237512)'))).toBe(true);
    expect(desktopRestartIsSafe(version('Docker Desktop 5.0.0 (1)'))).toBe(true);
  });

  it('refuses anything older, including the release just before it', () => {
    expect(desktopRestartIsSafe(version('Docker Desktop 4.85.9 (1)'))).toBe(false);
    expect(desktopRestartIsSafe(version('Docker Desktop 4.85.0 (1)'))).toBe(false);
    // 4.9 is older than 4.86 — a string comparison would get this backwards.
    expect(desktopRestartIsSafe(version('Docker Desktop 4.9.0 (1)'))).toBe(false);
  });

  it('treats an unreadable version as unsafe, because not knowing is not knowing it is fine', () => {
    expect(desktopRestartIsSafe(undefined)).toBe(false);
    expect(desktopRestartIsSafe(version('Docker Desktop'))).toBe(false);
    expect(readDesktopVersion({ platformName: () => ({ ok: false, stdout: '' }) })).toBeUndefined();
  });
});

});
