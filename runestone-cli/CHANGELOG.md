# Changelog

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
