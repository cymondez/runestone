# Runestone DNS Implementation Milestones

English | [正體中文](DNS-MILESTONES.zh-TW.md)

## How to use this document

- **`DNS-FEATURE-SPEC.md` is the normative source.** This document does not restate requirements; it sequences them and records progress. Where the two disagree, the specification wins and this document is wrong.
- **The ordering rule is normative** (spec 16.1): a milestone may raise the risk level by at most one step, and the level below it must be fully green first. The reason is in spec 16.1 — writing `daemon.json` changes nothing until Docker restarts, so almost all of the risk can be deferred to two clearly marked milestones.
- Every milestone is a mergeable increment. Through M6a, `DNS_ENABLE` defaults to false and no existing command path calls into DNS code, so **each milestone can be reverted with a single `git revert`**. This is a hard constraint, not an aspiration.
- Suggested file locations are suggestions. Existing paths are not: where a deliverable names a file that already exists, that file is the one to change.
- Do not tick a gate item on the strength of a test that has not been run.

Risk levels (spec 16.1) and contribution tiers (spec 16.2) are referenced by name throughout and are not repeated here.

## Status board

| # | Milestone | Risk | Tier | Blocked by | Status |
| --- | --- | --- | --- | --- | --- |
| M0 | Safety rails | 0 | T0 | — | **done**, one gate item red for a pre-existing reason |
| M1 | Daemon ownership engine | 0 | T0 | M0 | **done** |
| M2 | runestone-dns image | 1 | T1 | — | **done on amd64**; arm64 unverified, see M2 |
| M3 | Service plumbing and `dns status` | 0 | T1 | M1, M2, decision 4 | not started |
| M4 | `dns disable` | 2 (redirected) | T0 | M1, M3 | not started |
| M5 | `dns enable` to `prepared` | 2 | T1 | M4 | not started |
| M6a | End to end in the dind harness | 2 host / 3 sandbox | T2 | M5 | not started |
| M6b | Real machine and VM verification | 3 | T3 / T4 | M6a, decision 1 | not started |
| M7 | Lifecycle integration and disclosure | 3 | T1 / T2 | M6a | not started |
| M8 | Platform matrix and release | 3 | T3 / T4 | M6b, M7 | not started |

M2 is independent of M1 and can run in parallel with it. Everything else is a chain.

## Decision gate

The four items in spec 15 have milestone deadlines (spec 16.6). A milestone must not start while its blocking decision is open. **Only decision 1 is still open, and it blocks nothing before M6b.**

| Decision | Deadline | Status | Cost of deciding late |
| --- | --- | --- | --- |
| 3 — fallback DNS in dnsmasq's upstream or in the daemon array | before M1 | **settled: both** — the dnsmasq upstream is mandatory and never empty (spec 8.4), the daemon-array fallback is optional and off by default (spec 9.7) | Settled in time. `insertedEntries` is an array of owned entries, which M1 implements from the start |
| 2 — how the image is built and published, its name and initial tag | before M2 | **settled for now: a committed buildx script**, `cymondez/runestone-dns:1.0`. CI is deferred, not abandoned — the registry token and a green workflow take time M2 should not wait on. `origin` is a self-hosted Gitea and GitHub a mirror, so Gitea Actions is the first target when CI lands | Settled in time. The debt is traceability: a hand-run publish is reconstructable only because the script is in the repository |
| 4 — `compose.yml` regeneration strategy | before M3 | **settled: automatic**, driven by `COMPOSE_TEMPLATE_VERSION` in `.env`, and a file the user hand-edited is backed up beside the original before being overwritten | Settled in time |
| 1 — whether `docker desktop restart` exists | before M6b | open | Low. The implementation detects it and falls back to a manual-restart prompt |

## M0 — Safety rails

**Goal.** Make the two operations that touch global state redirectable, and fix the restart scoping defect that DNS would otherwise inherit. No DNS behaviour exists at the end of this milestone.

**Risk level 0 · Tier T0**

**Deliverables**

- [x] `runestone-cli/src/services/docker-compose.ts` — `restart()` becomes service-scoped (spec 10.5)
- [x] Callers updated: `runestone-cli/src/services/dynamic-config-manager.ts`, `runestone-cli/src/commands/setup.ts`, and any other caller found by grep
- [x] `RUNESTONE_DNS_DAEMON_PATH` honoured wherever the daemon path is resolved (spec 7.4)
- [x] `RUNESTONE_DNS_RESTART_CMD` honoured wherever Docker is restarted (spec 7.4)
- [x] `runestone-cli/tests/services/docker-compose.test.ts` — restart passes a service name
- [x] The 16.5 safety-net procedure is written where a contributor will actually find it (this document plus the contributor documentation)

