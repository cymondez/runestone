Packet ID: P3

Objective: Add focused unit tests.

Context: Docker and filesystem-sensitive behavior must be mocked or sandboxed.

Files / sources: `tests/services/**`, `tests/utils/**`, `tests/commands/**`.

Ownership: Unit tests only.

Do: Mock `child_process` and service boundaries; use temp directories for filesystem checks.

Do not: Invoke real Docker.

Expected output: Unit tests for service, util, and command behavior.

Verification: Unit suite passed.
