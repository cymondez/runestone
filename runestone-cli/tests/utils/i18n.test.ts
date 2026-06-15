import { createTranslator, formatMessage, initialSetupLocale, resolveLocale, SUPPORTED_LOCALES } from '../../src/i18n';

describe('i18n', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RUNESTONE_LANG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('formats translated messages with variables', () => {
    expect(formatMessage('zh-TW', 'setup.port.inUse', { port: 1025 })).toContain('1025');
    expect(formatMessage('ja-JP', 'commands.up.description')).toContain('Runestone');
  });

  it('uses explicit user locale when supported', () => {
    expect(resolveLocale('ja-JP')).toBe('ja-JP');
    expect(resolveLocale('zh_TW')).toBe('zh-TW');
  });

  it('falls back from unsupported explicit setup locale to a supported locale', () => {
    expect(SUPPORTED_LOCALES).toContain(initialSetupLocale('fr-FR'));
  });

  it('creates locale-specific translators', () => {
    const zh = createTranslator('zh-TW');
    const ja = createTranslator('ja-JP');

    expect(zh('commands.up.description')).toContain('啟動');
    expect(ja('commands.up.description')).toContain('起動');
  });
});
