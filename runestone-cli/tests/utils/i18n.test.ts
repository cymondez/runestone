import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTranslator, formatMessage, initialSetupLocale, resolveLocale, SUPPORTED_LOCALES } from '../../src/i18n';
import { toolState } from '../../src/utils/tool-state';

describe('i18n', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RUNESTONE_LANG;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-cli-i18n-'));
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(tempDir, 'tool', 'runestone.config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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

  it('reads persisted locale from tool state instead of .env', () => {
    const runestoneDir = path.join(tempDir, 'runestone');
    fs.mkdirSync(runestoneDir, { recursive: true });
    fs.writeFileSync(path.join(runestoneDir, '.env'), 'RUNESTONE_LANG=ja-JP\n');
    toolState.writeSetupState({ runestonePath: runestoneDir, locale: 'zh-TW' });

    expect(resolveLocale()).toBe('zh-TW');
  });
});
