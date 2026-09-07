# Runestone Agent Support Implementation Milestones

English | [正體中文](SKILL-MILESTONES.zh-TW.md)

## How to use this document

- **`SKILL-FEATURE-SPEC.md` is the normative source.** This document does not restate requirements; it sequences them and records progress. Where the two disagree, the specification wins and this document is wrong.
- **The ordering rule is normative** (spec 16.2): a milestone may raise the risk level by at most one step, and the level below must be fully green first.
- Every milestone is a mergeable increment that **can be reverted with a single `git revert`**. This is a hard constraint, not an aspiration.
- **Phases A, B and C are independently shippable.** Work may stop at the end of any phase and leave a coherent product. A alone delivers the correctness; B removes the need for a human to transcribe anything; C removes the need to parse text.
- Suggested file locations are suggestions. Existing paths are not: where a deliverable names a file that already exists, that file is the one to change.
- Do not tick a gate item on the strength of a test that has not been run.

Risk levels are defined in spec 16.1 and referenced by number throughout.

## Status board

| # | Milestone | Risk | Blocked by | Status |
| --- | --- | --- | --- | --- |
| A0 | Specification and milestones | 0 | — | **in progress**: both English documents landed; the two Traditional Chinese mirrors are deliberately held until the specification stops moving (see A0) |
| A1 | Renderer and topic corpus | 0 | A0 | **done** — 43 suites, 606 passed, 5 skipped, no existing test file touched |
| A2 | Offline snapshot module | 0 | — | **done** — 44 suites, 624 passed, 5 skipped |
| A3 | `--ai-context [topic]` and `--offline` | 1 | A1, A2 | **done** — 44 suites, 630 passed, 5 skipped. First user-visible milestone |
| A4 | Online tier: collision detection | 2 | A3 | **done** — 45 suites, 650 passed, 5 skipped. Phase A complete except the A0 mirrors |
| B1 | Marker-block ownership engine | 0 | — | not started |
| B2 | `skill status` and `install --dry-run` | 1 | A1, B1 | not started |
| B3 | `skill install` and `skill remove` | 2 | B2 | not started |
| B4 | Full target table and wrappers | 2 | B3 | not started |
| C1 | MCP dependency spike | 0 | — | not started |
| C2 | `runestone mcp serve`, read-only | 3 | A2, C1 | not started |
| C3 | `mcp config`, documentation, release | 1 | C2 | not started |
| B5 | User scope | 3 | B4 | **deferred** (spec decision 5) |

A1, A2, B1 and C1 are all risk 0 and independent of one another; they can proceed in parallel. A3 is the first user-visible milestone.

## Decision gate

All six decisions in spec 15 were settled by the repository owner on 2026-09-07, so no milestone is blocked on a ruling.

| Decision | Settled as | Affects |
| --- | --- | --- |
| 1 — corpus localization | English only; operator messages still localized | A1 |
| 2 — MCP SDK or hand-written | SDK, gated by measurement in C1; hand-written fallback if the gate fails | C1 |
| 3 — MCP mutations | Read-only, as a design constraint | C2 |
| 4 — `troubleshoot` topic | In scope | A1 |
| 5 — user scope | Deferred to last; specified so that dropping it costs nothing | B5 |
| 6 — MCP transport | stdio, not HTTP | C2 |

The one measurement that can still overturn a plan is C1's. It is deliberately isolated in a milestone designed to be reverted.

## A0 — Specification and milestones

**Goal.** Write down what to build, why, and in what order, with every factual claim either measured or cited. No code exists at the end of this milestone.

**Risk level 0**

**Deliverables**

- [x] `docs/SKILL-FEATURE-SPEC.md` — 16 sections following the `DNS-FEATURE-SPEC.md` form, including the cost list and the `Cost → Constraint → Section` table
- [x] `docs/SKILL-MILESTONES.md` — this document
- [ ] `docs/SKILL-FEATURE-SPEC.zh-TW.md` — Traditional Chinese mirror
- [ ] `docs/SKILL-MILESTONES.zh-TW.md` — Traditional Chinese mirror
- [x] The install-path landscape measured from vendor documentation and recorded with URLs and a verification date (spec 8.1)
- [x] The `service` field contract measured from the validators rather than the message catalogue (spec 5.2)

**Gate**

- [x] Every claim marked "verified" in the specification was either run or read from a cited source
- [x] The specification names the purpose narrowly enough to exclude installation and configuration (spec 1, 3.2)
- [ ] Both Traditional Chinese mirrors exist with the same section structure

**Landed.** The specification records six things that were wrong in the first draft of the plan and are now measured, each of which would have produced a defect:

| Correction | Consequence had it stood |
| --- | --- |
| `buildDnsStatusReport` is not offline | `docs --ai-context` would spawn Docker twice on a path that must spawn nothing |
| `.agents/skills/` is the neutral location, not `.claude/skills/` | One write covers Codex, Cursor and VS Code; the original design would have written a Claude-only path and called it multi-tool |
| `name` and `description` are required, `description` caps at 1024, `name` must match the directory | A generated skill that fails `skills-ref validate` |
| The logger writes to stdout on `info`, `success` and `debug` | A corrupted MCP protocol stream |
| The project is pinned to node10 module resolution | An SDK import that does not type-resolve, discovered after the tool handlers were written against its types |
| `service.validation.urlNoPath` has no call sites | Agent-facing content stating a rule the code does not enforce |

