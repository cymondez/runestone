Packet ID: A3

Objective: Add focused acceptance tests for uncovered DESIGNE.md guarantees.

Context: Current tests cover basics; acceptance needs command tree, package metadata, and source-level guarantees.

Files / sources: `runestone-cli/tests/**`.

Ownership: Test additions only unless a small implementation gap is found.

Do: Mock or statically inspect side-effectful behavior.

Do not: Add tests that require a Docker daemon, a trusted local CA install, or npm global link.

Expected output: Acceptance tests passing.

Verification: Jest suite passes.
