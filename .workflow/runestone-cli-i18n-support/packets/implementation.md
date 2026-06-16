Packet ID: implementation
Status: completed

Changes:
- Added `src/i18n/index.ts` with `en`, `zh-TW`, and `ja-JP` translations.
- Added locale detection and fallback helpers.
- Added `RUNESTONE_LANG` to env loading and writing.
- Setup now asks for language and uses the selected language for subsequent prompts/logs.
- Command/help descriptions now use i18n.
- No `--lang` option was added.
