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
| M0 | Safety rails | 0 | T0 | — | **done** |
| M1 | Daemon ownership engine | 0 | T0 | M0 | **done** |
| M2 | runestone-dns image | 1 | T1 | — | **done**, amd64 and arm64 both 32 of 32 |
| M3 | Service plumbing and `dns status` | 0 | T1 | — | **done** |
| M4 | `dns disable` | 2 (redirected) | T0 | — | **done** |
| M5 | `dns enable` to `prepared` | 2 | T1 | — | **done**, real-machine gate items pending the 16.5 safety net |
| M6a | End to end in the dind harness | 2 host / 3 sandbox | T2 | — | **done**, CI gate pending a runner |
| M6b | Real machine and VM verification | 3 | T3 / T4 | — | **Done**: both halves, Windows and Linux, with evidence |
| M7 | Lifecycle integration and disclosure | 3 | T1 / T2 | — | **done** |
| M8 | Platform matrix and release | 3 | T3 / T4 | M6b, M7 | **in progress**: 6.2's decision table, the user documentation and the 14.3 platform matrix are all closed (four rows verified, two deferred for lack of hardware); **only the image publish remains** |

M2 is independent of M1 and can run in parallel with it. Everything else is a chain.

## Decision gate

The four items in spec 15 have milestone deadlines (spec 16.6). A milestone must not start while its blocking decision is open. **All four are now settled.**

| Decision | Deadline | Status | Cost of deciding late |
| --- | --- | --- | --- |
| 3 — fallback DNS in dnsmasq's upstream or in the daemon array | before M1 | **settled: both** — the dnsmasq upstream is mandatory and never empty (spec 8.4), the daemon-array fallback is optional and off by default (spec 9.7) | Settled in time. `insertedEntries` is an array of owned entries, which M1 implements from the start |
| 2 — how the image is built and published, its name and initial tag | before M2 | **settled for now: a committed buildx script**, `cymondez/runestone-dns:1.0`. Publishing from CI is deferred, not abandoned — the registry token takes time M2 should not wait on. **CI itself is Drone**, against the self-hosted Gitea that is `origin`; a GitHub Actions workflow is kept for the mirror | Settled in time. The debt is traceability: a hand-run publish is reconstructable only because the script is in the repository |
| 4 — `compose.yml` regeneration strategy | before M3 | **settled: automatic**, driven by `COMPOSE_TEMPLATE_VERSION` in `.env`, and a file the user hand-edited is backed up beside the original before being overwritten | Settled in time |
| 1 — whether `docker desktop restart` exists | before M6b | **settled: it exists** (CLI plugin `v0.4.3`, synchronous unless detached), and both the detection and the manual fallback stay — the plugin is versioned separately from Docker Desktop, so an older installation will not have it | Settled in time, by measurement rather than by assumption |

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

- [x] `npm test` green — 41 suites, 522 passed, 1 skipped. The Windows integration failure is fixed; see the note below
- [x] No unscoped `docker compose restart` remains in the source
- [x] Dynamic-config changes restart only `runestone`

**Landed.** `composeService.restart()` now takes a mandatory service list, so an unscoped restart cannot even be expressed; service names come from `COMPOSE_SERVICES`, and a test asserts the generated compose file actually declares every name in it. `runestone-cli/src/services/dns/daemon-target.ts` resolves the daemon configuration path and the Docker restart command in one place and honours both 7.4 overrides — it only resolves, and nothing calls it yet. The safety net is in `AGENTS.md` under "DNS Feature Rules", next to the override and restart-scope rules.

Two things were left open deliberately:

