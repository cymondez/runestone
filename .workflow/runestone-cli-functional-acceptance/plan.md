# Runestone CLI Functional Acceptance

## Goal

Validate `runestone-cli` against `runestone-cli/DESIGNE.md`, producing a concrete acceptance report and filling any reasonable acceptance-test gaps found during validation.

## Success Criteria

- DESIGNE.md requirements are converted into an acceptance matrix.
- CLI command tree, aliases, package metadata, TypeScript build, service boundaries, setup/certs implementation choices, and tests are checked.
- Verification runs without performing real Docker lifecycle operations, real mkcert CA installation, npm publish/link, or destructive teardown.
- Any discovered functional acceptance gap is either fixed with a focused source/test change or recorded as an explicit residual risk.
- Workflow artifact passes `verify_workflow.py`.

## Current Context

- `runestone-cli` has TypeScript source, package metadata, Jest tests, and a `bin/runestone` entrypoint.
- Existing tests cover services, env helpers, status, and basic CLI integration.
- `DESIGNE.md` is modified in the worktree and is treated as the current contract.

## Constraints

- DESIGNE.md is the source of truth.
- Do not copy or port Makefile logic.
- Do not run real Docker up/down/network/volume/cert side-effect operations during acceptance.
- Preserve user changes, especially `.gitignore` and `DESIGNE.md`.

## Risks

- Functional CLI commands can call Docker and local CA installers if executed directly.
- npm is not guaranteed to be on PATH in this desktop shell.
- Some DESIGNE.md details are inconsistent, such as `@clack/prompts` vs `enquirer` and `compose.yaml` vs `compose.yml`.

## Approval Required

No approval required for local static checks, build, Jest, or non-side-effect CLI help/version checks. Approval would be required for live Docker environment startup, mkcert CA installation, npm link/publish, or destructive Docker teardown.

## Workflow Artifact Path

`.workflow/runestone-cli-functional-acceptance`

## Work Packets

- A1: Extract acceptance matrix from DESIGNE.md.
- A2: Inspect implementation against package, CLI, command, service, setup, cert, env, and cross-platform requirements.
- A3: Add focused acceptance tests for DESIGNE.md command and implementation guarantees if gaps are found.
- A4: Run build, unit tests, integration tests, acceptance tests, and safe CLI dry-runs.
- A5: Integrate findings and produce final acceptance report.

## Integration Policy

Requirements explicitly stated as "must" in DESIGNE.md take priority. Conflicting advisory examples are accepted if the implementation follows the stronger explicit requirement.

## Verification

- TypeScript build.
- Full Jest suite.
- CLI help/version dry-runs through `bin/runestone`.
- Static acceptance checks for package/source contract.
- Workflow artifact verification.

## Reusable Artifacts

The acceptance matrix under `results/acceptance-matrix.md` can be reused for future CLI release checks.
