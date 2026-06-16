Packet ID: discovery
Status: completed

Findings:
- `runestone-cli/src/commands/up.ts` exposed `--project`, although DESIGNE.md only lists `up [--project <path>]` in an older command tree but the user explicitly rejected this as spec drift for current acceptance.
- `runestone-cli/src/commands/setup.ts` uses notes before some prompts, but the explanation should be emitted as a clear message before every value request.
- `tests/integration/execution.test.ts` depends on `up --project`; it needs to switch to the documented `.env` resolution path without adding a new CLI option.
