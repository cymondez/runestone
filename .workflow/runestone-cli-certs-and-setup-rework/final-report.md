# Final Report: runestone-cli certs and setup rework

## Outcome
Implemented the requested runestone-cli certificate and setup behavior changes.

## Accepted Results
- `runestone certs create <DOMAIN>` now creates `<domain>.crt`, `<domain>.key`, and `configuration/traefik/dynamic/<domain>.ssl.yml`.
- Generated domain certificates use wildcard SANs: `*.DOMAIN`.
- `runestone certs remove <DOMAIN>` removes both certificate files and the matching Traefik dynamic config after checking each file.
- Windows certificate/config changes restart a running compose container.
- `setup` now loads existing settings, uses "Runestone path" wording, groups HTTP/HTTPS entrypoint name and port prompts, asks each port with a purpose-specific explanation, validates new port availability, asks local CA install immediately before certificate generation, and asks whether to restart if existing settings changed.

## Rejected Results
None.

## Conflicts Resolved
The Makefile dynamic path is `traefik/dynamic/<domain>.ssl.yml`; the CLI compose mounts `./configuration:/configuration`, so the CLI writes `configuration/traefik/dynamic/<domain>.ssl.yml` while preserving the same TLS file content and `/ssl/<domain>.crt/.key` references.

## Verification Evidence
- TypeScript build: passed.
- Jest: 9 suites passed, 35 tests passed.
- Real Windows `runestone up --project C:\Users\cymondez\.runestone`: passed; Docker showed container `runestone` running `cymondez/runstone:5.2`.
- Real Windows `runestone cert create acceptance-20260615.docker.so`: passed; created `.crt`, `.key`, dynamic TLS config, `rootCA.crt`, `rootCA.key`; Docker container restarted.
- Certificate SAN check: `DNS:*.acceptance-20260615.docker.so`.
- Real Windows `runestone cert remove acceptance-20260615.docker.so`: passed; `.crt`, `.key`, and `.ssl.yml` were absent afterward; Docker container restarted again.

## Remaining Risks
The setup restart prompt was covered by automated tests and code review; the live interactive setup was not rerun with changed values because changing the active domain/prefix/entrypoint names would mutate the currently running Windows environment.

## Reusable Follow-up
Use the same live smoke shape for future cert changes: start runestone, create a throwaway domain, inspect cert files/config/SAN, remove it, and verify Docker restart on Windows.