**Gate**

- [ ] `npm test` green — red for a pre-existing reason, see below
- [x] No unscoped `docker compose restart` remains in the source
- [x] Dynamic-config changes restart only `runestone`

**Landed.** `composeService.restart()` now takes a mandatory service list, so an unscoped restart cannot even be expressed; service names come from `COMPOSE_SERVICES`, and a test asserts the generated compose file actually declares every name in it. `runestone-cli/src/services/dns/daemon-target.ts` resolves the daemon configuration path and the Docker restart command in one place and honours both 7.4 overrides — it only resolves, and nothing calls it yet. The safety net is in `AGENTS.md` under "DNS Feature Rules", next to the override and restart-scope rules.

Two things were left open deliberately:

- **`npm test` is not green, for a reason that predates this milestone.** `runestone-cli/tests/integration/execution.test.ts` fails on Windows under Node 20.12 or newer. It intercepts Docker by putting a `docker.cmd` shim on `PATH`, but Node no longer resolves or executes `.cmd` files without a shell, so the shim is skipped, the real `docker` runs with a redirected `USERPROFILE`, and its compose plugin cannot be found. The consequence is worse than the red result: **the fake Docker is never exercised on Windows at all.** Fixing it needs either a documented way to point the CLI at a different Docker binary or an explicit skip on Windows, which is a decision of its own and not a DNS matter. Everything else is green — 161 of 162 tests.
- **The WSL row of 6.2 cannot be resolved offline.** `platformDaemonPath()` needs the Windows-side home directory, which is only knowable by inspecting the Docker context, so it throws and names `RUNESTONE_DNS_DAEMON_PATH` rather than guessing a path to write to. M5 must supply it at the point where it already inspects the context.

**Rollback.** Single revert. The restart scoping fix is worth keeping on its own merit, so this milestone is safe to land ahead of any DNS decision.

## M1 — Daemon ownership engine

**Goal.** The whole of spec 9 as pure functions over JSON text, with no CLI command wired up. Nothing a user can invoke exists at the end of this milestone.

**Risk level 0 · Tier T0**

**Deliverables**

- [x] Ownership engine (suggested `runestone-cli/src/services/dns/daemon-config.ts`): insert, identify, remove, reorder, atomic write with re-parse validation, indentation detection and preservation — over **`insertedEntries` as a list of owned entries** (spec 7.3), not a single entry
- [x] The optional daemon fallback entry (spec 9.7): inserted at `dns[1]`, recorded with its own role, identified independently, and revoked together with the Target IP entry — with one entry in conflict causing neither to be removed
- [x] Ownership state read/write in `runestone-cli/src/utils/tool-state.ts` per spec 7.3, including `schemaVersion`
- [x] Upstream DNS determination (spec 8.4) — **the result is never empty**, with `1.1.1.1` as the last resort — and Bind IP determination per platform (spec 6.1), both pure and injectable
- [x] Tests under `runestone-cli/tests/services/dns/`

**Gate**

- [x] Every row of spec 9.5 has a test
- [x] Both `DNS_AUTO_REORDER` modes tested: `false` produces **zero** file changes; `true` moves only our own entries and never triggers a restart
- [x] Re-entrancy: repeated enable never inserts a second entry of ours
- [x] Write fidelity: indentation style and the order of unrelated keys survive a write
- [x] **Invariant test**: for any sequence of enable → user edit → disable, the values, the count and the relative order of entries we do not own are unchanged — with the 9.7 fallback both off and on
- [x] The upstream list is never empty under any input, including no detection and an empty `DNS_UPSTREAM`
- [x] `npm run test:unit` green, and the engine touches no real file in any test

**Landed.** Four modules under `runestone-cli/src/services/dns/`, 60 + 12 + 24 + 9 tests:

| Module | What it is |
| --- | --- |
| `json-edit.ts` | A structural scanner for JSON text: object and array spans, indentation, newline style |
| `daemon-config.ts` | The whole of spec 9 as pure functions: insert, identify, remove, reorder, reconcile |
| `daemon-file.ts` | The one impure part — read, atomic write with read-back re-parse, delete |
| `upstream.ts` | Spec 8.4 upstream determination and spec 6.1 Bind IP, both pure and injectable |