Two reuse extractions were also identified and are scheduled rather than discovered later: `composeService.ps` needs an optional timeout it does not have, and `traefikApiBaseUrl` is already duplicated across two command files and belongs in `traefik-api.ts`.

**The two Traditional Chinese mirrors are deliberately held back**, and this is a scheduling decision rather than an omission. The DNS specification was revised repeatedly *during* implementation — decision 2 was overturned, section 6.2 was rewritten from platform inference to a daemon-type table, and a whole finding was reverted — because measurement kept contradicting the plan. This specification will move the same way: A1 and A2 each end in a measurement that can change section 5 or section 6, and C1 exists precisely because its measurement may overturn decision 2. Translating now guarantees translating twice. The mirrors land before phase A ships, and A0 is not closed until they do.

**Rollback.** Documentation only.

## A1 — Renderer and topic corpus

**Goal.** Replace the single static template with a topic corpus and a renderer that can inject blocks, **with no user-visible change at all**. The compose topic must render byte-for-byte what the current command prints.

**Risk level 0**

**Deliverables**

- [x] `runestone-cli/tool-docs/ai-context/compose.md` — the current `ai-prompt-context.tmp.md` content, with `${X}` changed to `{{X}}` and nothing else touched
- [x] `runestone-cli/tool-docs/ai-context/{overview,service,troubleshoot}.md` — new content per spec 5.1, with every rule derived from the validators per spec 5.2
- [ ] ~~`state.md`~~ — **moved to A4 on 2026-09-07.** It is composed entirely of fact blocks, and the renderers for those arrive with the snapshot module. Shipping the asset before its blocks exist would mean a topic that throws when rendered
- [x] `runestone-cli/tool-docs/ai-prompt-context.tmp.md` deleted
- [x] `runestone-cli/src/utils/tool-docs.ts` **deleted**, replaced by `src/utils/tool-docs/{index,manifest,render,assets}.ts` (spec 13 — leaving both would keep the old renderer silently live)
- [x] `renderAiPromptContext(config)` keeps its signature and export as a thin wrapper, so `src/commands/docs.ts` is untouched in this milestone
- [x] `{{VAR}}` and `{{BLOCK:NAME}}` substitution with a function replacer; unknown tokens throw (spec 5.3)
- [x] `runestone-cli/tests/utils/tool-docs.test.ts` (25 tests) and a committed fixture holding today's exact output

**Gate**

- [x] Compose-topic output is **byte-identical** to the pre-A1 output, asserted against the committed fixture
- [x] `npm test` green with **zero test files modified** — 43 suites, 606 passed, 5 skipped; `git diff --name-only` over `tests/` lists only the new file and its fixture
- [x] A value containing `$&`, `$1` and `$$` is substituted literally (the defect at the old `tool-docs.ts:9`)
- [x] An unknown `{{TOKEN}}` throws and names the token
- [x] Manifest and topic files are in bijection, asserted in both directions
- [x] `src/utils/tool-docs.ts` no longer exists
- [x] The `service` topic's field rules match `normalizeRouteDomain` and `normalizeServiceUrl`, asserted by a test that feeds the documented examples through the real validators

The last gate item is the one that matters most in this milestone: it makes the corpus's claims executable rather than aspirational, so spec 5.2 cannot rot.

**Landed.** Four topic assets and a four-file renderer. `src/commands/docs.ts` is untouched, so a bare `runestone docs --ai-context` still prints the compose brief and the golden integration test passes unmodified.

| Module | What it is |
| --- | --- |
| `render.ts` | Pure substitution: scalars, blocks, function replacers, hard failure on anything left unexpanded |
| `manifest.ts` | The topic list as data, carrying the `summary` and `brief` lengths that the index and the instruction-file block need |
| `assets.ts` | The only filesystem read, and the one place the asset path depth is written down |
| `index.ts` | `renderAiContext`, the compatibility wrapper, and the manifest-derived topic index block |

**Two things the tests caught that would otherwise have shipped.**

The first was a stale build artifact. `tsc` does not remove outputs for sources that no longer exist, so `dist/utils/tool-docs.js` — the old single-file renderer, still pointing at the deleted template — sat beside the new `dist/utils/tool-docs/` directory and shadowed it, because Node resolves the file before the directory. This is exactly the hazard spec 13 names, and it appeared in `dist/` rather than in `src/`. It is worse than a local annoyance: `prepack` runs `build`, and `build` did not clean, so publishing from a tree with a stale `dist/` would have shipped a renderer reading a file that is not in the tarball. `build` now runs a `clean` step first, implemented with `fs.rmSync` so it needs no new dependency and behaves the same on both platforms.

