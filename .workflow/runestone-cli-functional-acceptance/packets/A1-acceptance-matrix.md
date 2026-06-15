Packet ID: A1

Objective: Extract the DESIGNE.md functional acceptance matrix.

Context: Acceptance must cover package shape, CLI command tree, service layer APIs, setup/certs requirements, env loading, cross-platform behavior, and tests.

Files / sources: `runestone-cli/DESIGNE.md`.

Ownership: Acceptance criteria and matrix only.

Do: Distinguish must-have functionality from future expansion.

Do not: Treat Phase 2 future commands such as update/upgrade/rollback as required for current acceptance unless implemented in the command tree.

Expected output: `results/acceptance-matrix.md`.

Verification: Matrix exists and is referenced by the final report.