**The engine edits JSON text rather than re-serialising it.** `JSON.parse` followed by `JSON.stringify` would have been a fraction of the code and would have failed M5's gate: it re-renders the whole document, so a user's inline nested object, their tabs, or their CRLF endings would all be quietly rewritten — which is what spec 9.5 means by "rewriting the formatting is itself a way of damaging the user's edits". Every operation is now a splice, so the bytes we do not own are never re-rendered at all. The byte-identical enable-then-disable round trip is tested across nine document shapes, including tab indentation, CRLF, an inline object, `{}` and a file with no trailing newline.

`--assume-entry` and `--assume-index` turned out to need no engine support: both are just the caller stating the recorded entry it asserts, and identification rule 1 is checked first, so an explicit statement always wins over the ambiguity that made it necessary. Tested at both ends.

Three things to carry forward:

- **A contradiction inside spec 9.5 that needs your ruling.** Identification rule 4 says an entry whose value matches nothing is "removed by the user", and the table row for *"changed the value of our entry"* says the same state is an ownership conflict requiring `--assume-entry`. The two states are **observationally identical** — in both cases our IP is simply absent from the array — so no implementation can tell them apart. The engine follows rule 4 (treat as revoked, change nothing) and additionally reports the value now sitting at the recorded position, so a caller can warn precisely without guessing. If you want the stricter reading instead, it has to become "abort whenever our value is absent", which turns the ordinary *"user deleted our entry"* case into an error the user has to clear by hand.
- **The `dns.lock` serialisation of spec 9.3 is not here.** It guards concurrent CLI invocations, so it belongs with the command layer in M4 and M5, not with pure functions.
- **The atomic-write tests use a temporary directory**, which is the only way to prove rename semantics. No test touches a platform daemon configuration path, and the pure engine is asserted to have no filesystem or process access at all.

**Rollback.** Single revert; nothing imports the engine yet.

## M2 — runestone-dns image

**Goal.** A published multi-arch image that produces a correct dnsmasq configuration on every start, verified without ever contending for port 53.

**Risk level 1 · Tier T1**

**Deliverables**

- [x] `docker/dns/Dockerfile` — Alpine, dnsmasq, pinned webproc selected by `TARGETARCH` (spec 8.1)
- [x] `docker/dns/entrypoint.sh` — regenerate `/etc/dnsmasq.conf` and `/etc/dnsmasq.d/managed.conf` on every start, then exec webproc and dnsmasq (spec 8.3)
- [x] `docker/dns/publish.sh` — `docker buildx build --platform linux/amd64,linux/arm64 --push`, requiring an explicit tag argument rather than defaulting to `latest` (decision 2, interim)
- [x] `docker/dns/test/verify-image.sh` — the 14.4 checks, driven from a throwaway network and a populated volume so that it needs no host paths and never touches port 53
- [x] Image verification tests with a fixture `/ssl` directory
- [x] webproc 0.4.0's `--config`, `--port` and `--user`/`--pass` flags confirmed against the pinned version (spec 8.1)

**Gate**

- [ ] Spec 14.4 green on both architectures — **amd64 only so far**, 32 of 32 checks; arm64 not built, see below
- [x] **All verification performed on a port other than 53**, so this milestone never fights the host for port 53
- [x] Tamper resistance: editing the two Runestone-owned files inside the container and restarting restores both, and leaves `custom.conf` untouched
- [x] Mapping rules: one `address=` per `*.crt`, `rootCA.crt` excluded, invalid domain filenames excluded, empty directory still starts

**Landed.** `docker/dns/` now holds `Dockerfile`, `entrypoint.sh`, `publish.sh`, `README.md` and `test/verify-image.sh`. Verification on amd64: **32 checks, 32 passing.**

The verification script deliberately avoids two things. It **never uses port 53** — the service is published on 15353 — so the milestone that builds the image is not the milestone that first contends for the real DNS port. And it **uses no host paths**: the fixture `/ssl` directory is a Docker volume populated by a helper container, so it behaves identically in Git Bash on Windows and in a Linux shell. (That second choice earned itself: an earlier draft passed a container path directly to `docker exec`, and MSYS rewrote `/etc/dnsmasq.d/custom.conf` into `C:/Program Files/Git/etc/dnsmasq.d/custom.conf`. Every container-side path now lives inside `sh -c`.)

Two findings worth carrying:

