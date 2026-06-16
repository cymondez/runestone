# Orchestration: Runestone CLI Functional Acceptance

## Execution Rules

- Treat DESIGNE.md as the acceptance contract.
- Prefer non-side-effect verification: source inspection, mocked tests, CLI help/version dry-runs.
- Do not run live Docker lifecycle commands or install local CAs.
- Record ambiguities instead of guessing silently.

## Branching Rules

- If a requirement is untested but implemented, add a focused acceptance test.
- If a requirement is missing and safe to fix locally, patch it and rerun checks.
- If a requirement needs external side effects to prove, mark it as statically or mock-verified and record the live-test gap.

## Packet Prompts

- A1: Build acceptance matrix from DESIGNE.md sections 1-14.
- A2: Compare source/package/tests against the matrix.
- A3: Implement missing acceptance test coverage in `tests/integration` or focused unit tests.
- A4: Run verification commands with bundled Node if npm is unavailable.
- A5: Write final report with pass/fail/partial and residual risks.

## Completion Audit

Acceptance is complete when the matrix has evidence, all safe checks pass, and residual risks are explicit.
