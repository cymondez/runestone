# Changelog

## Unreleased

### Added

- `runestone dns status` reports the DNS state and every invasive setting currently in effect: the Docker daemon configuration path, which entries Runestone owns and where they actually sit, the upstream resolvers and where each came from, and whether the web UI has any authentication.
- `runestone dns enable` points the Docker daemon at the Runestone DNS. It checks everything first, starts the dns service and asks it a real question before writing anything global, and stops once the daemon configuration is written — nothing takes effect until you restart Docker yourself. `--dry-run` shows the full disclosure and the exact change without writing anything.
- `runestone dns disable` removes the entries Runestone added to the Docker daemon DNS configuration and leaves everything else exactly where it was. `--dry-run` shows what would change without writing anything, and `--assume-entry` / `--assume-index` let you state which entry is Runestone's when it cannot tell on its own. When it cannot tell and you have not said, it refuses rather than guessing.
- `runestone setup` now asks four DNS questions when you want DNS: whether to enable it, which upstream resolvers to forward to, whether to add a fallback entry to the Docker daemon, and whether Runestone should move its own entries back to the front automatically. It records your answers and checks whether this machine can do it; enabling is still `runestone dns enable`, which is where the change is disclosed and consented to.
- `runestone stop --all` stops the dns service as well. Plain `runestone stop` deliberately leaves it running, because the Docker daemon points at it and stopping it would break name resolution for every container on the machine.
- `runestone doctor` now reports the DNS state when DNS is on: whether Runestone's entries are still first in the Docker daemon, whether the dns service is running, whether the Target IP still matches, and whether the domain mappings are current. It reports only and never edits the daemon configuration.

### Changed

- Certificate, service and setup changes now restart only the `runestone` container instead of every service in the Runestone project, so other services keep running.
- `runestone up` now starts the dns service alongside everything else when DNS is on, reconciles a changed Target IP, regenerates the domain mappings when your certificates changed, and warns if something has been inserted ahead of Runestone in the Docker daemon DNS list. It never restarts Docker on its own — a change it writes takes effect at your next Docker restart, and it says so.
- `runestone certs create` and `runestone certs remove` now regenerate the DNS domain mappings when the set of certificate-covered domains actually changed.
- `runestone down` now removes Runestone's Docker daemon DNS entries before tearing anything down, and aborts without removing anything if that fails. Otherwise the daemon would be left pointing at a container that no longer exists.
- Upstream DNS is now detected from the Docker daemon configuration and the host's own resolvers before falling back to `1.1.1.1`, instead of always using `1.1.1.1`. On a network that only permits internal resolvers, container lookups no longer go to a public resolver.
- `compose.yml` is now regenerated when Runestone's template changes, so an upgrade no longer leaves you with an outdated Compose file. The file already on disk is kept as a `.bak` beside it first.
- `runestone doctor` now exits non-zero when a DNS check fails, instead of reporting the failure and then signing off as passed. It says the host environment is fine and that nothing needs installing, rather than sending you to install something.

### Fixed

- Fixed the Docker daemon configuration path comparison on Windows, where `C:/x/daemon.json` and `C:\x\daemon.json` are the same file. They were treated as different files, which could make `runestone dns disable` refuse to remove an entry that really was Runestone's, while printing two paths that look identical.

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