- **The spec's webproc invocation was wrong, and 8.1 has been corrected.** `--config` does not exist in webproc 0.4.0; the writable-configuration flag is `--configuration-file` (`-c`). `--port`, `--user` and `--pass` do exist. Two improvements came out of checking: `--restart-watch` makes a change to `custom.conf` *on disk* restart dnsmasq, which covers a user editing their own file with an editor rather than through the UI; and `HTTP_USER` / `HTTP_PASS` are passed as environment variables rather than flags, because a password on the command line appears in the container's process list. This is exactly the open item 8.1 asked to be confirmed at build time — one of the four assumed flags did not survive contact.
- **arm64 has not been built.** Docker Desktop's default builder on the maintainer's machine reports only `linux/amd64` and its variants, and an arm64 build fails at the first `RUN` with `exec format error` — no QEMU handler is registered. The remedies are `docker run --privileged --rm tonistiigi/binfmt --install arm64` or a `docker-container` driver builder; both change state outside this repository, so neither was done. `publish.sh` checks the builder's platform list up front and refuses with those two commands rather than failing deep inside a build. **The gate item stays unticked**: nobody should read this milestone as "verified on arm64" when arm64 has never been compiled.

**Carried debt.** The publish path is a script a maintainer runs, so nothing records what produced a published tag beyond the script being in the repository. CI replaces it later; until then, a published tag and the commit it was built from have to be associated by hand.

**Rollback.** Single revert. An unreferenced published tag is harmless.

## M3 — Service plumbing and `dns status`

**Goal.** Everything needed to run the service, plus the read-only command that every later milestone uses to diagnose itself. The feature is still off.

**Risk level 0 · Tier T1 · Blocked by M1, M2, decision 4**

**Deliverables**

- [ ] `.env` fields per spec 7.1, absent meaning disabled
- [ ] Compose template gains the `dns` service under profile `dns` (spec 8.2), with the image and tag written literally
- [ ] Versioned `compose.yml` regeneration in `runestone-cli/src/utils/project-files.ts` per decision 4 (spec 13)
- [ ] `dns/custom.conf` created when missing, before the service is ever started (spec 8.3)
- [ ] `configuration/dns/dns-ui.yml` generated and removed by the CLI (spec 8.5)
- [ ] Remove the `{{ if env "DNS_ENABLE" }}` blocks from `docker/traefik/dynamic/traefik.dynamic.yml` and `start_dnsmasq()` from `docker/traefik/entrypoint.sh` (spec 13)
- [ ] `runestone dns status`, read-only, reporting everything in spec 10.3
- [ ] `runestone-cli/src/i18n/index.ts` — `en` / `zh-TW` / `ja-JP` strings for everything added so far

**Gate**

- [ ] With `DNS_ENABLE=false`, `up` / `stop` / `down` behave exactly as they do today — regression tested, not eyeballed
- [ ] `status` correctly reads hand-crafted daemon files covering every state in spec 9.5, including our entry displaced, duplicated, altered and removed
- [ ] `status` writes nothing, proven by test
- [ ] `status` reports loudly when a spec 7.4 override is active
- [ ] Existing installations upgrading to this version see no behaviour change

**Rollback.** Single revert. Note that the traefik template and entrypoint removals are a change to the runestone image; if that image ships separately, sequence it so an old CLI never meets a new image expecting CLI-generated routes.

## M4 — `dns disable`

**Goal.** The escape hatch, built before the trap. If enable landed first and misbehaved, there would be no tool to clean up with.

**Risk level 2 (redirected path only) · Tier T0 · Blocked by M1, M3**

**Deliverables**

- [ ] `runestone dns disable` implementing spec 9.2 and 10.2
- [ ] `--assume-entry <ip>` and `--assume-index <n>` (spec 9.3)
- [ ] `--dry-run` printing the before/after diff and writing nothing (spec 10.2)
- [ ] Ownership-conflict paths abort with the daemon path and manual recovery steps, never a guess
- [ ] `runestone-cli/tests/commands/` entry-point tests

**Gate**

- [ ] Revokes an entry planted by hand with **no ownership record**, via `--assume-entry`
- [ ] Every failure row in spec 12 that ends in "abort" actually aborts without writing
- [ ] Our entry already removed by the user is treated as revoked: file untouched, state cleared, no error
- [ ] All of it exercised against `RUNESTONE_DNS_DAEMON_PATH`, with the platform daemon file provably untouched
- [ ] `--dry-run` output matches what a real run then produces

**Rollback.** Single revert.

## M5 — `dns enable` to `prepared`

**Goal.** The complete enable path except the restart. This is the first milestone that writes a real `daemon.json`, and because it does not restart, the write has no effect on the machine while it is being rehearsed.

