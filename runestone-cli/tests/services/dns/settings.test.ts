import {
  daemonFallbackValue,
  isAutoReorderEnabled,
  isDnsEnabled,
  isDnsUiAuthConfigured,
  isDnsUiEnabled,
  isTruthy,
  ownedEntryInputs
} from '../../../src/services/dns/settings';
import { testEnv } from '../../helpers/env';

function settings(overrides: Record<string, string>) {
  return testEnv('/tmp/runestone', overrides);
}

describe('dns settings (spec 7.1)', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['  true  ', true],
    ['false', false],
    ['0', false],
    ['', false],
    ['maybe', false],
    [undefined, false]
  ])('reads %s as %s', (value, expected) => {
    expect(isTruthy(value)).toBe(expected);
  });

  it('treats an absent DNS_ENABLE as disabled, so an upgrade changes nothing', () => {
    expect(isDnsEnabled(settings({ DNS_ENABLE: '' }))).toBe(false);
    expect(isDnsEnabled(settings({ DNS_ENABLE: 'true' }))).toBe(true);
  });

  it('defaults automatic reordering to off', () => {
    expect(isAutoReorderEnabled(testEnv('/tmp/runestone'))).toBe(false);
  });

  it('defaults the UI to on', () => {
    expect(isDnsUiEnabled(testEnv('/tmp/runestone'))).toBe(true);
  });

  it('treats a half-configured UI credential pair as no authentication', () => {
    expect(isDnsUiAuthConfigured(settings({ DNS_UI_USER: 'me', DNS_UI_PASS: '' }))).toBe(false);
    expect(isDnsUiAuthConfigured(settings({ DNS_UI_USER: '', DNS_UI_PASS: 'secret' }))).toBe(false);
    expect(isDnsUiAuthConfigured(settings({ DNS_UI_USER: 'me', DNS_UI_PASS: 'secret' }))).toBe(true);
  });

  it('treats an empty daemon fallback as off', () => {
    expect(daemonFallbackValue(settings({ DNS_DAEMON_FALLBACK: '' }))).toBeUndefined();
    expect(daemonFallbackValue(settings({ DNS_DAEMON_FALLBACK: '  ' }))).toBeUndefined();
    expect(daemonFallbackValue(settings({ DNS_DAEMON_FALLBACK: '1.1.1.1' }))).toBe('1.1.1.1');
  });

  describe('the entries Runestone would own', () => {
    it('is the target alone by default', () => {
      expect(ownedEntryInputs(settings({ DNS_HOST_IP: '192.168.65.254' }))).toEqual([
        { role: 'target', value: '192.168.65.254' }
      ]);
    });

    it('puts the fallback after the target, which is the insertion order', () => {
      expect(
        ownedEntryInputs(settings({ DNS_HOST_IP: '192.168.65.254', DNS_DAEMON_FALLBACK: '1.1.1.1' }))
      ).toEqual([
        { role: 'target', value: '192.168.65.254' },
        { role: 'fallback', value: '1.1.1.1' }
      ]);
    });

    it('owns nothing when there is no target address', () => {
      expect(ownedEntryInputs(settings({ DNS_HOST_IP: '' }))).toEqual([]);
    });
  });
});