The second was a defect in this milestone's own central claim. "Byte-identical" turned out to be imprecise in a way that mattered. Git stores this repository's markdown as LF, but `core.autocrlf` is `true` here, so the working-tree template was CRLF and the pre-A1 runtime output was 1986 bytes; the new assets were written LF and produced 1927. That is a 59-byte delta on a 59-line file, which is entirely line endings. The content is genuinely unchanged — diffing the git-stored template with its delimiters rewritten against the new asset comes out identical, and the remaining 8-byte size difference is eight placeholders gaining two characters each. **But the fixture test could not have detected the difference**, because it compares a rendered asset against a fixture generated from the same source, and would pass with both sides CRLF just as happily.

Two changes followed. `.gitattributes` pins `runestone-cli/tool-docs/**` and `runestone-cli/tests/fixtures/**` to LF, scoped to those paths so no existing file changes behaviour — without it the corpus's bytes depend on who ran `npm publish`, which is not a property an artifact read by agents should have. And a separate test asserts that no rendered topic contains a carriage return; it was verified by injecting CRLF into an asset and confirming that this specific test fails, then restoring the asset and confirming it passes.

**One deliverable moved.** `state.md` is deferred to A4, where its fact blocks are built. Shipping the asset in A1 would have meant a topic that throws on render, because `substitute` treats an unregistered block as a hard error rather than passing it through.

**Rollback.** Single revert. Nothing outside `tool-docs/`, `src/utils/tool-docs/`, the new test and fixture, the `clean` script and the two `.gitattributes` lines changes.

## A2 — Offline snapshot module

**Goal.** One dependency-injected module producing the machine facts of spec 6.1's offline tier. Nothing imports it at the end of this milestone.

**Risk level 0**

**Deliverables**

- [x] `runestone-cli/src/services/agent-context/probe.ts` — the typed present/absent value and the wrapper that converts a throw into an absent value without printing
- [x] `runestone-cli/src/services/agent-context/snapshot.ts` — the snapshot type, its dependency interface, a `defaultAgentContextDependencies` constant following `DnsStatusDependencies`, and `schemaVersion: 1`
- [x] `runestone-cli/src/services/agent-context/render.ts` — pure block renderers, snapshot to string
- [x] `traefikApiBaseUrl` promoted into `src/services/traefik-api.ts`; the duplicate copies at `src/commands/certs.ts:62` and `src/commands/service.ts:81` deleted in favour of it
- [x] A file-header comment stating that this module must not acquire `child_process`, and why the acceptance test's rule would otherwise suggest the opposite (spec 6)
- [x] `runestone-cli/tests/services/agent-context/snapshot.test.ts` using `tests/helpers/env.ts`'s `testEnv()`

**Gate**

- [x] **Zero spawns**: a spy on `spawnCommand` records no calls for the offline tier
- [x] **Zero output**: spies on `process.stdout.write` and `process.stderr.write` both record no calls
- [x] **JSON contract**: `JSON.parse(JSON.stringify(snapshot))` deep-equals the snapshot, and no string field contains `'✓'`, `'✗'` or an escape character
- [x] Every row of spec 6.3's offline conditions has a test: no `certs` directory, unreadable certificate, zero services
- [x] An invalid certificate is reported as unusable and does **not** appear among covered domains
- [~] `certs remove` and `service add` behave identically after the `traefikApiBaseUrl` extraction — **production behaviour yes, but two test files had to change.** See the note below; this gate did not hold as written
- [x] Nothing under `src/` imports this module yet, asserted by a source scan

**Landed.** Three modules under `src/services/agent-context/`, 18 tests, and nothing in `src/` importing them — so this milestone reverts in one commit and cannot have changed any behaviour.

| Module | What it is |
| --- | --- |
| `probe.ts` | A fact that may not be obtainable. "I did not look", "I looked and could not reach it" and "there is nothing there" are three different answers, and the type keeps them apart |
| `snapshot.ts` | The offline facts, JSON-shaped from the outset, over an injected dependency interface following `DnsStatusDependencies` |
| `render.ts` | Snapshot to prose, pure, one function per corpus block |

The three-way distinction in `probe.ts` is the load-bearing part. An agent that reads "no collisions found" out of "Traefik could not be reached" will pick a name that is already taken, so an unreachable source must always produce a sentence saying so and naming the command that would fix it. A test asserts each of the three renders differently.

**`certificateCovered` is computed per route rather than inferred**, through the existing `findCoveringCertificate`, and only valid certificates contribute. An expired certificate is still listed — an agent needs to know it exists — but it must not make a hostname look usable, which would send the agent to a domain the browser refuses.

**Certificate names come from the SANs, not from the filename.** `CertificateListItem` has no `domain` field, and the two sources can disagree; the SANs are what a TLS client actually checks. This is the same conclusion the DNS feature reached for its mapping generation.

