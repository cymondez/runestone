# Changelog

## Unreleased

### Added

- `runestone dns status` reports the DNS state and every invasive setting currently in effect: the Docker daemon configuration path, which entries Runestone owns and where they actually sit, the upstream resolvers and where each came from, and whether the web UI has any authentication.
- `runestone dns disable` removes the entries Runestone added to the Docker daemon DNS configuration and leaves everything else exactly where it was. `--dry-run` shows what would change without writing anything, and `--assume-entry` / `--assume-index` let you state which entry is Runestone's when it cannot tell on its own. When it cannot tell and you have not said, it refuses rather than guessing.

### Changed

- Certificate, service and setup changes now restart only the `runestone` container instead of every service in the Runestone project, so other services keep running.
- `compose.yml` is now regenerated when Runestone's template changes, so an upgrade no longer leaves you with an outdated Compose file. The file already on disk is kept as a `.bak` beside it first.

## 1.1.1 - 2026-06-23

### Changed

- `runestone service add` and `runestone service modify` now ask users to choose a certificate base domain when the route is incomplete, instead of silently appending the default domain.
- Service URLs now support upstream paths and query strings, such as `http://127.0.0.1:11434/v1`.
- Runestone now restarts after service or certificate routing changes on all platforms so Traefik reliably reloads dynamic configuration.

### Fixed

- Fixed service route suggestions so partial routes like `api.ollama` keep the full prefix and prefer the most specific matching wildcard certificate.
- Fixed localhost service URL conversion so paths and query strings are preserved when switching to `host.docker.internal`.
- Fixed interactive service prompts so input problems are shown immediately before continuing to the next field.

## 1.1.0 - 2026-06-19

### Added

- Added `runestone service` for exposing local services through Runestone:
  - `add` creates a routed service and prompts for missing values.
  - `list|ls` shows group, service name, route, URL, and config status.
  - `remove|rm`, `modify|m`, and `repair` manage existing services.
- Added `runestone service group` for organizing services:
  - `list|ls` can show names, tree view, or detailed tree view.
  - `move|mv` moves a service to another group.
  - `clean` removes services in a group or keeps them ungrouped.
- Added service setup checks:
  - Detects Traefik router/service name conflicts across providers.
  - Detects route Host conflicts before writing config.
  - Checks wildcard certificate coverage.
  - Warns when loopback URLs would point to the Runestone container.

### Changed

- Certificate dynamic configs are stored under `configuration/certs`.

## 1.0.1 - 2026-06-18

### Added

- Added `runestone docs` to quickly open the Runestone documentation.
- Added `runestone docs --ai-context` to generate instructions that can be given to an AI assistant when adding Runestone routing to a project.
- Added `runestone doctor` to check whether the machine is ready to run Runestone and guide users through supported fixes.
- Added `runestone certs install` / `runestone certs i` to reinstall the Runestone root CA when browsers do not trust local HTTPS certificates.

### Changed

- Runestone now stores its CLI configuration under `~/.runestone`, avoiding permission problems after global npm installation.
- `runestone setup` now checks required host tools before asking configuration questions.
- On Linux and macOS, certificate installation now uses the system NSS certificate tool so Firefox and Chromium-based browsers can trust Runestone certificates.
- On Windows, certificate installation continues to use the existing mkcert-based system trust store flow.

### Fixed

- Fixed setup failures caused by missing or outdated Docker, Docker Compose, or Linux/macOS certificate tooling being discovered too late.
- Fixed local HTTPS trust on Linux/macOS when the system trusted the Runestone CA but Firefox or Chromium-based browsers still rejected certificates.
- Fixed setup failures on systems where the `netstat` command is not available.
