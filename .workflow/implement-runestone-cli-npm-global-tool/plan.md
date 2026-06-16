# Implement runestone-cli npm global tool

## Goal

Complete the `runestone-cli` npm global tool in `runestone-cli/`, using `DESIGNE.md` as the implementation contract. Do not port Makefile logic directly; only consult Makefile files if the design is ambiguous.

## Success Criteria

- The package has npm global CLI metadata, `bin/runestone`, TypeScript build config, Jest config, source files, and tests.
- Commands from `DESIGNE.md` exist: `setup`, `up`, `stop`, `down`, `status`, `certs create/remove/rm/del`, `keys ls/list`, and `keys add`.
- Docker operations are isolated behind service modules.
- Setup uses `@clack/prompts`; cert generation uses `@mkcert/node`.
- Unit and integration tests cover command/service behavior without invoking a real Docker daemon.
- `npm run build`, `npm run test:unit`, and `npm run test:integration` pass.

## Current Context

- `runestone-cli` contains generated `dist/`, `node_modules/`, an ignored `bin/runestone`, and `DESIGNE.md`.
- Source and tests are missing and must be recreated as maintained TypeScript.

## Constraints

- Source of truth is `DESIGNE.md`.
- Makefile is only a fallback reference.
- Avoid destructive Docker operations during tests.
- Preserve unrelated user changes.

## Risks

- Docker commands can be destructive if executed directly; tests must mock them.
- `~/.runestone` is a real user path; tests must use temporary HOME where needed.

## Approval Required

No approval required for local source/test edits. External installs, Docker destructive actions, publish, or git operations would require approval.

## Work Packets

- P1: Source discovery and contract extraction.
- P2: CLI/package implementation.
- P3: Unit tests for services, utilities, and commands.
- P4: Integration tests for global CLI behavior.
- P5: Build/test verification and workflow report.

## Integration Policy

Accept implementations that preserve command names and aliases, keep Docker calls in services, and run cross-platform with argument arrays instead of shell string composition.

## Verification

- TypeScript compile.
- Jest unit suite.
- Jest integration suite.
- Workflow artifact completeness check.

## Reusable Artifacts

No reusable recipe planned unless verification reveals a generally useful pattern.