**The gate that did not hold.** The plan asserted that promoting `traefikApiBaseUrl` out of `certs.ts` and `service.ts` would leave their tests untouched. It did not. Both files mock the whole `traefik-api` module with a factory listing only `readTraefikSnapshot`, so the moment a command imported a second export from that module, the export became `undefined` and two `certs rm` tests failed with an exit code rather than an assertion.

Production behaviour is genuinely unchanged — the helper is the same one-line template it was in both copies. What changed is two mock factories, from replacing the module wholesale to `...jest.requireActual(...)` plus the one function under test. That pattern is already the dominant idiom here and appears twice in `certs.test.ts` itself, three lines above the mock that had to change; the `traefik-api` mocks were the exception. So the change makes those two tests less brittle rather than more permissive, and it is recorded here rather than quietly folded in, because a gate that says "no test changes" and then changes tests is worth reading twice.

The alternative was to leave the duplication in place and let the new module hold a third copy of the same URL template. That was rejected: a third copy is the thing the specification flagged in the first place.

**One item was reworded rather than argued with.** `design-acceptance.test.ts` asserts that no source file matches `/Makefile|make\s+[a-z]/i`, a guard against reintroducing the Makefile tooling this CLI replaced. Two of the new doc comments contained ordinary English — "probes that make a request", "never make a hostname look usable" — and tripped it. The comments were reworded. Broadening the regex to accommodate prose would have weakened a deliberate guard to save two words.

**Rollback.** Single revert. The `traefikApiBaseUrl` extraction and the two mock changes revert with it; the extraction is worth keeping on its own merit but nothing depends on it staying.

## A3 — `--ai-context [topic]` and `--offline`

**Goal.** The corpus and the offline snapshot become reachable. **First user-visible milestone.**

**Risk level 1**

**Deliverables**

- [x] `src/commands/docs.ts` — `--ai-context [topic]` as an optional-value option, `--offline`, topic resolution, and an unknown-topic path that sets `process.exitCode = 1`, writes nothing to stdout, and lists the valid topics on stderr
- [x] The generated topic footer (spec 5.1), so a bare invocation advertises `state` on the first call
- [x] `src/i18n/index.ts` — the reworded `options.aiContext.description`, plus `options.offline.description` and `docs.aiContext.unknownTopic`, in **all three** locale tables
- [x] `tests/integration/cli.test.ts` — a table-driven test across every topic, and an unknown-topic test

**Gate**

