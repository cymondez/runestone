Goal:
Fix runestone-cli certificate/domain setup and interactive setup behavior according to DESIGNE.md plus the referenced Makefile targets, without copying Makefile execution.

Success criteria:
- `runestone certs create <DOMAIN>` creates wildcard `*.DOMAIN` certificate files as `<domain>.crt` and `<domain>.key`.
- `runestone certs create <DOMAIN>` also creates a matching Traefik TLS dynamic config and validates an existing config before reusing it.
- `runestone certs remove <DOMAIN>` checks and removes both certificate files and the matching TLS dynamic config.
- Windows certificate/config changes restart the running compose container.
- `runestone setup` loads existing settings as defaults, asks detailed grouped prompts, checks port availability, asks local CA install immediately before cert generation, and asks whether to restart if settings changed.
- Unit and integration tests cover the changed behavior.
- A real Windows side-effect smoke test is run after code verification.

Current context:
- CLI implementation exists under `runestone-cli`.
- Compose mounts `./certs:/ssl` and `./configuration:/configuration`.
- Makefile reference for dynamic TLS config is `traefik/dynamic/<domain>.ssl.yml` with `/ssl/<domain>.crt` and `/ssl/<domain>.key`.

Constraints:
- Do not add hidden automation flags or bypass interactive setup for acceptance.
- Do not directly invoke or copy Makefile targets.
- Preserve user changes in the dirty worktree.
- Use `@mkcert/node`, not mkcert CLI.

Risks:
- Real cert generation can touch local CA/trust state.
- Real Docker restart changes running containers.
- Ports 80/443 may be occupied by the current runestone container during setup re-runs.

Approval required:
- Any real trust-store, Docker restart, or live `~/.runestone` side-effect command must run with explicit escalation.

Workflow artifact path:
`.workflow/runestone-cli-certs-and-setup-rework`

Work packets:
- Discovery: read DESIGNE.md, Makefile cert targets, current setup/certs implementation, compose layout, and tests.
- Implementation: cert-manager service, certs command flow, compose restart, setup prompts and change detection.
- Tests: unit tests for certificate service, setup prompt helpers, compose restart; integration updates for CLI side effects with fake Docker.
- Acceptance: build/test locally, then run live Windows smoke checks against the actual Runestone path.

Integration policy:
Keep edits scoped to `runestone-cli`; prefer shared services over duplicate command logic; update tests only for behavior changed by this task.

Verification:
- `npm test`
- `npm run build`
- Live Windows CLI smoke: create/remove a throwaway domain and confirm files/config/restart behavior.

Reusable artifacts:
Final report records commands, outputs, and any skipped checks.