**Risk level 2 · Tier T1 · Blocked by M4**

**Complete the 16.5 safety net before starting this milestone.**

**Deliverables**

- [ ] `runestone dns enable` steps 1–4 of spec 10.1: preflight that changes nothing, `.env` and project files, dns service start, real query verification from a throwaway container, ownership state, atomic daemon write
- [ ] `--no-restart` stopping deliberately at `phase=prepared` (spec 10.1, 11.1)
- [ ] `--dry-run` performing preflight only, then printing the diff and exiting
- [ ] Target IP rotation (spec 9.4) and the reconciliation path (spec 9.5)
- [ ] Rollback on every failure, and `phase=prepared` retained with manual recovery output when the rollback itself fails
- [ ] Risk disclosure for the daemon-modification confirmation, carrying real values (spec 11.3)

**Gate**

- [ ] On a real machine: `enable --no-restart` → inspect the diff → `disable` → the daemon file is **byte-identical** to the pre-M5 snapshot
- [ ] The same cycle with a hand-added user entry present: that entry survives untouched
- [ ] Preflight failure leaves no `.env`, service, state or daemon change behind
- [ ] Verification failure at step 3 stops the service and restores `.env`, with the daemon file never opened for writing
- [ ] `--dry-run` writes nothing, proven by comparing file hashes before and after
- [ ] Disclosure output contains the actual daemon path, Target IP and Bind IP — no placeholders

**Rollback.** Single revert, plus `dns disable` on any machine where enable was run.

## M6a — End to end in the dind harness

**Goal.** Prove the full cycle including the daemon restart, inside a sandbox whose blast radius is one container — so that a contributor without a virtual machine can do it, and so that CI can do it repeatedly.

**Risk level 2 on the host, 3 inside the sandbox · Tier T2 · Blocked by M5**

**Deliverables**

- [ ] `docker/dns/test/` — the harness from spec 14.5, plus instructions for reproducing this milestone without a virtual machine
- [ ] Full cycle inside the harness: preflight → write → restart → resolv.conf → wildcard resolution → disable → file restored
- [ ] A deliberately injected restart timeout, proving the rollback actually rolls back
- [ ] The harness wired into CI

**Gate**

- [ ] The full cycle passes inside the harness
- [ ] The injected restart timeout results in the daemon file being restored, not a half-applied state
- [ ] `restart: unless-stopped` brings dnsmasq back after the sandbox daemon restart with no CLI involvement
- [ ] The host's daemon file and containers are provably untouched by the whole run
- [ ] It passes in CI, not only locally

**Rollback.** Single revert. This is the last milestone with that property.

## M6b — Real machine and VM verification

**Goal.** Cover what the harness cannot: Docker Desktop's addressing and restart mechanism, Linux privilege escalation and systemd-resolved, and a genuine port 53 conflict.

**Risk level 3 · Tier T3 / T4 · Maintainers only · Blocked by M6a, decision 1**

**This is the only milestone that deliberately interrupts a working machine.** Schedule it. Save `docker ps -a` first (see the checklist below). Everything else has already been proven by M6a.

**Deliverables**

- [ ] Docker Desktop: Target IP `192.168.65.254`, the `0.0.0.0` bind, and whichever restart mechanism decision 1 settles on
- [ ] Native Linux: `/etc/docker/daemon.json` with sudo, systemd-resolved holding `127.0.0.53`, `systemctl restart docker`
- [ ] A real port 53 conflict exercised, confirming the spec 6.1 rule that port availability is decided by starting the service and not by reading netstat
- [ ] Evidence committed under `docs/evidence/dns/`

**Gate**

- [ ] Enable → a new container's `resolv.conf` lists the Target IP first → a certificate-covered subdomain resolves to the Target IP → disable → the daemon `dns` array is back to its original state including pre-existing user entries
- [ ] Sudo failure on Linux aborts with no partial write
- [ ] The evidence log below is filled in

## M7 — Lifecycle integration and disclosure

**Goal.** Wire DNS into the commands users already run. This is the first point at which an existing command touches DNS code, so it is also the first point at which a DNS defect can affect someone who never ran `dns enable`.

**Risk level 3 · Tier T1 / T2 · Blocked by M6a**

**Deliverables**

- [ ] `up`, `stop`, `stop --all`, `down`, `certs create`, `certs remove`, `doctor` per spec 10.4
- [ ] The four setup questions with their descriptions (spec 11.2), including the upstream keep/replace/append action and the fallback opt-in
- [ ] The complete spec 11.3 disclosure matrix
- [ ] `DNS_AUTO_REORDER` behaviour in both modes (spec 9.6), never restarting Docker
- [ ] Full `en` / `zh-TW` / `ja-JP` translations

