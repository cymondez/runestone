Packet ID: P4

Objective: Add CLI entrypoint integration tests.

Context: The npm global tool is represented by `bin/runestone`, which requires compiled `dist/cli.js`.

Files / sources: `tests/integration/cli.test.ts`.

Ownership: Integration tests only.

Do: Build before running entrypoint checks; verify help/version/aliases.

Do not: Run commands that require Docker or interactive prompts.

Expected output: Integration coverage for global CLI shape.

Verification: Integration suite passed.
