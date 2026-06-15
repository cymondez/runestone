Packet ID: discovery
Status: completed

Findings:
- Setup strings are concentrated in `src/commands/setup.ts`.
- Command/help description strings are spread across `src/cli.ts` and command files.
- `.env` currently has no language field.
- Existing tests already inspect setup source and CLI help behavior.
