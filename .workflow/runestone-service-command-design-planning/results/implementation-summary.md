# Implementation Summary

## Accepted

- Added `runestone service` command tree.
- Added service metadata persistence through `runestone.config.json`.
- Added Traefik API reader for HTTP routers and services.
- Added service validation, dynamic config generation, certificate coverage checks, repair, list, remove, and group operations.
- Added service dynamic config directory creation under `configuration/services`.
- Added Windows restart handling after service dynamic config create/update/delete so Docker Desktop bind mount changes are picked up.
- Added loopback upstream warning for `localhost`, `127.0.0.1`, and `::1`, with an option to replace the host with `host.docker.internal`.
- Added provider-aware Traefik name and Host conflict messages.
- `service add` now validates service name conflicts before prompting for route, URL, or group details.
- `service rm` removes metadata-missing stale config only when the file is marked as Runestone-managed.
- Added command and service tests.

## Commands Implemented

- `runestone service add [name] --route <domain> --url <url> [--group <group>]`
- `runestone service modify|m <name>`
- `runestone service repair <name>`
- `runestone service list|ls [--no-header]`
- `runestone service remove|rm <name> [--force]`
- `runestone service group list|ls [--tree] [--detail]`
- `runestone service group clean <group> [--force] [--keep-services]`
- `runestone service group move|mv <name> <group>`

## Verification

- TypeScript compile passed.
- Full Jest suite passed: 20 suites, 106 tests.
