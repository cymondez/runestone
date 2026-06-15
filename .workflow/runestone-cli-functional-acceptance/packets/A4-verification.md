Packet ID: A4

Objective: Run safe acceptance verification.

Context: npm may not be on PATH; use bundled Node plus local TypeScript/Jest binaries when needed.

Files / sources: Build output and test results.

Ownership: Verification commands and result capture.

Do: Run build, unit tests, integration/acceptance tests, CLI help/version dry-runs, workflow verifier.

Do not: Run live Docker lifecycle operations.

Expected output: Verification results recorded in state and final report.

Verification: All safe checks pass or residual risks are recorded.
