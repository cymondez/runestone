Packet ID: tests
Objective: Cover changed behavior with unit and integration tests.
Status: completed

Added and updated tests:
- `tests/services/cert-manager.test.ts`
- `tests/services/docker-compose.test.ts`
- `tests/integration/execution.test.ts`
- `tests/integration/design-acceptance.test.ts`

Coverage includes:
- wildcard `*.DOMAIN` generation arguments
- `.crt/.key` paths
- rootCA alias files
- dynamic config creation, validation, and removal
- compose restart API
- setup prompt naming/order expectations
