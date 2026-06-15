Packet ID: implementation
Objective: Implement cert/domain and setup behavior changes.
Status: completed

Files changed:
- `runestone-cli/src/services/cert-manager.ts`
- `runestone-cli/src/utils/port-checker.ts`
- `runestone-cli/src/services/docker-compose.ts`
- `runestone-cli/src/commands/certs.ts`
- `runestone-cli/src/commands/setup.ts`
- command option descriptions for `--project`

Implementation notes:
- Added shared certificate manager for wildcard certs, rootCA aliases, Traefik TLS dynamic config creation/validation, and removal.
- Added Docker compose restart service.
- Added setup port availability checks and detailed grouped prompt flow.
