# Final Acceptance Report

## Outcome

Pass. `runestone-cli` satisfies the functional requirements from `DESIGNE.md` within the safe acceptance boundary used here.

## What Was Verified

- Package/bin contract for npm global usage.
- Commander command tree and aliases.
- setup uses `@clack/prompts`.
- certs uses `@mkcert/node`.
- Docker calls are isolated behind service utilities.
- Environment loading, project file generation, lifecycle flow, status, key management, and certificate removal.
- Actual CLI process execution through `node bin/runestone ...` with a fake Docker executable in PATH.
- Live Docker Compose execution against the real Docker daemon using `cymondez/runstone:5.2`.
- WSL/Linux execution using default ports `80`, `443`, and `1025`.

## Tests Added

- `tests/integration/design-acceptance.test.ts`
- `tests/integration/execution.test.ts`

## Functional Fixes Made

- Reworked SSH key copy command to avoid Windows outer-shell redirection.
- Reworked SSH key listing command to avoid Windows outer-shell redirection/OR operators.
- Updated default image/tag to `cymondez/runstone:5.2`, matching the image that was pushed and successfully started.

## Verification Results

- TypeScript build: passed.
- Unit tests: passed, 5 suites / 19 tests.
- Integration tests: passed, 3 suites / 9 tests.
- Full Jest suite: passed, 8 suites / 28 tests.
- Workflow verifier: passed.
- Live Docker acceptance: passed. `~/.runestone` was created, `compose.yml` was generated, `runestone up` started the service, and `runestone status` reported the container/network/volume as running.
- WSL/Linux default-port acceptance: passed. `runestone-wslaccept` is running with `0.0.0.0:80->80`, `0.0.0.0:443->443`, and `0.0.0.0:1025->1025`.

## Residual Risks

- Live `mkcert.install()` was not run because it mutates the local trust store.
- README remains absent even though the design's example directory includes one; this is not blocking functional acceptance.
- Live Docker acceptance used `RUNESTONE_SKIP_SSH_KEYS=1` to avoid reading or injecting real user SSH keys.
- Node emitted `DEP0190` warnings for `spawnSync(..., shell: true)` Docker calls on Windows; the calls completed successfully, but this is worth cleaning up before publishing.
