# Orchestration: Implement runestone-cli npm global tool

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Integrate packet results before final verification.

## Branching Rules

- If design and existing generated output conflict, prefer `DESIGNE.md`.
- If a command would call Docker in tests, mock the service boundary instead.
- If dependency installation is required and network fails, request escalation before retrying.

## Packet Prompts

- P1: Extract command tree, package requirements, resource paths, and testing scope.
- P2: Implement package metadata, CLI routing, commands, services, utilities, and resource generation.
- P3: Add unit tests for compose, Docker resource services, env/path helpers, SSH manager, and status command.
- P4: Add integration tests for CLI help/version/aliases and no-Docker command paths.
- P5: Run build/tests, fix failures, and produce final report.

## Completion Audit

The workflow is complete when build and both test suites pass or any skipped check is explicitly explained.
