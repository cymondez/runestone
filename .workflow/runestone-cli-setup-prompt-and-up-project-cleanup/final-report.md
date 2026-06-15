# Final Report: runestone-cli setup prompt and up project cleanup

## Outcome
Completed the requested cleanup.

## Changes
- Setup explanations are emitted before each setting prompt through `explainSetting`.
- `Install local CA for SSL certificates` now has a pre-prompt explanation.
- Removed the spec-unrequested `runestone up --project` option.
- Updated integration tests to use the setup-created default `.runestone` location instead of `up --project`.

## Verification
- TypeScript build passed.
- Jest passed: 10 suites, 42 tests.
- `runestone up --help` does not show `--project`.
- `runestone up --project somewhere` returns `error: unknown option '--project'`.

## Remaining Risk
No live Docker side-effect run was needed for this task because the change is CLI contract and prompt flow only.