- **`npm test` is now green**, and the Windows integration failure that predated this milestone is fixed. `runestone-cli/tests/integration/execution.test.ts` intercepts Docker with a `docker.cmd` shim on `PATH`, and **Node resolves a bare command name without consulting `PATHEXT`** — so the shim was invisible to it, and it walked straight past to the real `docker.exe` further along `PATH`. The consequence was worse than the red result: the fake Docker had never been exercised on Windows at all. The fix is in the test, not in production code: the CLI is given a `PATH` containing the fake directory and nothing that could shadow it, so `spawnCommand` gets `ENOENT` and takes its existing shell retry, which does consult `PATHEXT`. 41 suites, 522 passed, 1 skipped.
- **The WSL row of 6.2 cannot be resolved offline.** `platformDaemonPath()` needs the Windows-side home directory, which is only knowable by inspecting the Docker context, so it throws and names `RUNESTONE_DNS_DAEMON_PATH` rather than guessing a path to write to. M5 must supply it at the point where it already inspects the context. (**This was overturned twice; the settled answer is in M8.** The row was first deleted outright in M6a, then came back in M8 as row 2 of 6.2's decision table. It now neither throws nor guesses: `platformDaemonPath()` returns an empty string for `elsewhere`, and preflight refuses with an accurate reason.)

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

- [x] Spec 14.4 green on both architectures — **amd64 32 of 32, arm64 32 of 32**, after registering QEMU emulation
- [x] **All verification performed on a port other than 53**, so this milestone never fights the host for port 53
- [x] Tamper resistance: editing the two Runestone-owned files inside the container and restarting restores both, and leaves `custom.conf` untouched
- [x] Mapping rules: one `address=` per `DNS:` name read from the certificate, `rootCA.crt` excluded by name, invalid domains excluded, unparseable files skipped, duplicates collapsed, empty directory still starts

**Landed.** `docker/dns/` now holds `Dockerfile`, `entrypoint.sh`, `publish.sh`, `README.md` and `test/verify-image.sh`. Verification on amd64: **32 checks, 32 passing.**

The verification script deliberately avoids two things. It **never uses port 53** — the service is published on 15353 — so the milestone that builds the image is not the milestone that first contends for the real DNS port. And it **uses no host paths**: the fixture `/ssl` directory is a Docker volume populated by a helper container, so it behaves identically in Git Bash on Windows and in a Linux shell. (That second choice earned itself: an earlier draft passed a container path directly to `docker exec`, and MSYS rewrote `/etc/dnsmasq.d/custom.conf` into `C:/Program Files/Git/etc/dnsmasq.d/custom.conf`. Every container-side path now lives inside `sh -c`.)

Two findings worth carrying:

- **The spec's webproc invocation was wrong, and 8.1 has been corrected.** `--config` does not exist in webproc 0.4.0; the writable-configuration flag is `--configuration-file` (`-c`). `--port`, `--user` and `--pass` do exist. Two improvements came out of checking: `--restart-watch` makes a change to `custom.conf` *on disk* restart dnsmasq, which covers a user editing their own file with an editor rather than through the UI; and `HTTP_USER` / `HTTP_PASS` are passed as environment variables rather than flags, because a password on the command line appears in the container's process list. This is exactly the open item 8.1 asked to be confirmed at build time — one of the four assumed flags did not survive contact.
- **arm64 is built and verified: 32 of 32, the same as amd64.** It needed QEMU emulation registered in the kernel the Docker daemon runs on — `docker run --privileged --rm tonistiigi/binfmt --install arm64`, reversible with `--uninstall`. Worth recording, because `publish.sh` used to offer a second remedy that does not work on its own: a freshly bootstrapped `docker-container` builder reported only `linux/amd64` and `linux/386` here, so that driver helps when the docker driver is the limitation and not when the emulators are missing. The script now says so.

**Carried debt.** The publish path is a script a maintainer runs, so nothing records what produced a published tag beyond the script being in the repository. CI replaces it later; until then, a published tag and the commit it was built from have to be associated by hand.

**Rollback.** Single revert. An unreferenced published tag is harmless.

## M3 — Service plumbing and `dns status`

**Goal.** Everything needed to run the service, plus the read-only command that every later milestone uses to diagnose itself. The feature is still off.

**Risk level 0 · Tier T1**

**Deliverables**

- [x] `.env` fields per spec 7.1, absent meaning disabled
- [x] Compose template gains the `dns` service under profile `dns` (spec 8.2), with the image and tag written literally
- [x] Versioned `compose.yml` regeneration in `runestone-cli/src/utils/project-files.ts` per decision 4 (spec 13)
- [x] `dns/custom.conf` created when missing, before the service is ever started (spec 8.3)
- [x] `configuration/dns/dns-ui.yml` generated and removed by the CLI (spec 8.5)
- [x] Remove the `{{ if env "DNS_ENABLE" }}` blocks from `docker/traefik/dynamic/traefik.dynamic.yml` and `start_dnsmasq()` from `docker/traefik/entrypoint.sh` (spec 13)
- [x] `runestone dns status`, read-only, reporting everything in spec 10.3
- [x] `runestone-cli/src/i18n/index.ts` — `en` / `zh-TW` / `ja-JP` strings for everything added so far

**Gate**

- [x] With `DNS_ENABLE=false`, `up` / `stop` / `down` behave exactly as they do today — regression tested, not eyeballed
- [x] `status` correctly reads hand-crafted daemon files covering every state in spec 9.5, including our entry displaced, duplicated, altered and removed
- [x] `status` writes nothing, proven by test
- [x] `status` reports loudly when a spec 7.4 override is active
- [x] Existing installations upgrading to this version see no behaviour change

**Test coverage added.** 338 unit tests, all green: the generated Compose file is now parsed as YAML rather than pattern-matched (a mis-indented conditional block would otherwise surface only as a `docker compose` error on a user's machine), every regeneration path has a test including "never overwrite an existing backup", every state of spec 9.5 is asserted through `dns status`, and both the report builder and the command are proven to leave the daemon file and its directory byte-identical.

**Landed.** The service can be run and diagnosed, and the feature is still off.

| Added | What it does |
| --- | --- |
| `.env` fields (spec 7.1) | Ten DNS keys, all defaulted to off or empty, with an absent `DNS_ENABLE` meaning disabled |
| Compose `dns` service (spec 8.2) | Behind `profiles: [dns]`, image and tag written literally, port 53 on `DNS_BIND_IP` for both protocols |
| Versioned regeneration (spec 13) | `ensureProjectFiles()` regenerates `compose.yml` when the template version differs, backing up what was there |
| `dns/custom.conf` | Created when missing, never overwritten |
| `configuration/dns/dns-ui.yml` | Generated and removed by the CLI (spec 8.5) |
| `runestone dns status` | Read-only, reporting everything in spec 10.3 |
| i18n | 56 keys in `en` / `zh-TW` / `ja-JP` |

Removed from the runestone image, per spec 13: the `{{ if env "DNS_ENABLE" }}` blocks in `docker/traefik/dynamic/traefik.dynamic.yml` and `start_dnsmasq()` in `docker/traefik/entrypoint.sh`. Nothing dnsmasq-shaped remains in that image.

**`syncDnsUiRoute()` exists but is deliberately not called from `up`.** Section 16.3 says no existing command path may call into DNS code before M6a, so that each milestone stays revertible on its own; the lifecycle wiring is M7's job.

Three spec deviations, all amended in the specification rather than left as surprises in the code:

- **The template version marker lives in the Compose file's own header, not in `.env`.** Spec 13 suggested `.env`, which turned out to be a trap: `envLoader.write()` regenerates `.env` from parsed key-value pairs, so recording the marker there would have dropped every comment in the user's environment file on an ordinary `up`. A header comment travels with the file it describes, is per-project, and cannot drift from it.
- **`DNS_CONTAINER_RESOLVER` is new (spec 7.1, 8.2).** Spec 8.2 requires the dns service to set `dns:` explicitly so the daemon setting cannot point the container at itself. Compose cannot expand a comma-separated `DNS_UPSTREAM` into a YAML sequence, and baking the list into the template would tie an upstream change to a Compose regeneration. One dedicated key, defaulting to `1.1.1.1`, answers it. The stakes are low — the image already runs dnsmasq with `no-resolv`, so this is defence in depth rather than the actual loop guard.
- **`preparedReason` is new (spec 7.3).** Section 12 requires `status` to distinguish a deliberate `--no-restart` from the residue of a failed rollback, and nothing in the 7.3 record could carry that. It is optional, so it does not change `schemaVersion`; `status` reports "not recorded" when it is absent rather than guessing.

**Rollback.** Single revert. Note that the traefik template and entrypoint removals are a change to the runestone image; if that image ships separately, sequence it so an old CLI never meets a new image expecting CLI-generated routes.

## M4 — `dns disable`

**Goal.** The escape hatch, built before the trap. If enable landed first and misbehaved, there would be no tool to clean up with.

**Risk level 2 (redirected path only) · Tier T0**

**Deliverables**

- [x] `runestone dns disable` implementing spec 9.2 and 10.2
- [x] `--assume-entry <ip>` and `--assume-index <n>` (spec 9.3)
- [x] `--dry-run` printing the before/after diff and writing nothing (spec 10.2)
- [x] Ownership-conflict paths abort with the daemon path and manual recovery steps, never a guess
- [x] `runestone-cli/tests/commands/` entry-point tests

**Gate**

- [x] Revokes an entry planted by hand with **no ownership record**, via `--assume-entry`
- [x] Every failure row in spec 12 that ends in "abort" actually aborts without writing
- [x] Our entry already removed by the user is treated as revoked: file untouched, state cleared, no error
- [x] All of it exercised against `RUNESTONE_DNS_DAEMON_PATH`, with the platform daemon file provably untouched
- [x] `--dry-run` output matches what a real run then produces

**Landed.** `runestone dns disable`, with 53 tests behind it.

The command is built as a **plan and an application**, so `--dry-run` is not a second implementation that could drift from the real one: the dry run prints the plan, and a real run applies that same plan. A test asserts the two outputs match line for line.

| Refusal | What it does instead of guessing |
| --- | --- |
| No ownership record, nothing asserted | Names the file and tells the user how to state the entry: `--assume-entry <ip>` |
| Several items match our value | Lists the clashing positions and asks for `--assume-index <n>` |
| The record was written against a different file | Refuses to touch a file it did not write |
| The daemon JSON is invalid | Aborts without writing, and says what is wrong with it |

Each of those has a test proving the file on disk is byte-identical afterwards.

Three properties worth stating, because each is a decision rather than an accident:

- **Nothing changed means nothing restarted.** When the user has already removed our entry by hand, the file is left alone and Docker is **not** restarted — restarting would terminate every container on the machine in order to apply nothing at all. The rest of the cleanup still runs and the record is cleared, which is what spec 9.5 asks for.
- **The lock is held for the write, not across the confirmation prompt.** A user who walks away from a prompt must not block every later run. The plan is therefore rebuilt inside the lock and compared with the one that was shown; if the file changed in between, nothing is written and the user is told to look again. "What you were shown is what happens" is checked rather than assumed.
- **The diff marks positions, not values.** Comparing values would be wrong exactly where it matters most: when the user has duplicated our address, only one of two identical lines is ours, and the diff has to show which. An earlier draft got this wrong and a test caught it.

Also added on the way: `composeService.removeServices()` with Compose profile support, since removing the dns service requires naming its profile (spec 8.2).

**Verified end to end against a redirected daemon file** — a hand-planted entry with no ownership record, removed via `--assume-entry`: the user's own entry kept its value and position, the `builder` block with its nested inline object came through byte-identical, `.env` was flipped to `DNS_ENABLE=false`, and the dns service removal failed (no Compose file in the scratch project) and **said so** rather than reporting success. The platform `daemon.json` was confirmed untouched.

Running it also caught a real defect that no unit test would have: with a blocker, the plan was printed first, so "Nothing to change" appeared above the error — reading as if the array were empty when the point was that Runestone does not own what is in it. Blockers are now printed instead of the plan.

**Rollback.** Single revert.

## M5 — `dns enable` to `prepared`

**Goal.** The complete enable path except the restart. This is the first milestone that writes a real `daemon.json`, and because it does not restart, the write has no effect on the machine while it is being rehearsed.

**Risk level 2 · Tier T1**

**Complete the 16.5 safety net before starting this milestone.**

**Deliverables**

- [x] `runestone dns enable` steps 1–4 of spec 10.1: preflight that changes nothing, `.env` and project files, dns service start, real query verification from a throwaway container, ownership state, atomic daemon write
- [x] `--no-restart` stopping deliberately at `phase=prepared` (spec 10.1, 11.1) — the flag landed with M6a and was used against a real daemon file in M6b
- [x] `--dry-run` performing preflight only, then printing the diff and exiting
- [x] Target IP rotation (spec 9.4) and the reconciliation path (spec 9.5)
- [x] Rollback on every failure, and `phase=prepared` retained with manual recovery output when the rollback itself fails
- [x] Risk disclosure for the daemon-modification confirmation, carrying real values (spec 11.3)

**Gate**

- [x] On a real machine: `enable --no-restart` → inspect the diff → `disable` → the daemon file is **byte-identical** to the pre-M5 snapshot — **done on Linux**, where the whole cycle including a real `systemctl restart docker` left the machine with no `/etc/docker/daemon.json`, exactly as it was found (spec 9.2 step 4: Runestone created the file, so removing its entry removed the file). On Windows the enable and the diff are done against the real file with existing keys preserved. **The byte-identical claim needs restating for Docker Desktop**: it rewrites `daemon.json` itself, reordering keys and reformatting arrays, so the invariant holds across Runestone's own operations and not across a Docker Desktop restart in between
- [x] The same cycle with a hand-added user entry present: that entry survives untouched — at the command level
- [x] Preflight failure leaves no `.env`, service, state or daemon change behind
- [x] Verification failure at step 3 stops the service and restores `.env`, with the daemon file never opened for writing
- [x] `--dry-run` writes nothing, proven by comparing file contents before and after
- [x] Disclosure output contains the actual daemon path, Target IP and Bind IP — no placeholders, verified against this machine

**Landed.** `runestone dns enable` through step 4 of spec 10.1, stopping at `phase=prepared`. 62 tests.

**The order of the steps is the safety property.** The daemon configuration is written last and undone first, so every way this can fail — Docker unavailable, a remote context, Windows containers, the service not starting, the service starting but not answering — fails while the machine's global DNS is still untouched. Three tests assert exactly that: on a service-start failure, a verification failure, and a daemon-write failure, `writeDaemon` is never called and `.env` is restored.

The ownership record is written **before** the file. An entry in the array with no record of it is an orphan nobody can revoke; a record with nothing in the file is merely wrong, and `disable` already handles that.

Three deliberate departures from the deliverable list, each for a stated reason:

- **`--no-restart` is not implemented, and deliberately not accepted.** In this milestone `enable` always stops at `prepared`, so a flag naming the only behaviour there is would claim the user has a choice they do not have. It lands with the restart itself in M6a. The behaviour the flag names is what the command does today.
- **The real-machine gate items are not ticked.** A real `enable` binds host port 53, which is risk level 3 — above this milestone's level 2 — and the 16.5 safety net is the maintainer's step, not something the implementation can do for them. What *is* proven: the byte-identical enable-then-disable round trip, at the command level with real file I/O, across three array shapes including one with a pre-existing user entry.
- **`--dry-run` was run against the real `~/.docker/daemon.json`**, which is read-only and therefore level 0. It confirmed all eleven disclosure items print real values from this machine: the actual daemon path, the Target IP resolved from inside Docker (`192.168.65.254`), the Bind IP, the UI URL and the upstream list.

That real run earned its keep by exposing a defect no unit test would have caught. Item 10 reported the upstream as `1.1.1.1` **sourced from `.env`** — but the user's `.env` has no such key. The loader's own default was masquerading as a choice the user had made, so **spec 8.4's detection step could never run**. On a network that permits only its own internal resolvers, every container lookup on the machine would have been forwarded to a public resolver instead, silently. The loader now leaves `DNS_UPSTREAM` empty, the never-empty guarantee lives where it belongs, and spec 8.4 has been corrected — it had asserted both "1.1.1.1 is the shipped default of `DNS_UPSTREAM`" and "detection is still tried ahead of the public default", which cannot both be true. Host-resolver detection (`dns.getServers()`, the second source in 8.4) was missing as well and is now wired in, with the systemd-resolved stub filtered out.

**Rollback.** Single revert, plus `dns disable` on any machine where enable was run.

## M6a — End to end in the dind harness

**Goal.** Prove the full cycle including the daemon restart, inside a sandbox whose blast radius is one container — so that a contributor without a virtual machine can do it, and so that CI can do it repeatedly.

**Risk level 2 on the host, 3 inside the sandbox · Tier T2**

**Deliverables**

- [x] `docker/dns/test/` — the harness from spec 14.5, plus instructions for reproducing this milestone without a virtual machine
- [x] Full cycle inside the harness: preflight → write → restart → resolv.conf → wildcard resolution → disable → file restored
- [x] A deliberately injected restart timeout, proving the rollback actually rolls back
- [x] The harness wired into CI — `.drone.yml` (Drone against the self-hosted Gitea) and `.github/workflows/dns-harness.yml` for the mirror, both calling the same scripts

**Gate**

- [x] The full cycle passes inside the harness
- [x] The injected restart timeout results in the daemon file being restored, not a half-applied state
- [x] `restart: unless-stopped` brings dnsmasq back after the sandbox daemon restart with no CLI involvement
- [x] The host's daemon file and containers are provably untouched by the whole run
- ~~It passes in CI, not only locally~~ — **dropped on 2026-08-30; this pass condition is withdrawn.** The pipeline files stay in version control (`.drone.yml`, `.github/workflows/dns-harness.yml`), but no runner points at this repository and none is planned. The harness itself remains normative: `docker/dns/test/dind-harness.sh`, run locally by the maintainer, 13 checks passing. **State the cost plainly**: with no automated gate these checks run only when someone remembers to run them, and a regression will slip through quietly

**Landed.** `docker/dns/test/dind-harness.sh`, 13 checks, all passing.

The daemon inside the sandbox runs under a small supervisor loop rather than as the container's entrypoint. **That is the whole trick**: killing it is a real daemon restart, and the container — with the CLI and the checks running inside it — survives to observe the result. A pause file lets the harness also make the daemon *not* come back, which is how the rollback-on-timeout path is exercised in seconds instead of the two minutes the real poll limit would take.

One run proves: the Target IP resolved from inside Docker, the daemon configuration written, a real restart, a new container given our address as its first nameserver, a wildcard subdomain resolving, `restart: unless-stopped` bringing dnsmasq back after a bare daemon restart with no CLI command involved, an injected restart failure restoring the file rather than leaving it half-applied, and `disable` returning the file to its starting state. The host's own daemon configuration and container list are asserted untouched at the end.

**Nothing is bind-mounted into the sandbox.** A bind mount is resolved by the *daemon*, so a path that exists where the script runs need not exist where the daemon does — which is exactly the situation in CI, where the step is itself a container. Files go in over the Docker API instead, so the harness does not care whose daemon it is talking to.

**The harness earned its keep on its first run**, by catching something no unit test would have: `isWsl()` returned true inside the sandbox. Docker Desktop runs its Linux VM on WSL2, so every container on it reports a Microsoft kernel — the string that was supposed to identify WSL identifies an ordinary Linux container just as well, and the daemon path went hunting for a Windows drive from inside a container.

**The WSL row of spec 6.2 was removed rather than fixed.** Two reasons, and the second settles it:

- Windows support means running the CLI **on Windows**. Whether the user's Docker happens to live in WSL is Docker Desktop's business. A supported path nobody runs and nobody can test is worse than no path at all.
- The detection it needed cannot work. The kernel string is identical for WSL and for any container on Docker Desktop, so there is nothing to detect *with*.

The risk that row guarded is real and is still handled, by asking a question that has a reliable answer: **if `docker info` reports the daemon as Docker Desktop while the CLI is running on Linux, preflight refuses.** That daemon's configuration is on the Windows side, so writing this filesystem's `~/.docker/daemon.json` would report success while changing a file Docker never reads — the exact silent-wrong-answer failure this feature exists to remove. `isWsl()` was dead code before M0 revived it, and is deleted.

**That conclusion was overturned in M8.** The text above is kept because what was wrong was the reasoning rather than a slip, and each of the two reasons was half wrong:

- The first treats "what the daemon is" and "where the CLI runs" as one question. They are two, and **every platform can be a plain Docker Engine and every platform can be Docker Desktop**: Windows can run docker-ce inside WSL2 and nothing else, macOS has Colima and Lima, Linux has Docker Desktop for Linux.
- The second was measured in the wrong place. The observation that `isWsl()` returned true came from **inside the sandbox container** — Docker Desktop's VM runs on WSL2, so of course nothing there can be told apart. Where the CLI actually runs is the user's own userland, and there `WSL_DISTRO_NAME`, `/run/WSL` and `/proc/version` are three signals that do measure and do separate (spec 6.2).

The refusal rule it left behind is therefore wrong: "Docker Desktop daemon plus a CLI on Linux, refuse" **refuses Docker Desktop for Linux too**, and tells those users their configuration is on a Windows side they do not have. The replacement is 6.2's decision table, with `isWsl()` back and doing one job — separating row 2 from row 3. See M8 and commit `66c5082`.

**Rollback.** Single revert. This is the last milestone with that property.

## M6b — Real machine and VM verification

**Goal.** Cover what the harness cannot: Docker Desktop's addressing and restart mechanism, Linux privilege escalation and systemd-resolved, and a genuine port 53 conflict.

**Risk level 3 · Tier T3 / T4 · Maintainers only**

**This is the only milestone that deliberately interrupts a working machine.** Schedule it. Save `docker ps -a` first (see the checklist below). Everything else has already been proven by M6a.

**Deliverables**

- [x] Docker Desktop: Target IP `192.168.65.254` confirmed, the all-interfaces bind published and answering, and `docker desktop restart` confirmed present — the restart itself is not yet exercised
- [x] Native Linux: `/etc/docker/daemon.json` with sudo, systemd-resolved holding `127.0.0.53`, `systemctl restart docker`
- [x] A real port 53 conflict exercised, confirming the spec 6.1 rule that port availability is decided by starting the service and not by reading netstat — netstat said taken, TCP said free, and only starting it gave the answer
- [x] Evidence committed under `docs/evidence/dns/` — Windows and Linux

**Gate**

- [x] Enable → a new container's `resolv.conf` lists the Target IP first → a certificate-covered subdomain resolves to the Target IP — **done on the real machine**: `nameserver 192.168.65.254` first and the 9.7 fallback second, with all four certificate domains and their wildcards resolving through the daemon setting rather than an explicit `@server`. **The `disable` half is not verified after a real restart**: the file operation is proven, but tearing a working configuration down again was not worth another machine-wide interruption
- [x] Sudo failure on Linux aborts with no partial write — measured with a `sudo` that always refuses: it aborts, no file is created, and no debris is left in `/etc/docker`
- [x] The evidence log below is filled in — Windows and Linux

**The Linux half is done, on Ubuntu 26.04 with Docker Engine 29.5.3.** Evidence: [`docs/evidence/dns/m6b-linux-native.md`](evidence/dns/m6b-linux-native.md). The whole cycle ran against the real `/etc/docker/daemon.json`, with two real dockerd restarts, and the machine was left as it was found.

**What the run found is worth more than the pass conditions it was there to tick.**

- **Spec 9.3's elevated write did not exist.** The daemon write was a plain `fs` write with no sudo anywhere in it, so on this machine an ordinary user's `dns enable` could not write the file at all. It is implemented now, keeping both properties of the direct write: the content is validated before elevation is asked for, and the target is only replaced by a rename inside its own directory. Refused elevation aborts, writes nothing and leaves no debris — the pass condition, measured.
- **The safety net was watching the wrong file.** Its default was `${HOME}/.docker/daemon.json` on every platform — Docker Desktop's file — so it would have reported "the machine matches the snapshot" while `/etc/docker/daemon.json` went unwatched. Fixed, along with the elevation it needs to restore a root-owned file.
- **The test suite had never run on Linux**: 4 suites, 28 tests failing. All fixtures inheriting the host's platform, one of which exposed a real wrinkle — `sameDaemonPath` compared a path belonging to another platform using the host's separator rules. 568 pass now, none skipped.
- **A finding I reported and then retracted.** I claimed `address=` answers A only and that the AAAA for the same name leaked to a public address, and added `local=/domain/` for it. **It does not reproduce, and the change is reverted**: `address=/domain/<ipv4>` already makes dnsmasq authoritative for the whole name — everything but A is NODATA — and `local=` changed no record type at all. The error was one of method: the original before/after rebuilt the image *and* recreated the container between measurements, with no control proving forwarding worked.
- **What `traefik.me` actually means, which is the finding worth keeping.** It is a public DNS service that decodes an address out of the name (`10-0-0-5.traefik.me` → `10.0.0.5`). Runestone ships a `*.traefik.me` certificate, so the whole zone is answered with the Runestone host for every container on the machine: `mysite.traefik.me` works because of it (the public answer is `127.0.0.1`, which inside a container is the container), and `<ip>.traefik.me` can no longer reach that IP because of it. Not a bug — what "every certificate domain becomes a mapping" means when the certificate covers a wildcard DNS service. It is in the user documentation now.
- **The `.env` rollback was not what it claimed**: it rewrote keys out of the flag-merged config, so it restored the flag's value rather than the user's, and `DNS_DAEMON_FALLBACK` was not in the list at all. Text in, text out now.

**Both open Windows questions are settled.** `restart: unless-stopped` **does survive a daemon restart** — measured twice, both containers back on their own; what Windows saw was an application restart, which is not the same thing. And `disable` does restore the machine after a real restart: Runestone created the file, removing its entry left `{}`, so the file went with it.

**The Windows half, with Docker Desktop.** Evidence: [`docs/evidence/dns/m6b-windows-docker-desktop.md`](evidence/dns/m6b-windows-docker-desktop.md). **Nothing written to the real daemon file and Docker never restarted** — the same SHA-256 before and after, and the same 17 containers.

**Decision 1 is answered**: `docker desktop restart` exists (CLI plugin `v0.4.3`) and is synchronous unless detached. The detection and the manual fallback both stay, because the plugin is versioned separately from Docker Desktop and an older installation will not have it.

**The milestone earned its keep before it even reached the destructive step**, by finding a bug that would have broken `dns enable` on most Windows machines.

This machine already had a genuine port 53 conflict, arranged by nobody: the Windows Internet Connection Sharing service holds `0.0.0.0:53/udp`, and WSL2 is what turns it on — so this is the default state of a Windows machine running Docker Desktop, not an exotic one. Against that, two spellings of the same intention behave differently:

- `-p 53:53/udp` starts, and a container reaches the service at the Target IP.
- `-p 0.0.0.0:53:53/udp` fails outright with `bind: Only one usage of each socket address`.

**The Compose template wrote the second one.** Spec 6.1 had recorded the ICS observation correctly — but it was measured with the bare form while the implementation spelled the address out, and the two were assumed interchangeable. Reproduced through `docker compose up`, not only `docker run`, which is the layer that actually matters.

Fixed by deriving `DNS_BIND_PREFIX` from `DNS_BIND_IP`: empty for an all-interfaces bind, `<address>:` for an address naming one interface, so a Linux engine still binds the docker0 gateway explicitly. `DNS_BIND_IP` keeps its meaning and its place in disclosure item 4; only the Compose spelling changed. Compose template version 2 → 3.

**A second finding contradicts spec 6.1's stated rationale.** The table says Docker Desktop must bind `0.0.0.0` because no host interface has the Target IP. But with the service published on `127.0.0.1:53` **only**, a container still reached it at `192.168.65.254:53`, with a stopped-service negative control confirming what was answering. `DNS_BIND_IP=127.0.0.1` is therefore a working and tighter configuration on Docker Desktop. It is not made the default: the same has not been measured on macOS, and a default known to work on one of the two Docker Desktop platforms is not a default. That is an M8 platform-matrix row.

**The 16.5 escape hatch was exercised** against a hand-planted entry with no ownership record: refused without `--assume-entry`, removed exactly the named entry with it, left the unrelated entry and the unrelated key untouched.

**The WSL distro on this machine confirmed the refusal that replaced WSL detection.** `Ubuntu-26.04` has systemd, systemd-resolved and the Docker Desktop integration but no daemon of its own, and `docker info` reports `Docker Desktop` from inside it — the exact signal `docker-desktop-elsewhere` keys on, present and correct where the old kernel-string detection could distinguish nothing.

**The safety net is now a script**, `docker/dns/test/m6b-safety-net.sh`, rather than the two `cp` one-liners the checklist used to carry — see spec 16.5. It captures, compares and restores, and it refuses to restart Docker for a daemon file Docker does not read. That guard is not hypothetical: the script restarted a working machine once during its own testing, while operating on a temporary file.

**Two things the machine did that were not on anyone's list**, both found while the safety net was being tested rather than during the milestone proper. Neither is written into the spec yet, because neither has been measured cleanly.

**`unless-stopped` may not survive `docker desktop restart`.** After one, six `unless-stopped` containers were still down thirty seconds later while both `always` containers had returned. If that holds, it matters well beyond tidiness: spec 8.3 leans on `restart: unless-stopped` to bring the dns service back after a Docker restart "with no CLI involvement at all", and M6a confirmed exactly that — but by **killing** `dockerd`, which is a crash, not a graceful shutdown. On this path `completeEnable` would restart Docker, find the dns service gone, fail its resolv.conf and resolution checks, and invert the daemon write. That is the safe direction, and it is also `dns enable` never succeeding on Docker Desktop. The observation is contaminated by `docker start` calls racing the restart, so **the real run has to measure it cleanly**: restart, then watch, and touch nothing.

**Restarting Docker on Windows can strand a port that was published a moment earlier.** While Docker was down, `winnat` claimed TCP 1025–1124 as a dynamic exclusion range, and the `runestone` container could no longer publish 1025 for Mailpit — `netsh int ipv4 show excludedportrange` confirms the range, and releasing it needs an elevated `net stop winnat`. Port 53 is not exposed to this, because the dynamic ranges on this machine begin at 1025, but any port the feature publishes above that is.

**The interruption was attempted and did not complete.** `dns enable --yes --no-restart` wrote the real `~/.docker/daemon.json`, preserving the keys already in it, and `phase: prepared` was proven where it matters: with the entry in the real file, a new container's `resolv.conf` still read `nameserver 192.168.65.7`. The write was real and had no effect, which is the lever this whole plan rests on and had until now only been shown inside dind.

Then `docker desktop restart` **crashed Docker Desktop** — its Inference manager could not re-create its own socket, a path with no connection to DNS, the `dns` array or port 53. Two restarts were run on this machine today; the first completed, the second did this. That is a fact about the mechanism decision 1 settled on: `docker desktop restart` exists, is synchronous, and is not dependable.

The incident validated an ordering by accident: **the inversion writes the file before it restarts.** Docker was down with our entry in the file, and restoring the file while it was down was enough — Docker read the corrected file when it came back. Had the order been reversed there would have been no safe moment to intervene.

**Docker Desktop rewrites `daemon.json` itself**, reordering keys alphabetically and reformatting the array. Element order inside `dns` survived, so identification by recorded index is unaffected — but M1's byte-preservation invariant is a property of Runestone's own operations, not a promise about the file across a Docker Desktop restart.

The safety net did what it exists for: file back byte-for-byte, the discarded diff printed first, no restart attempted against a dead daemon, and the five containers that had not returned started again. The user's own Runestone installation was never in scope — the run used a sandbox project, and the real `.env` and state file are untouched.

**What is left, and why.** The remaining gate items all need a restart that completes: a new container's `resolv.conf` listing the Target IP first, a subdomain resolving through the daemon setting rather than an explicit `@server`, `disable` restoring the array, and whether `restart: unless-stopped` survives a graceful `docker desktop restart`. None is reachable until `docker desktop restart` works on this machine, which is a Docker Desktop problem to resolve first. The destructive cycle needs an agreed window: this machine runs 12 containers, several of them stateful, and a Docker restart terminates all of them. **The native Linux half was completed afterwards, on a VM** (above, and [`m6b-linux-native.md`](evidence/dns/m6b-linux-native.md)): `/etc/docker/daemon.json`, the `sudo` escalation, `systemctl restart docker` and systemd-resolved's `127.0.0.53` are all verified, so what is left here is entirely on the Docker Desktop side.

## M7 — Lifecycle integration and disclosure

**Goal.** Wire DNS into the commands users already run. This is the first point at which an existing command touches DNS code, so it is also the first point at which a DNS defect can affect someone who never ran `dns enable`.

**Risk level 3 · Tier T1 / T2**

**Deliverables**

- [x] `up`, `stop`, `stop --all`, `down`, `certs create`, `certs remove`, `doctor` per spec 10.4
- [x] The four setup questions with their descriptions (spec 11.2), including the upstream keep/replace/append action and the fallback opt-in
- [x] The complete spec 11.3 disclosure matrix — every row but the two documentation ones, which are files rather than moments and belong to M8
- [x] `DNS_AUTO_REORDER` behaviour in both modes (spec 9.6), never restarting Docker
- [x] Full `en` / `zh-TW` / `ja-JP` translations — 461 keys per locale, at parity

**Gate**

- [x] Spec 14.2 green, with one test per row of the spec 11.3 timing table
- [x] Disclosures carry real values, and `--yes` still prints them
- [x] Disclosure item 11 states **both** the benefit and the cost of the 9.7 fallback, and the setup question reads as advice rather than a verdict
- [x] `stop` leaves the dns service running; `stop --all` warns before stopping it
- [x] `down` aborts without destructive cleanup when disable fails
- [x] `certs` changes regenerate mappings only when the domain set actually changed — covered at the service level; the command wiring is one call and is not separately driven, because `certs create` runs mkcert
- [x] `doctor` reports and never auto-corrects
- [x] With DNS disabled, every one of these commands is byte-for-byte unchanged in behaviour

**Landed.** `services/dns/lifecycle.ts` and `commands/dns-notices.ts`, plus the four setup questions. 41 new tests; the unit suite is 515 of 517, with the one failure the pre-existing Windows harness bug of M6a.

**The whole file exists to hold one rule: nothing in a routine command restarts Docker.** `up` may detect that the Target IP rotated, or that something inserted an entry ahead of ours, and in both cases it writes the daemon configuration and stops there — saying, in the same breath, that the change takes effect at the next Docker restart. A command people run several times a day is not allowed to terminate every container on the machine. The ownership record goes back to `phase: prepared` when that happens, because that is precisely what it now is: a written change Docker has not read.

**`stop` deliberately leaves the dns service running.** The daemon still points at it, so stopping it would break name resolution for every container on the machine, including projects that have nothing to do with Runestone. `--all` stops it too, and says both of those things *before* the containers go down — a warning that arrives once DNS is already broken machine-wide is a post-mortem, not a disclosure.

**`down` revokes before it destroys, and aborts if it cannot.** Removing the dns container while the daemon still points at it is the exact failure this feature exists to prevent, so a blocked disable, a restart that did not happen, or an unverified file each stop the teardown with nothing removed.

**Certificate changes ask the container, not a remembered list.** "Did the domain set change" is really "does the running container's `managed.conf` match the certificates on disk", and only the container knows: an image pull, a crash restart or a host reboot all regenerate it with no CLI involved (spec 8.3). A remembered set would drift from all three. When it differs, one service-scoped restart — one container, ours.

**`doctor` reports and never corrects.** Every dependency it uses is a read, and a test asserts the daemon file is byte-identical afterwards. Auto-correcting a `dns` array from a diagnostic is exactly the guessing spec 9.3 forbids: the array holds entries that are not ours, and a diagnostic is the last place that should be deciding which.

**Setup asks the four questions and enables nothing** — see the addition to spec 11.2. It writes the three settings, runs the read-only preflight so an unsuitable machine says so at once, and hands the user to `dns enable`. It never writes `DNS_ENABLE` in either direction: `true` would claim DNS is on with nothing in the daemon configuration, and `false` would silently orphan an entry already there.

**The disclosure matrix is a test per row, not a summary of one.** `tests/commands/dns-disclosure.test.ts` drives every moment in the spec 11.3 timing table, including the four setup questions, which it reaches by driving `runSetup` with the clack prompt classes faked so the rendered descriptions can be read back. The `dns enable` row asserts all eleven items **by number** rather than a sample, and the `--dry-run` and `--yes` paths prove the disclosure survives skipping the prompt.

A companion block asserts the other half of the milestone: with DNS off, `up` starts the project without the profile, `stop` is the unscoped project stop it always was, `down` tears down with no revocation and no restart, and `doctor` says nothing at all.

**Two defects came out of running `doctor` for real, neither of which a unit test would have found.**

The first: **daemon paths were compared byte for byte**, so on Windows `C:/x/daemon.json` and `C:\x\daemon.json` — the same file, differing only in how someone typed it — read as a mismatch. That comparison is what makes `dns disable` refuse to act, so the failure mode was a *false* refusal to remove an entry that really is Runestone's, reported by printing two paths the user reads as identical. `sameDaemonPath()` now resolves both and folds case on Windows only; it was pre-existing in `disable`, and M7 would have spread it to `up` and `doctor`.

The second: **`doctor` reported a failed DNS check and then signed off with "Environment checks passed"**, because its verdict came only from the host tool checks. With DNS enabled a stopped dns service is not cosmetic — the machine's Docker daemon is pointing at it — so a DNS failure now makes `doctor` exit non-zero, with its own outro: the host environment is fine and nothing needs installing, which is the opposite of what the existing failure message tells the user to do.

**Rollback.** Single revert of the wiring commit. The DNS services themselves are untouched by it, so reverting returns the existing commands to their pre-M7 behaviour without disturbing an installation that already has DNS applied.

## M8 — Platform matrix and release

**Goal.** Ship it.

**Risk level 3 · Tier T3 / T4 · Blocked by M6b**

**Deliverables**

- [x] Implement daemon-environment detection per the 6.2 decision table: **ask the daemon and where the CLI runs, stop inferring the type from the platform**; reintroduce `isWsl()` (signals in 6.2); refuse unverified combinations with an accurate reason pointing at 7.4. The gap is in `daemon-target.ts`'s `detectDaemonEnvironment()`, `enable.ts`'s preflight, and `m6b-safety-net.sh`'s `platform_daemon_path()` — **landed** (commit `66c5082`): `classifyDaemonEnvironment()` is the table's five rows as a pure function with a test per row; `DaemonHost` gained `elsewhere`, for which `platformDaemonPath()` **returns an empty string rather than a guess**, read/write/delete all fail loudly on an empty path, and `dns status` prints "Path: unknown"; rows 2 and 5 each refuse with their own message. 575 tests pass on Windows, 580 on the Linux VM
- [x] Spec 14.3 platform matrix completed, with the T4 rows' output committed — rows 2 and 5 done on 2026-08-30 and committed as [m8-daemon-elsewhere](evidence/dns/m8-daemon-elsewhere.md); row 5 covers the remote variant only. The macOS and Docker Desktop for Linux rows lack hardware and carry their deferral reason in the 14.3 table
- [ ] The image published for both architectures **before** the CLI presents DNS as available (spec 13)
- [x] `docs/DNS.md`, `docs/DNS.zh-TW.md` and `docs/DNS.ja-JP.md` — the complete user-facing explanation, one language per file with the same structure, covering disclosure items 1–8, 10 and 11 and the manual removal steps (spec 11.4). 317 lines each, identical structure, every internal anchor checked
- [x] README gains a short paragraph and a link to that documentation, and nothing more: the disclosure is too long to belong in a README — in all three README languages, with the npm copy's links rewritten to absolute URLs by `sync-readme.js`

**Gate**

- [x] Every row of the spec 14.3 table is either done or explicitly deferred with a reason — four done (row 1 Windows, row 2, row 4, row 5 remote variant), two deferred with the reason in the table
- [x] A fresh install and an upgrade from the previous version both behave correctly with DNS off — a fresh project lands on template 3 and `docker compose config --services` lists only `runestone`; a template-2 project regenerates to 3, keeps the original as `.bak`, and re-running is a no-op
- [x] `runestone dns disable` documented as required before removing Runestone — disclosure item 6 in all three user documents, with the by-hand removal steps beside it
- [x] Every language of the user documentation covers the same items — a user warned in their own language can read the explanation in it. Checked mechanically: same heading count and nesting, same tables, same code blocks, all ten disclosure items present in each

## Safety-net checklists

### Before M5 — the first write to a real daemon file

```bash
cp ~/.docker/daemon.json ~/daemon.json.pre-runestone-dns && sha256sum ~/daemon.json.pre-runestone-dns
```

On native Linux the path is `/etc/docker/daemon.json`. If the file does not exist, record that fact — `createdDaemonFile=true` is a distinct revocation path (spec 9.2).

- [x] Snapshot taken and hash recorded, outside version control — `m6b-safety-net.sh capture`, and it was used in anger
- [x] M4's `disable --assume-entry` confirmed working against a hand-planted entry with no ownership record — refused without it, removed exactly the named entry with it, unrelated entry and unrelated key untouched
- [x] The manual recovery path walked once by hand: edit the file, remove the entry, restart Docker — walked under real failure conditions, with Docker down and the entry in the file. Restoring the file while it was down was enough; Docker read the corrected file when it returned

This snapshot is a safety net for the human. It is **not** a Runestone-managed backup: spec 9.3 still forbids whole-file restoration, because restoring the file would discard unrelated edits made in the meantime.

### Before M6b — the one deliberate interruption

```bash
sh docker/dns/test/m6b-safety-net.sh capture
```

That snapshots the daemon file and its hash, the Runestone tool state, and every running container together with its restart policy. `status` compares the machine with the snapshot at any point; `restore` puts the daemon file back, restarts Docker so the restored file is actually read, and starts whatever was running before and is not now.

- [x] Container list saved
- [ ] Nothing long-running or stateful is mid-flight in any container
- [ ] A window agreed, because every container on the machine restarts
- [x] **The restart policy of every running container noted** — `capture` records it and reports how many will not return on their own. Whether `unless-stopped` survives a *graceful* `docker desktop restart`, as opposed to the killed daemon M6a exercised, is still unestablished and is tracked as an M6b item

## Evidence log

M6b and M8 produce findings that cannot be re-derived from the code. Record them here and commit the artefacts under `docs/evidence/dns/`, so the next contributor does not have to re-run a T4 verification in order to trust it.

| Milestone | Platform | Date | Evidence | By |
| --- | --- | --- | --- | --- |
| M6b | Windows Docker Desktop | 2026-08-28 | [m6b-windows-docker-desktop.md](evidence/dns/m6b-windows-docker-desktop.md) — decision 1, Target IP, the ICS port 53 conflict and the `0.0.0.0:53:53` bug, the `127.0.0.1` bind, the revocation escape hatch, the real daemon write with `phase: prepared` proven, Docker Desktop rewriting the file, and `docker desktop restart` crashing. Post-restart verification outstanding | cymondez |
| M6b | Native Linux (VM) | 2026-08-29 | [m6b-linux-native.md](evidence/dns/m6b-linux-native.md) — the full cycle including two real `systemctl restart docker` runs, spec 9.3's elevated write implemented and its refusal path, the safety net guarding the wrong file, the suite's first run on Linux (28 red, one of them a real product defect in `sameDaemonPath`), the retraction of the AAAA-leak finding, and what `traefik.me` actually does | cymondez |
| M8 | WSL2 distro + remote plain engine | 2026-08-30 | [m8-daemon-elsewhere.md](evidence/dns/m8-daemon-elsewhere.md) — 14.3 rows 2 and 5: the actual output of both `elsewhere` refusals, all three `isWsl()` signals true independently, Windows node/npm leaking into the distro through WSL interop and producing false evidence that looks correct, `RUNESTONE_DNS_DAEMON_PATH` disabling the very check being measured, and row 5’s local-socket variant being unreachable on Windows | cymondez |
| M8 | macOS Intel | | **Deferred**: no Mac; reason recorded in the 14.3 table | |
| M8 | macOS Apple Silicon | | | |

## Current state of the repository

Refreshed after M7:

- `docker/dns/` holds M2's image, entrypoint, publish script, README and verification script, plus M6a's dind harness; nothing from commit `3581211` survives in it. `runestone-cli/src/services/dns/` holds the whole engine, and **M7 is the point at which existing command paths began importing it**: `up`, `stop`, `down`, `certs` and `doctor` all reach into `lifecycle.ts` now. Milestones M0 to M6a remain individually revertible; from M7 on, a revert takes the lifecycle wiring with it.
- The dnsmasq and webproc code that commit `3581211` added to the runestone image — `start_dnsmasq()` in `docker/traefik/entrypoint.sh` and the `{{ if env "DNS_ENABLE" }}` blocks in `docker/traefik/dynamic/traefik.dynamic.yml` — was removed in M3 (spec 5.3, 13).
- CI is `.drone.yml`, with `.github/workflows/dns-harness.yml` kept for the GitHub mirror; both invoke the same scripts. **Neither has ever run**, which needs a Drone runner pointed at the repository. Publishing the image is still the committed `docker/dns/publish.sh` and still needs a registry token (decision 2).
- **The `make/` directory is inherited from [druidfi/stonehenge](https://github.com/druidfi/stonehenge) and is void.** Replacing that Makefile-based installation and management flow with the npm CLI is the reason this fork exists (see the README), so nothing in the build or release plan may be derived from it. It is debris, not a baseline — and the image build path decided in decision 2 should fit the CLI's release flow.
