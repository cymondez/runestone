Goal:
Add i18n support for `en`, `zh-TW`, and `ja-JP`.

Success criteria:
- Setup text is fully localized.
- Command/help descriptions are localized.
- Locale starts from OS detection, falls back to `en`, and can be persisted by user setup.
- Setup writes the selected language to `.env`.
- Help can use persisted user setting when available.
- Tests cover locale resolution, setup source usage, and help descriptions.

Constraints:
- Do not add a spec-unrequested `--lang` flag.
- Do not localize command behavior or add side-effect shortcuts.
- Keep Commander generated headings as-is; only command/help descriptions are in scope.

Workflow artifact path:
`.workflow/runestone-cli-i18n-support`

Packets:
- Discovery: inspect setup, env loader, commands, and tests.
- Implementation: i18n module, env language field, setup translations, command descriptions.
- Tests: locale resolver, setup acceptance, CLI help under language env.
- Verification: TypeScript build, Jest, workflow verifier.