**Gate**

- [ ] Spec 14.2 green, with one test per row of the spec 11.3 timing table
- [ ] Disclosures carry real values, and `--yes` still prints them
- [ ] Disclosure item 11 states **both** the benefit and the cost of the 9.7 fallback, and the setup question reads as advice rather than a verdict
- [ ] `stop` leaves the dns service running; `stop --all` warns before stopping it
- [ ] `down` aborts without destructive cleanup when disable fails
- [ ] `certs` changes regenerate mappings only when the domain set actually changed
- [ ] `doctor` reports and never auto-corrects
- [ ] With DNS disabled, every one of these commands is byte-for-byte unchanged in behaviour

## M8 — Platform matrix and release

**Goal.** Ship it.

**Risk level 3 · Tier T3 / T4 · Blocked by M6b, M7**

**Deliverables**

- [ ] Spec 14.3 platform matrix completed, with the T4 rows' output committed
- [ ] The image published for both architectures **before** the CLI presents DNS as available (spec 13)
- [ ] README and DESIGN updated with a summary of disclosure items 1–8 and the manual removal steps (spec 11.3)

**Gate**

- [ ] Every row of the spec 14.3 table is either done or explicitly deferred with a reason
- [ ] A fresh install and an upgrade from the previous version both behave correctly with DNS off
- [ ] `runestone dns disable` documented as required before removing Runestone

## Safety-net checklists

### Before M5 — the first write to a real daemon file

```bash
cp ~/.docker/daemon.json ~/daemon.json.pre-runestone-dns && sha256sum ~/daemon.json.pre-runestone-dns
```

On native Linux the path is `/etc/docker/daemon.json`. If the file does not exist, record that fact — `createdDaemonFile=true` is a distinct revocation path (spec 9.2).

- [ ] Snapshot taken and hash recorded, outside version control
- [ ] M4's `disable --assume-entry` confirmed working against a hand-planted entry with no ownership record
- [ ] The manual recovery path walked once by hand: edit the file, remove the entry, restart Docker

This snapshot is a safety net for the human. It is **not** a Runestone-managed backup: spec 9.3 still forbids whole-file restoration, because restoring the file would discard unrelated edits made in the meantime.

### Before M6b — the one deliberate interruption

```bash
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' > ~/containers-before-dns-m6b.txt
```

- [ ] Container list saved
- [ ] Nothing long-running or stateful is mid-flight in any container
- [ ] A window agreed, because every container on the machine restarts

## Evidence log

M6b and M8 produce findings that cannot be re-derived from the code. Record them here and commit the artefacts under `docs/evidence/dns/`, so the next contributor does not have to re-run a T4 verification in order to trust it.

| Milestone | Platform | Date | Evidence | By |
| --- | --- | --- | --- | --- |
| M6b | Windows Docker Desktop | | | |
| M6b | Native Linux (VM) | | | |
| M8 | WSL2 | | | |
| M8 | macOS Intel | | | |
| M8 | macOS Apple Silicon | | | |

## Current state of the repository

Recorded so that M1 and M2 are not mistaken for work already begun:

- `docker/dns/` now holds M2's image, entrypoint, publish script, README and verification script; nothing from commit `3581211` survives in it. `runestone-cli/src/services/dns/` holds M0's `daemon-target.ts` and M1's `json-edit.ts`, `daemon-config.ts`, `daemon-file.ts` and `upstream.ts`. **Nothing outside `tests/` imports any of them yet**, which is what keeps every milestone so far revertible on its own.
- The dnsmasq and webproc code that commit `3581211` added to the runestone image — `start_dnsmasq()` in `docker/traefik/entrypoint.sh` and the `{{ if env "DNS_ENABLE" }}` blocks in `docker/traefik/dynamic/traefik.dynamic.yml` — is still present and must be removed in M3 (spec 5.3, 13).
- There is no multi-arch build and publish path this feature can rely on, and no CI workflow in the repository. Establishing one is decision 2 and blocks M2.
- **The `make/` directory is inherited from [druidfi/stonehenge](https://github.com/druidfi/stonehenge) and is void.** Replacing that Makefile-based installation and management flow with the npm CLI is the reason this fork exists (see the README), so nothing in the build or release plan may be derived from it. It is debris, not a baseline — and the image build path decided in decision 2 should fit the CLI's release flow.
