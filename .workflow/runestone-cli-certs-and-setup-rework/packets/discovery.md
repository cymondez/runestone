Packet ID: discovery
Objective: Confirm design requirements and current implementation gaps.
Status: completed

Reviewed DESIGNE.md, `make/plugins/01-mkcert.mk`, current `setup.ts`, `certs.ts`, compose generation, and integration tests.

Key findings:
- Existing cert command used `.pem` files and did not write Traefik TLS dynamic config.
- Makefile custom domain flow creates wildcard `*.DOMAIN`, `<domain>.crt`, `<domain>.key`, and validates `traefik/dynamic/<domain>.ssl.yml`.
- CLI compose mounts `./certs:/ssl` and `./configuration:/configuration`, so dynamic config belongs under `configuration/traefik/dynamic`.
- Existing setup prompt order and wording did not match the requested flow.