- [x] `tests/integration/cli.test.ts:158-196` passes with **zero edits**
- [x] `tests/integration/cli.test.ts:198-218` passes with **zero edits**
- [x] Line 192's `not.toContain('${RUNESTONE_')` is strengthened to also forbid `{{` — this is a strengthening, not a change to what it asserts
- [x] Every topic: exit 0, `stderr === ''`, non-empty stdout, no `{{` remaining
- [x] Unconfigured plus every topic: exit 1 and `stdout === ''`
- [x] `docs --help` still contains `Options:` and `--ai-context`
- [x] `docs --env` and `docs --project` are still rejected
- [x] All three locales produce the unknown-topic error, with no key falling back to English
- [x] `docs --ai-context` still makes zero spawns on every offline topic

**Landed.** `runestone docs --ai-context` now takes an optional topic, and every topic carries the machine's real facts. This closes the first item of the repository `TODO`: the covered domains and the names already in use come from `listDomainCertificates` and `listServices`, both pure file reads, so they land on the path an agent already calls rather than behind a new flag.

Verified on this machine: a bare invocation reports the three real wildcard certificates by their SANs, states that no routed service is registered, and ends with the footer listing the other topics.

**Both golden tests pass with their assertions untouched**, because they use `toContain` rather than equality and the new content is appended. One assertion was *strengthened* rather than changed: `not.toContain('${RUNESTONE_')` had become vacuous once the corpus moved to `{{...}}`, so `not.toContain('{{')` was added beside it. Deleting the old line would have been the tempting move and would have quietly dropped a check.

**The footer is derived from the manifest, and that turned out to matter immediately.** The first draft hard-coded a pointer to `runestone docs --ai-context state` as the place to find live facts. That topic does not exist until A4, so every topic would have shipped advertising a command that exits 1 — an agent following it would be worse off than one told nothing. The footer and the collision-checking guidance now both read the manifest, and the guidance names the online topic only when one is defined, falling back to `runestone service list` and the Traefik dashboard when it is not.

**Two test changes worth reading.**

The A1 fixture assertion moved from equality to a contiguous-prefix check. That is a real weakening and it is the strongest claim still available, since A3 appends by design; what it still proves is that nothing in the original brief was reordered, reworded or dropped.

The A2 test asserting that nothing imported the snapshot module had to go, because A3 is what imports it. Rather than delete it, it became an allowlist: the snapshot module may be reached only from `src/commands/docs.ts`. It earns its place because the module is cheap to import and tempting to reuse — reaching it from `up` or `setup` would put certificate and service reads, and later a Docker probe, on a path run several times a day. Adding a consumer should be visible in a diff. Verified by adding an import to `up.ts` and confirming the test names the file.

The general lesson, recorded because it will recur: **a milestone property does not belong in a permanent test.** "Nothing imports this yet" was true of A2 and is deliberately false afterwards.

**`--offline` is accepted and already correct**, since every shipped topic is offline. It is wired now rather than in A4 so that the flag and the tier split arrive together in the interface, and A4 only has to add a second tier behind an existing seam.

**Rollback.** Single revert. `docs.ts` returns to a boolean flag, the assets keep their blocks but nothing renders them, and the two i18n keys become unused.

## A4 — Online tier: collision detection

**Goal.** Answer the question the feature exists for and cannot answer offline: is this hostname or router name already taken by another project?

**Risk level 2** — a path that spawned nothing now spawns Docker and makes an HTTPS request.

**Deliverables**

- [x] `composeService.ps(composePath, timeoutMs = 30000)` — an additive second parameter; `src/services/docker-compose.ts:244` currently hard-codes `30000` into a `runCompose` call that already accepts a timeout
- [x] The online tier in `snapshot.ts`: container state at an 8000 ms budget and the Traefik snapshot via the promoted `traefikApiBaseUrl`
- [ ] ~~the DNS report with injected dependencies~~ — **dropped on 2026-09-07, spec 6.1 deviation.** See below
- [x] `runestone-cli/tool-docs/ai-context/state.md` — the asset itself, moved here from A1, plus its fact blocks and the prose for each unreachable source
- [x] Per-topic default tier, and `--offline` forcing the offline tier

**Gate**

- [x] With `spawnCommand` throwing and the Traefik read rejecting: `state` still exits 0 with `stderr === ''`, and the text names each unreachable source together with the command that would fix it
- [x] `compose`, `service`, `overview` and `troubleshoot` make **zero** probes even without `--offline`
- [x] `state --offline` makes zero probes
- [x] The 8000 ms budget is asserted at the call site by inspecting the argument, not by measuring wall-clock time
- [x] `buildDnsStatusReport` is not called from this module **at all**, asserted by a source scan — a stronger guarantee than the one planned, because the call was dropped rather than injected
- [x] Verified by hand with Runestone running and with Runestone stopped

**Landed.** Two online probes and the `state` topic. Verified on a real machine with Runestone running: the topic reported both containers as up, and reported seven Traefik router IDs — four of them, including `open-webui@docker` and `traefik-manager@docker`, registered by projects that have nothing to do with this branch.

That last point is the whole justification for the tier. A router or service ID is global to Traefik, so a name that is free in this project's own service list can already be taken by a project the agent cannot see, and only Traefik knows. Everything else in the snapshot can be read from a file.

**Neither probe can fail the call.** Both degrade to a value the renderer turns into prose, because the command asserts an empty stderr and an agent piping stdout still needs a usable answer when Docker is stopped. The distinction the type keeps — unavailable versus skipped — is what lets the renderer say "Traefik could not be reached, treat the name as unverified rather than free" instead of silently implying nothing is registered.

**Spec 6.1 deviation: `buildDnsStatusReport` is not used.** The specification listed it in the online tier. It is dropped, and the source scan now asserts it is absent rather than merely injected, which is the stronger guarantee.

The reasoning: it spawns `docker info` *and* a second `docker compose ps`, so including it would have made the topic cost three spawns rather than two. The only fact it adds over the offline `isDnsEnabled` is whether the daemon entry is actually in effect — the "configured on but not applied" case. That case has a dedicated command, `runestone dns status`, and the `troubleshoot` topic already sends the agent there. Paying a third spawn on a path an agent calls repeatedly, to partially duplicate a command that answers it properly, is a bad trade. If the discrepancy turns out to matter in practice, the honest fix is a line in `troubleshoot` telling the agent to run `dns status`, which is already there.

**`composeService.ps` gained an optional timeout**, defaulting to the 30000 it previously hard-coded, so every existing caller is unchanged. Thirty seconds is right for `status`, where a human is watching and a cold daemon is worth waiting for, and wrong for this; the snapshot passes 8000. The acceptance test's arity assertion is on `restart`, not on `ps`, so the added parameter is safe.

**A JSON-shape trap caught by the round-trip test.** `TraefikNamedResource.rule` is optional, and an absent key disappears through `JSON.stringify`, which would have made the published schema's shape depend on whether a particular router happened to have a rule. It is normalised to null.

**Where the online topic is tested.** Not in the integration suite: its output depends on whether Docker happens to be running on the machine the suite runs on, which is exactly the sort of assertion that passes for months and then fails for an unrelated reason. It is asserted in `tests/commands/docs.test.ts` with injected probes, at the real command entry point, including both failure paths and the timeout argument. The integration suite covers `state` only in the unconfigured case, where the answer does not depend on Docker.

**Rollback.** Single revert. The `ps` timeout parameter reverts with it and is harmless either way; the offline tier is untouched because the tier split is a parameter rather than a rewrite.

## B1 — Marker-block ownership engine

**Goal.** The whole of spec 9 as pure functions over text. Nothing touches the filesystem and no command exists at the end of this milestone.

**Risk level 0**

**Deliverables**

- [ ] `runestone-cli/src/services/skill/version.ts` — the template version constant and the marker strings
- [ ] `runestone-cli/src/services/skill/marker-block.ts` — `findManagedBlocks`, `identifyBlock` returning absent, matched, stale, conflict or unterminated, plus `insertBlock`, `replaceBlock` and `removeBlock`, all pure
- [ ] `detectNewline` and `splice` reused from `src/services/dns/json-edit.ts` rather than reimplemented
- [ ] `nextBackupPath` exported from `src/utils/project-files.ts:129` (module-private today) or moved to a shared utility
- [ ] `runestone-cli/tests/services/skill/marker-block.test.ts`, with this repository's own 77-line `AGENTS.md` committed as a fixture

**Gate**

- [ ] **The invariant test**: for any sequence of insert, user edit outside the span, replace and remove, **every byte outside the span is unchanged**, across at least six document shapes — an empty file, no trailing newline, CRLF, tab indentation, a file already containing the user's own hand-written `## Runestone` heading, and a file containing an unrelated HTML comment
- [ ] Insert then remove against the committed `AGENTS.md` fixture returns all 77 lines byte-identical
- [ ] Two `begin` markers produce `conflict` and nothing is written
- [ ] A `begin` with no `end` produces `unterminated` and nothing is written
- [ ] Repeated insert never produces a second block
- [ ] No file under `src/services/skill/` imports `fs` in this milestone, asserted by a source scan in the style of the existing `child_process` scan

**Rollback.** Single revert; nothing imports the engine. The `nextBackupPath` export is inert on its own.

## B2 — `skill status` and `skill install --dry-run`

**Goal.** Read the user's real files and report what an install would do. **Writes nothing.**

**Risk level 1**

`skill install` accepts only `--dry-run` in this milestone and refuses otherwise, saying that the write lands in the next increment. These are branch increments, not releases — only C3 is a release boundary — so a command that refuses is a checkpoint rather than a shipped defect.

**Deliverables**

- [ ] `runestone-cli/src/services/skill/targets.ts` — the built-in target table as **one** data structure, each entry carrying its documentation URL and verification date (spec 8.2)
- [ ] `runestone-cli/src/services/skill/plan.ts` — `planInstall` and `planRemove`, pure over injected reads, deciding every blocker
- [ ] `runestone-cli/src/services/skill/scope.ts` — target-directory resolution and `RUNESTONE_SKILL_HOME`
- [ ] `runestone-cli/src/commands/skill.ts` — the parent with **no options of its own**, plus `status` and `install --dry-run`
- [ ] `skill status` table using `padToWidth` from `src/utils/text.ts`, **not** `padEnd` — `certs.ts:58` and `service.ts:100` both get this wrong for CJK and must not be copied
- [ ] `src/cli.ts` registration; `src/i18n/index.ts` strings in all three locales
- [ ] `tests/services/skill/plan.test.ts` and `tests/commands/skill.test.ts`
- [ ] `skill`, `skill install`, `skill status` and `skill remove` added to the command lists at `tests/integration/cli.test.ts:55-71` and `:89-99`, and `'skill'` added at `design-acceptance.test.ts:69`

**Gate**

- [ ] `status` reports five states correctly: not installed, current, stale, modified at the current version, and a conflicted instruction file
- [ ] `status` and `install --dry-run` write nothing, proven by a recursive directory hash before and after, **including the absence of any backup file**
- [ ] `skill --help` prints no `Options:` section and no `[options]` on its first line
- [ ] `--project` and `--env` are rejected on `skill` and all three subcommands
- [ ] Target auto-detection: each of `.agents/`, `.claude/`, `.cursor/`, `.codex/` and `AGENTS.md` present alone selects exactly its own target; nothing present selects the neutral default
- [ ] `--skills-dir` and `--instructions-file` override the table
- [ ] `--user` together with `[dir]` exits 1; `--user --target cursor` exits 1 with the reason
- [ ] An invalid `[dir]` returns to the **same** prompt with the reason in that prompt's description, driven through `createProgram().parseAsync`
- [ ] An empty target selection returns to the same multi-select with the reason in its description
- [ ] `RUNESTONE_SKILL_HOME` is reported loudly by `skill status` when set
- [ ] Every new message key exists in all three locale tables

**Rollback.** Single revert; the command is new and nothing else calls into it.

## B3 — `skill install` and `skill remove`

**Goal.** The first write into a directory belonging to the user. `--user` is **not accepted** in this milestone.

**Risk level 2**

**Deliverables**

- [ ] `runestone-cli/src/services/skill/apply.ts` — `applyInstall` and `applyRemove`, with atomic writes through a same-directory temporary file and a rename
- [ ] Confirmation enumerating every absolute path, with `-y/--yes`, `--force`, and the non-TTY refusal mirroring `src/commands/dns-enable.ts:537`
- [ ] `skill remove` with aliases `rm` and `del`
- [ ] The neutral target only: `.agents/skills/runestone/` and an `AGENTS.md` block
- [ ] `tests/services/skill/apply.test.ts`

**Gate**

- [ ] Install into a fixture git repository: `git status` lists **exactly** the planned paths and nothing more
- [ ] Re-install with no version change writes nothing and creates **no** backup file
- [ ] Install over the committed 77-line `AGENTS.md` leaves every line outside the block byte-identical; `remove` returns the file to byte-identical
- [ ] An orphan file carrying an older template version is removed
- [ ] A file modified by the user at the current version is skipped without `--force`, and backed up then rewritten with it
- [ ] A conflicted instruction file causes a refusal that writes nothing and prints the offsets and the manual removal steps
- [ ] `remove` deletes only marker-carrying files; an unmarked file keeps the directory and is named in the output
- [ ] The dry-run output matches the real run's plan **line for line**
- [ ] Non-TTY without `--yes` refuses; with `--yes` it proceeds
- [ ] Configuration drift is detected: install, change `PREFIX` in `.env`, and `skill status` reports the installed files as out of date
- [ ] `skills-ref validate` passes on the generated skill directory

**Rollback.** Single revert. Any already-installed artefacts are removable with the reverted version's `skill remove`, and each carries a marker, so a hand removal is also possible.

## B4 — Full target table and wrappers

**Goal.** Every target in spec 8.1 renders correctly from the one corpus.

**Risk level 2**

**Deliverables**

- [ ] `claude` — `.claude/skills/runestone/SKILL.md` plus `references/*.md`
- [ ] `cursor` — `.cursor/rules/runestone.mdc`, a single concatenated file with `description`, `globs` and `alwaysApply` frontmatter
- [ ] `codex` — an alias of the instruction-file target at project scope, **not** a fourth copy of the same block
- [ ] `copilot` — `.github/skills/runestone/`
- [ ] The instruction-file block built from each topic's brief, not its body, at roughly 25 lines (spec 8.4)
- [ ] The Claude Code exception documented in the target table itself, with the reason

**Gate**

- [ ] Every generated `SKILL.md` passes `skills-ref validate`, with `name` matching its parent directory and `description` within 1024 characters
- [ ] Every generated `.mdc` frontmatter parses as YAML and carries the three expected keys
- [ ] `--target codex` at project scope writes the instruction file and no separate skill copy
- [ ] The instruction-file block stays under 30 lines
- [ ] **No live fact appears in any installed file** — asserted by rendering with a snapshot whose online fields are present and checking that none of their values appear in the output (spec 6.2)
- [ ] Installing every target into one fixture repository produces no path collisions and no duplicated content

**Rollback.** Single revert; the neutral target from B3 continues to work.

## C1 — MCP dependency spike

**Goal.** Find out whether the SDK can be adopted at all, at a cost worth paying. **This milestone exists because it can be reverted.**

**Risk level 0**

**Deliverables**

- [ ] `@modelcontextprotocol/sdk` in `dependencies`, and the `tsconfig.json` `paths` mapping it requires
- [ ] One throwaway module importing the server, the stdio transport, the in-memory transport and the client, proving all four type-resolve and load at runtime
- [ ] A recorded measurement: the `npm pack` size delta and the dependency-count delta, written into this document's evidence log

**Gate**

- [ ] `npm run build` green with `module` and `moduleResolution` **unchanged**
- [ ] `npm test` green, with the SDK imports working under ts-jest
- [ ] A test that fails loudly if an SDK upgrade moves the directory the `paths` mapping points at
- [ ] `engines.node` unchanged
- [ ] The measurement is written down and accepted

**If the gate fails or the size is judged unacceptable, this milestone is reverted and the hand-written stdio JSON-RPC server becomes the plan** (spec decision 2). That is the entire reason it is separate.

**Rollback.** Single revert: one dependency, one tsconfig key, one throwaway file.

## C2 — `runestone mcp serve`, read-only

**Goal.** A read-only MCP server over stdio exposing the three tools of spec 11.2.

**Risk level 3** — a long-lived process speaking a protocol.

**Deliverables**

- [ ] `runestone-cli/src/services/mcp/{server,tools,log}.ts`, with `log.ts` writing only to stderr and gated on `DEBUG`
- [ ] `runestone-cli/src/commands/mcp.ts` — a thin shell; `mcp` parent with a `serve` subcommand, following the `dns` shape
- [ ] The three tools, all annotated read-only, all composed from existing validators and the A2 snapshot
- [ ] `src/cli.ts` registration; i18n strings in all three locales
- [ ] `tests/services/mcp/{tools,server}.test.ts`, and a process-level handshake test in `tests/integration/cli.test.ts`

**Gate**

- [ ] An in-memory `tools/list` returns exactly three tools with the expected input schemas
- [ ] `process.stdout.write` records **zero** calls across a full in-memory session
- [ ] **The process-level handshake**: a real `initialize`, `notifications/initialized` and `tools/list` on stdin produce exit 0, `stderr === ''`, and stdout containing only JSON-RPC frames with the expected ids
- [ ] `mcp serve` with stdin at immediate EOF exits 0 and does not hang the suite
- [ ] A source scan proves `src/commands/mcp.ts` and `src/services/mcp/**` contain no `console.log`, no `process.stdout.write`, no import of the logger or of `@clack/prompts`, and none of the three spawn strings **even in comments**
- [ ] Every tool returns a successful result with Docker stopped and Traefik unreachable
- [ ] An unconfigured Runestone yields `configured: false` inside a **successful** result whose text names `runestone setup`
- [ ] `mcp` and `mcp serve` added to both command lists in `cli.test.ts`; `design-acceptance.test.ts` green

The handshake test is the most valuable item here: it is the only one that catches a stray stdout write added months later by someone reusing a service that has since grown one.

**Rollback.** Single revert. Nothing else calls into the MCP layer, and no existing command changes.

## C3 — `mcp config`, documentation, release

**Goal.** Make the feature findable and usable, and ship it.

**Risk level 1**

**Deliverables**

- [ ] `runestone mcp config [--client <name>]` printing the correct block per client — `mcpServers` for Claude Code and Cursor, `servers` for VS Code (spec 11.4)
- [ ] `docs/AI-AGENTS.md` plus `.zh-TW.md` and `.ja-JP.md` — the user-facing explanation, including the first-use approval behaviour of a project-scoped `.mcp.json`
- [ ] Root `README.md` "Project Integration" rewritten so it no longer instructs the user to transcribe a command; `docs/README/README.zh-TW.md` and `README.ja-JP.md` kept line-for-line aligned
- [ ] `runestone-cli/scripts/sync-readme.js` — rewrite rules for the new documentation links, and the removal of the now-dead `ai-prompt-context.tmp.md` link at `README.md:163`
- [ ] `runestone-cli/DESIGN.md` — section 6.6 rewritten, section 7's command inventory extended, section 13's acceptance criteria updated
- [ ] `runestone-cli/CHANGELOG.md` — user-facing entries only
- [ ] Root `AGENTS.md` — a new `## Skill Feature Rules` section: splice never overwrite, `--project` is a forbidden word and why, the MCP process must not write to stdout, and live state must never be baked into an installed file

**Gate**

- [ ] `npm pack --dry-run` includes every file under `tool-docs/ai-context/`
- [ ] A packed tarball installed globally renders every topic — the only proof that the asset path resolves correctly from `dist/`, which no unit test can provide
- [ ] `mcp config` output parses as JSON, and its `command` and `args` fed into C2's handshake test produce a working session
- [ ] Every link in the synced npm README resolves
- [ ] The three language versions of `docs/AI-AGENTS.md` have the same heading count and nesting, the same tables and the same code blocks — checked mechanically. Note the three existing `DNS.*` files are 361, 354 and 354 lines, so the gate is structural parity, not equal line counts
- [ ] `runestone skill install` documented in all three README languages

**Rollback.** Documentation reverts cleanly. `mcp config` is additive.

## B5 — User scope (deferred)

**Deferred** by spec decision 5. It is the only home-directory write and it serves cross-project convenience rather than the purpose in spec 1. Specified in spec 10.2 and scheduled last so that dropping it costs nothing.

**Risk level 3**

**Gate, when it is taken up**

- [ ] The confirmation prints the **resolved absolute path**, with no placeholder, verified on a real machine
- [ ] A full install, status and remove cycle under `RUNESTONE_SKILL_HOME`, with the real `~/.claude`, `~/.codex` and `~/.agents` **provably untouched** by a hash taken before and after
- [ ] Verified by hand once on Windows and once on Linux
- [ ] An existing `~/.codex/AGENTS.md` with the user's own content survives insert, replace and remove byte-identically outside the span

## Evidence log

| Milestone | What | Date | Evidence |
| --- | --- | --- | --- |
| A0 | Install-path landscape read from vendor documentation | 2026-09-07 | Spec 8.1, with URLs |
| A0 | `service` field contract measured from the validators | 2026-09-07 | Spec 5.2 |
| A0 | `service.validation.urlNoPath` has zero call sites | 2026-09-07 | Spec 5.2 |
| A0 | Claude Code does not load this repository's `AGENTS.md` | 2026-09-07 | Spec 8.1 |

## Current state of the repository

- The branch is `feat/skill-support`, cut from `develop` at `ba67a7e`, which is where `main` and `origin/develop` also sit. Nothing unmerged is inherited.
- `runestone-cli` is at 2.0.0. The agent-facing surface is `docs --ai-context [topic]` over five topics: four offline, plus `state`, which probes Docker and Traefik. Phase A is functionally complete; A0's two Traditional Chinese mirrors are the only open item in it.
- **There is no CI.** Every gate in this document is run by hand.
- Publishing is manual and the order is fixed: merge to `develop`, merge to `main`, then publish to npm.
- Three cleanups were found during A0 and deliberately left out of this branch: the three locale tables have no automated key-parity test, `service.validation.urlNoPath` is an orphan key, and `certs list` and `service list` compute column widths with `String.length` instead of the CJK-aware helper that already exists.
