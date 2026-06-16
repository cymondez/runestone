Packet ID: implementation
Status: completed

Changes:
- `setup.ts` now uses explicit `p.log.info` explanations before each value prompt.
- Port prompt calls list `purpose` before `message` in source and the runtime helper prints the purpose before asking.
- The local CA prompt now has its own pre-prompt explanation.
- `up.ts` no longer has `UpOptions.project` or `.option('--project <path>')`.
- `up.ts` now loads configuration through the normal setup/default path instead of a command-line project override.
