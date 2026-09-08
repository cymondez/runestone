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
| A0 | Specification and milestones | 0 | — | **done** — both English documents and both Traditional Chinese mirrors |
| A1 | Renderer and topic corpus | 0 | A0 | **done** — 43 suites, 606 passed, 5 skipped, no existing test file touched |
| A2 | Offline snapshot module | 0 | — | **done** — 44 suites, 624 passed, 5 skipped |
| A3 | `--ai-context [topic]` and `--offline` | 1 | A1, A2 | **done** — 44 suites, 630 passed, 5 skipped. First user-visible milestone |
| A4 | Online tier: collision detection | 2 | A3 | **done** — 45 suites, 650 passed, 5 skipped. Phase A complete except the A0 mirrors |
| B1 | Marker-block ownership engine | 0 | — | **done** — 46 suites, 697 passed, 5 skipped |
| B2 | `skill status` and `install --dry-run` | 1 | A1, B1 | **done** — 47 suites, 719 passed, 5 skipped. B4's renderers folded in; see below |
| B3 | `skill install` and `skill remove` | 2 | B2 | **done** — 48 suites, 743 passed, 5 skipped. Every target enabled, so B4 is closed with it |
| B4 | Full target table and wrappers | 2 | B3 | **done, merged into B2 and B3** — the table and renderers landed in B2 because `status` cannot exist without them; enabling every target for writing landed in B3 |
| C1 | MCP dependency spike | 0 | — | **done, then reverted 2026-09-08.** The gate passed technically; the measured size was judged unacceptable and the owner ruled for the hand-written server. That is what this milestone existed to enable |
| C2 | `runestone mcp serve`, read-only | 3 | A2 | **done** — 49 suites, 768 passed, 5 skipped. Hand-written protocol layer; production dependencies unchanged at 13 |
| C3 | `mcp config`, documentation, release | 1 | C2 | **done** — 49 suites, 773 passed, 5 skipped |
| B5 | User scope | 3 | B4 | **done** — 49 suites, 788 passed, 5 skipped. Verified on Windows; the Linux half of the gate is not met |
| C4 | MCP tool surface: drop the topic enum | 3 | C2 | **done** — 49 suites, 792 passed, 5 skipped. Removes a shipped parameter; see below for why it was wrong |

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
- [x] `docs/SKILL-FEATURE-SPEC.zh-TW.md` — Traditional Chinese mirror
- [x] `docs/SKILL-MILESTONES.zh-TW.md` — Traditional Chinese mirror
- [x] The install-path landscape measured from vendor documentation and recorded with URLs and a verification date (spec 8.1)
- [x] The `service` field contract measured from the validators rather than the message catalogue (spec 5.2)

**Gate**

- [x] Every claim marked "verified" in the specification was either run or read from a cited source
- [x] The specification names the purpose narrowly enough to exclude installation and configuration (spec 1, 3.2)
- [x] Both Traditional Chinese mirrors exist with the same section structure

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

**The two Traditional Chinese mirrors are deliberately held back**, and this is a scheduling decision rather than an omission. The DNS specification was revised repeatedly *during* implementation — decision 2 was overturned, section 6.2 was rewritten from platform inference to a daemon-type table, and a whole finding was reverted — because measurement kept contradicting the plan. This specification will move the same way: A1 and A2 each end in a measurement that can change section 5 or section 6, and C1 exists precisely because its measurement may overturn decision 2. Translating now guarantees translating twice. The mirrors landed on 2026-09-08, once the specification had stopped moving — and the delay was justified by what happened in between: C1's measurement overturned decision 2, the MCP client table grew from four rows to eight, and the target ids changed. Translating on schedule would have meant translating twice. Both mirrors are structurally identical to their English source: 59 and 19 headings with matching nesting, 106 and 67 table rows, checked mechanically.

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

- [x] `runestone-cli/src/services/skill/version.ts` — the template version constant and the marker strings
- [x] `runestone-cli/src/services/skill/marker-block.ts` — `findManagedBlocks`, `identifyBlock` returning absent, matched, stale, conflict or unterminated, plus `insertBlock`, `replaceBlock` and `removeBlock`, all pure
- [x] `detectNewline` and `splice` reused from `src/services/dns/json-edit.ts` rather than reimplemented
- [x] `nextBackupPath` exported from `src/utils/project-files.ts:129` (module-private today) or moved to a shared utility
- [x] `runestone-cli/tests/services/skill/marker-block.test.ts`, with this repository's own 77-line `AGENTS.md` committed as a fixture

**Gate**

- [x] **The invariant test**: for any sequence of insert, user edit outside the span, replace and remove, **every byte outside the span is unchanged**, across at least six document shapes — an empty file, no trailing newline, CRLF, tab indentation, a file already containing the user's own hand-written `## Runestone` heading, and a file containing an unrelated HTML comment
- [x] Insert then remove against the committed `AGENTS.md` fixture returns all 77 lines byte-identical
- [x] Two `begin` markers produce `conflict` and nothing is written
- [x] A `begin` with no `end` produces `unterminated` and nothing is written
- [x] Repeated insert never produces a second block
- [x] No file under `src/services/skill/` imports `fs` in this milestone, asserted by a source scan in the style of the existing `child_process` scan

**Landed.** `identifyBlock`, `insertBlock`, `replaceBlock` and `removeBlock`, all pure, over 47 tests. `detectNewline` and `splice` come from the DNS engine rather than being reimplemented, and `nextBackupPath` is now exported from `project-files.ts` for B3.

**The guarantee is stated exactly, because the loose version is untestable.** "Nothing outside the block changes" cannot hold: `insertBlock` has to put the block *somewhere*, and a file that ends without a newline cannot be restored to that state without remembering what was there — which is what the marker model exists to avoid. What actually holds, and is written into the source:

> Every byte of the user's content survives insert, replace and remove. The file's trailing newline run is normalised to exactly one newline.

The second clause is a real change and is not hidden: a file ending with no newline gains one, a file ending with three blank lines comes back with none. Nothing else moves.

**The first draft had a genuine off-by-one and the first version of the test could not see it.** `removeBlock` consumed two newlines where `insertBlock` had added one, which merges the user's last two lines. Every shape in the invariant test put the block at the end of the file, where the seam normalisation absorbs exactly that error — so the suite passed with the bug in place. Verified by injecting it and watching 39 of 39 tests stay green.

The fix was a shape with the user's own text *after* our span, asserted with equality. Re-injecting the bug now fails all eight of those cases and nothing else. That is the test that earns its place; the other shapes are cheap insurance around it.

**Two of the failures during this milestone were the test's fault, not the engine's**, and both are the kind that would otherwise have been "fixed" in the wrong place. A line-by-line content comparison reported a spurious CRLF difference — the last content line legitimately regains its carriage return once there is more file after it — so the content claim became a prefix assertion. And the replace test used bodies `generated` and `regenerated`, so its assertion that the old body was gone could never fail; the bodies are now not substrings of one another.

**Rollback.** Single revert. Nothing imports the engine yet; the `nextBackupPath` export is inert on its own.

## B2 — `skill status` and `skill install --dry-run`

**Goal.** Read the user's real files and report what an install would do. **Writes nothing.**

**Risk level 1**

`skill install` accepts only `--dry-run` in this milestone and refuses otherwise, saying that the write lands in the next increment. These are branch increments, not releases — only C3 is a release boundary — so a command that refuses is a checkpoint rather than a shipped defect.

**Deliverables**

- [x] `runestone-cli/src/services/skill/targets.ts` — the built-in target table as **one** data structure, each entry carrying its documentation URL and verification date (spec 8.2)
- [x] `runestone-cli/src/services/skill/plan.ts` — `planInstall` and `planRemove`, pure over injected reads, deciding every blocker
- [x] `runestone-cli/src/services/skill/scope.ts` — target-directory resolution and `RUNESTONE_SKILL_HOME`
- [x] `runestone-cli/src/commands/skill.ts` — the parent with **no options of its own**, plus `status` and `install --dry-run`
- [x] `skill status` table using `padToWidth` from `src/utils/text.ts`, **not** `padEnd` — `certs.ts:58` and `service.ts:100` both get this wrong for CJK and must not be copied
- [x] `src/cli.ts` registration; `src/i18n/index.ts` strings in all three locales
- [x] `tests/services/skill/plan.test.ts` and `tests/commands/skill.test.ts`
- [x] `skill`, `skill install`, `skill status` and `skill remove` added to the command lists at `tests/integration/cli.test.ts:55-71` and `:89-99`, and `'skill'` added at `design-acceptance.test.ts:69`

**Gate**

- [x] `status` reports five states correctly: not installed, current, stale, modified at the current version, and a conflicted instruction file
- [x] `status` and `install --dry-run` write nothing, proven by a recursive directory hash before and after, **including the absence of any backup file**
- [x] `skill --help` prints no `Options:` section and no `[options]` on its first line
- [x] `--project` and `--env` are rejected on `skill` and all three subcommands
- [x] Target auto-detection: each of `.agents/`, `.claude/`, `.cursor/`, `.codex/` and `AGENTS.md` present alone selects exactly its own target; nothing present selects the neutral default
- [x] `--skills-dir` and `--instructions-file` override the table
- [x] `--user` together with `[dir]` exits 1; `--user --target cursor` exits 1 with the reason
- [ ] ~~An invalid `[dir]` returns to the same prompt~~ — **not applicable, see below.** There is no prompt in B2: nothing is interactive yet, because nothing is written
- [ ] ~~An empty target selection returns to the same multi-select~~ — **deferred to B3.** The multi-select belongs with the write, and B2 reports "nothing detected" with the two flags that fix it instead
- [x] `RUNESTONE_SKILL_HOME` is reported loudly by `skill status` when set
- [x] Every new message key exists in all three locale tables

**Landed.** The target table, the renderers, the planner, scope resolution, and `skill install --dry-run` plus `skill status`. Nothing is written: two tests hash the whole directory before and after and assert it is unchanged, including the absence of a `.bak`.

Verified by hand in a temporary git repository: a dry run against a directory containing `.agents/` and a hand-written `AGENTS.md` plans six file creations and one section append, names the backup path, and `git status` afterwards shows only the file the test itself created.

**`.agents/skills/` is the default, and that is the substance of this milestone.** One write is read by Codex, Cursor and VS Code / Copilot. Claude Code is the documented exception and gets `.claude/skills/` plus `CLAUDE.md`, because it reads neither neutral path. Codex is an alias of the neutral instruction file rather than a fourth copy of the same block — asserted by a test, since the tempting implementation writes `.codex/` too.

**Three layers, so that a moved path does not need a release.** The table is data in one file, each row carrying the documentation URL it came from and the date it was checked; `--skills-dir` and `--instructions-file` override it for a runtime the table does not know. A path override is treated as a statement of intent and implies the neutral target rather than requiring `--target` alongside it.

**B4 is merged into this milestone and B3.** `status` has to compare what is installed against freshly rendered content, so it cannot exist without the renderers B4 was going to add. Splitting them would have meant a `status` that could not answer its own question. What remains genuinely B4-shaped — enabling every target for *writing* — lands in B3, which is where the risk level actually changes.

**`--project` is absent by construction, not by convention.** `PROJECT_DIR` already means `~/.runestone` throughout this CLI, so the destination is a positional argument and user scope is one boolean. `skill` and both subcommands are now in the integration suite's list of commands that must reject `--env` and `--project`.

**The allowlist test earned its keep immediately.** Adding the snapshot import to `skill.ts` failed the A3 allowlist, exactly as intended — a new consumer of that module is a decision, not an accident. It is now listed with its reason, and a second assertion enforces the claim the reason makes: the installer uses the offline builder only, and may not reach the live one. An installed file outlives the moment it was written, so a baked-in live fact would be a lie within minutes.

**Two gate items did not apply.** Both concerned interactive prompts, and there is nothing interactive in B2 because there is nothing to confirm. "Nothing detected" is reported with the two flags that fix it; the multi-select arrives with the write, in B3.

**Rollback.** Single revert. The command disappears; nothing else calls into `src/services/skill/`.

## B3 — `skill install` and `skill remove`

**Goal.** The first write into a directory belonging to the user. `--user` is **not accepted** in this milestone.

**Risk level 2**

**Deliverables**

- [x] `runestone-cli/src/services/skill/apply.ts` — `applyInstall` and `applyRemove`, with atomic writes through a same-directory temporary file and a rename
- [x] Confirmation enumerating every absolute path, with `-y/--yes`, `--force`, and the non-TTY refusal mirroring `src/commands/dns-enable.ts:537`
- [x] `skill remove` with aliases `rm` and `del`
- [x] ~~The neutral target only~~ — **every target is enabled**, which closes B4 here rather than in a separate milestone
- [x] `tests/services/skill/apply.test.ts`

**Gate**

- [x] Install into a fixture git repository: `git status` lists **exactly** the planned paths and nothing more
- [x] Re-install with no version change writes nothing and creates **no** backup file
- [x] Install over the committed 77-line `AGENTS.md` leaves every line outside the block byte-identical; `remove` returns the file to byte-identical
- [x] An orphan file carrying an older template version is removed
- [x] A file modified by the user at the current version is skipped without `--force`, and backed up then rewritten with it
- [x] A conflicted instruction file causes a refusal that writes nothing and prints the offsets and the manual removal steps
- [x] `remove` deletes only marker-carrying files; an unmarked file keeps the directory and is named in the output
- [x] The dry-run output matches the real run's plan **line for line**
- [x] Non-TTY without `--yes` refuses; with `--yes` it proceeds
- [x] Configuration drift is detected: install, change `PREFIX` in `.env`, and `skill status` reports the installed files as out of date
- [~] `skills-ref validate` — **substituted.** The published validator needs a network fetch, so the specification's constraints are asserted directly and offline: `name` matching its directory and the character rules, `description` within 1024, `metadata` values all strings, `allowed-tools` absent, under 500 lines. Same rules, and a failure names the field

**Landed.** `apply.ts`, the `remove` command, confirmation with `--yes`, the non-TTY refusal, and every target enabled. 48 suites, 743 passed.

Verified by hand in a temporary git repository, which is the sequence that matters:

| Step | Result |
| --- | --- |
| `install --yes` into a directory with a hand-written `AGENTS.md` | seven files written, one backup taken |
| `install --yes` again | "everything is already up to date"; **no second backup** |
| `status` | all seven reported current |
| `remove --yes` | `AGENTS.md` **byte-identical** to before, empty skill directories cleaned |

**A real over-reach found by running it.** The first version of the directory cleanup climbed as far as empty directories allowed, so `remove` deleted `.agents/` — a directory the *user* created, and the exact one target detection looks for. Nothing was lost, but a later `skill install` would then have detected nothing and refused, for a reason the user could not connect to anything they did. Cleanup now stops at the skill's own directory: everything above it belongs to the runtime or the user, even when emptying our files leaves it bare. Asserted, along with detection still working after a removal.

**A stale test that had started passing for the wrong reason.** B2 had a test named "refuses to write without `--dry-run`", asserting exit 1 because that build could not write at all. B3 enabled writing, and the test kept passing — on the non-TTY check, since jest gives the process a non-TTY stdin. It was reporting a guarantee it was no longer testing. It is now the non-TTY refusal test it had quietly become, with two new tests beside it: one that proves `--yes` actually writes, and one asserting the dry-run output matches the real run's plan line for line.

**`skills-ref validate` was substituted, not skipped.** The published validator needs a network fetch, which does not belong in this suite. The specification's constraints are asserted directly instead — `name` matching its parent directory and the character rules, `description` within 1024 characters, every `metadata` value a string, `allowed-tools` absent, the file under 500 lines — across all four targets. Same rules, offline, and a failure names the field rather than exiting non-zero.

**`allowed-tools` is deliberately absent.** The specification defines it, and restricting an agent's tool access from inside a file installed into someone else's project is presumptuous and would break their workflow with no visible cause. A test asserts it stays absent.

**Rollback.** Single revert. Anything already installed is removable by the reverted version's `skill remove`, and every generated file carries a marker, so a removal by hand is possible too.

## B4 — Full target table and wrappers

**Merged into B2 and B3, and closed there.** Nothing was dropped; the split was wrong rather than the work.

`status` has to compare what is installed against freshly rendered content, so it cannot exist without the renderers this milestone was going to add — splitting them would have meant a `status` that could not answer its own question. The table and every renderer therefore landed in **B2**, and enabling every target for *writing* landed in **B3**, which is where the risk level actually changes.

Where each deliverable ended up:

| Deliverable | Landed in |
| --- | --- |
| `claude` — `.claude/skills/runestone/` plus `references/*.md` | B2 (rendered), B3 (written) |
| `cursor` — `.cursor/rules/runestone.mdc`, single concatenated file | B2, B3 |
| `codex` — an alias of the instruction-file target, not a fourth copy | B2, asserted by a test |
| `copilot-vscode` — `.github/skills/runestone/` | B2, B3 |
| The instruction-file block built from each topic's brief | B2 |
| The Claude Code exception documented in the table itself | B2 |

The gate items moved with them: the specification's `SKILL.md` constraints are asserted offline in B3 (see that milestone for why the published validator was substituted), the `.mdc` frontmatter is parsed as YAML in B2, and "no live fact appears in any installed file" is enforced by the allowlist assertion recorded in B2.

**The id is `copilot-vscode`, not `copilot`.** `mcp --client copilot` is the Copilot CLI, a different product with its own configuration file; one id for both read as though installing one would configure the other. A test asserts the two lists do not share it.

**Rollback.** Not separately revertible, because it is not a separate commit. B3 reverts the writing; B2 reverts the table and renderers.

## C1 — MCP dependency spike

**Goal.** Find out whether the SDK can be adopted at all, at a cost worth paying. **This milestone exists because it can be reverted.**

**Risk level 0**

**Deliverables**

- [x] `@modelcontextprotocol/sdk` in `dependencies` — **no `tsconfig.json` `paths` mapping turned out to be needed**, contrary to the prediction in spec decision 2
- [x] One throwaway module importing the server, the stdio transport, the in-memory transport and the client, proving all four type-resolve and load at runtime
- [x] A recorded measurement: the dependency-count and size deltas

**Gate**

- [x] `npm run build` green with `module` and `moduleResolution` **unchanged**
- [x] `npm test` green, with the SDK imports working under ts-jest
- [~] ~~A test that fails loudly if an SDK upgrade moves the `paths` target~~ — **not applicable.** No `paths` mapping was needed, so there is no directory to guard
- [x] `engines.node` unchanged
- [x] The measurement is written down — **and not accepted**

**Landed, then reverted on 2026-09-08.** Every technical gate passed, and the prediction that made this milestone look risky was wrong: no `paths` mapping was needed, `engines.node` did not move, and `npm audit --omit=dev` reported nothing.

What failed was the cost:

| | Before | With the SDK |
| --- | --- | --- |
| Production dependencies | 13 | 107 |
| Installed size | — | about 15 MB more |

Bundling was measured as well and worked — 364 KB, with a clean process-level handshake — but it moves dependency security from npm's advisory feed to us, and adds a bundler to a build that is otherwise plain `tsc`. The owner ruled for the hand-written server.

**The revert also removed a `package-lock.json` that this milestone had committed by accident.** `git add -A` picked it up even though the commit message said, in the same breath, that adding one was not this branch's call. The revert put that right.

**This is the milestone working as designed, not failing.** It was written to be reverted, sequenced so that nothing depended on it, and the ruling it enabled is recorded in spec decision 2 with the measurement that produced it. What the SDK was buying — protocol conformance — is now an explicit liability recorded in `jsonrpc.ts` and guarded by the process-level handshake test.

**Rollback.** Done: one revert, which removed the dependency, the throwaway module and the accidental lockfile.

## C2 — `runestone mcp serve`, read-only

**Goal.** A read-only MCP server over stdio exposing the three tools of spec 11.2.

**Risk level 3** — a long-lived process speaking a protocol.

**Deliverables**

- [x] `runestone-cli/src/services/mcp/{server,tools,log}.ts`, with `log.ts` writing only to stderr and gated on `DEBUG`
- [x] `runestone-cli/src/commands/mcp.ts` — a thin shell; `mcp` parent with a `serve` subcommand, following the `dns` shape
- [x] The three tools, all annotated read-only, all composed from existing validators and the A2 snapshot
- [x] `src/cli.ts` registration; i18n strings in all three locales
- [x] `tests/services/mcp/{tools,server}.test.ts`, and a process-level handshake test in `tests/integration/cli.test.ts`

**Gate**

- [x] An in-memory `tools/list` returns exactly three tools with the expected input schemas
- [~] ~~`process.stdout.write` records zero calls~~ — **restated.** The transport's job is to write frames to stdout, so "zero writes" was the wrong rule. What is asserted instead: no console call and no logger or prompt import in any MCP source, comments excluded; and `process.stdout` appearing in exactly one place, as the transport's default parameter
- [x] **The process-level handshake**: a real `initialize`, `notifications/initialized` and `tools/list` on stdin produce exit 0, `stderr === ''`, and stdout containing only JSON-RPC frames with the expected ids
- [x] `mcp serve` with stdin at immediate EOF exits 0 and does not hang the suite
- [x] A source scan proves `src/commands/mcp.ts` and `src/services/mcp/**` contain no `console.log`, no `process.stdout.write`, no import of the logger or of `@clack/prompts`, and none of the three spawn strings **even in comments**
- [x] Every tool returns a successful result with Docker stopped and Traefik unreachable
- [x] An unconfigured Runestone yields `configured: false` inside a **successful** result whose text names `runestone setup`
- [x] `mcp` and `mcp serve` added to both command lists in `cli.test.ts`; `design-acceptance.test.ts` green

**Landed.** A hand-written JSON-RPC layer, the three read-only tools, the stdio loop, and `runestone mcp serve`. **Production dependencies are unchanged at 13**, which is the whole point of the ruling that produced it.

Verified against the real binary: four requests and one notification in, four frames out, `stderr` empty, `-32601` for an unknown method, and `check_name` correctly finding the wildcard certificate that covers a candidate route on this machine.

**C1 was reverted, which is what it was built for.** Its gate passed technically — no `paths` mapping needed, `engines` unchanged, no new vulnerabilities — but the measured cost was 107 production dependencies and about 15 MB against a baseline of 13. Bundling was measured too and worked (364 KB, clean handshake), but it moves dependency security from npm to us and adds a bundler to a `tsc`-only build. The owner ruled for the hand-written server.

**What the SDK was actually buying, stated plainly, because we now own it:** protocol conformance. Five methods is a small surface, but MCP is revising quickly, and a break presents to the user as "my agent cannot see Runestone" with nothing in the output to explain it. `PROTOCOL_VERSION` in `jsonrpc.ts` is the thing to bump, and the process-level handshake test is the thing that catches a break.

**Two protocol details worth naming**, because they are the ones a hand-written server gets wrong:

- A notification carries no id and must never be answered. Replying to `notifications/initialized` leaves an unmatched response that some clients treat as a protocol error. Asserted for known and unknown notifications alike.
- A parse failure has no recoverable id, so the response carries `null`, not a guess.

**A condition the model can correct is a successful result, not a JSON-RPC error.** An unknown topic, an invalid name, an unconfigured Runestone: all come back with `isError` and the message that carries the fix, because a JSON-RPC error routes to the client's error path where the model never reads it. This is the same-prompt correction rule from `AGENTS.md`, applied to a machine reader.

**A gate item was restated rather than ticked.** The plan said `process.stdout.write` must record zero calls. That is the wrong rule: writing frames to stdout is the transport's entire job. The first version of the purity scan failed on three places — two comments *explaining* the rule, and the transport's own default output parameter. What is asserted now is what was actually meant: no console call and no logger or prompt import in any MCP source with comments stripped, and `process.stdout` in exactly one place, as that parameter default.

**A control that proved nothing, caught in passing.** The first negative control for the purity scan injected a `console.log` via a string replace that silently did not match, so it "passed" while testing nothing. Redone with an assertion that the injection applied; the scan then failed as it should and went green on restore. Second occurrence of that failure mode on this branch.

**Rollback.** Single revert. Nothing else imports `src/services/mcp/`, and no existing command changes.

## C3 — `mcp config`, documentation, release

**Goal.** Make the feature findable and usable, and ship it.

**Risk level 1**

**Deliverables**

- [x] `runestone mcp config [--client <name>]` printing the correct block per client — `mcpServers` for Claude Code and Cursor, `servers` for VS Code (spec 11.4)
- [x] `docs/AI-AGENTS.md` plus `.zh-TW.md` and `.ja-JP.md` — the user-facing explanation, including the first-use approval behaviour of a project-scoped `.mcp.json`
- [x] Root `README.md` "Project Integration" rewritten so it no longer instructs the user to transcribe a command; `docs/README/README.zh-TW.md` and `README.ja-JP.md` kept line-for-line aligned
- [x] `runestone-cli/scripts/sync-readme.js` — rewrite rules for the new documentation links, and the removal of the now-dead `ai-prompt-context.tmp.md` link at `README.md:163`
- [x] `runestone-cli/DESIGN.md` — section 6.6 rewritten, section 7's command inventory extended, section 13's acceptance criteria updated
- [x] `runestone-cli/CHANGELOG.md` — user-facing entries only
- [x] Root `AGENTS.md` — a new `## Skill Feature Rules` section: splice never overwrite, `--project` is a forbidden word and why, the MCP process must not write to stdout, and live state must never be baked into an installed file

**Gate**

- [x] `npm pack --dry-run` includes every file under `tool-docs/ai-context/`
- [x] A packed tarball renders every topic — installed into a temporary prefix rather than globally, so the machine's working `runestone` was not overwritten. Same proof, no side effect
- [x] `mcp config` output parses as JSON, and its `command` and `args` fed into C2's handshake test produce a working session
- [x] Every link in the synced npm README resolves
- [x] The three language versions of `docs/AI-AGENTS.md` have the same heading count and nesting, the same tables and the same code blocks — checked mechanically. Note the three existing `DNS.*` files are 361, 354 and 354 lines, so the gate is structural parity, not equal line counts
- [x] `runestone skill install` documented in all three README languages

**Landed.** `runestone mcp config`, the three-language user documentation, the README rewrite in all three languages, and the maintainer rules.

**The packaged tarball was actually installed and exercised**, which is the gate no unit test can satisfy: all four offline topics render from the packed layout with no placeholder left unexpanded, proving A1's asset-path depth is right in `dist/` and not only in `src/`. Installed into a temporary prefix rather than globally, so the machine's working `runestone` was left alone.

**`mcp config` prints; it does not write.** Editing another tool's configuration file is the same class of act as editing the Docker daemon's, and this project treats that as the highest risk there is. The shapes genuinely differ and the difference is easy to miss because everything else looks identical: **VS Code uses the key `servers` while Claude Code and Cursor use `mcpServers`**. A single "here is the JSON" answer would have been silently wrong for one of them, so the client table carries the key, the location, the documentation URL and the date it was checked, and a test asserts each row.

**Two pre-existing broken links, found by this milestone's own gate.** `scripts/sync-readme.js` rewrites relative documentation links to absolute URLs for the npm copy, and it had no rule for `docs/DOMAINS.md` or `docs/DOMAINS.zh-TW.md` — so both have been dead in every published README since those documents were written. Fixed alongside the new rules rather than filed away: same file, same cause, two lines.

**A link that would have been broken on arrival.** The localized READMEs live in `docs/README/`, so their sibling-style links to `AI-AGENTS.zh-TW.md` resolved one directory too high. Caught before commit by checking the rendered paths rather than assuming the pattern from the English file transferred.

**Three-language structural parity, checked mechanically:** eight headings with identical nesting, thirteen table rows and twelve code fences in each. Line counts differ — 142, 107, 107 — because English wraps differently, which is why the gate is structure rather than length; the existing `DNS.*` trio differ the same way.

**Rollback.** Documentation reverts cleanly. `mcp config` is additive and nothing depends on it.

## B5 — User scope (deferred)

**Landed.** Most of the code was already present from B3 and B4; what B5 added was the verification, and the verification found two defects.

Verified on Windows under a `RUNESTONE_SKILL_HOME` redirect: install, status and remove all exit 0; a pre-existing `~/.codex/AGENTS.md` carrying the user's own rules comes back byte-identical after the full cycle; and all four real home-directory destinations are still absent afterwards, so nothing was written outside the redirect.

**The first measurement of that last point was contaminated and had to be redone.** It hashed the whole of `~/.claude`, which this very session writes to for its own state, so it reported a change that had nothing to do with Runestone. The honest check probes the four specific paths Runestone could write, and nothing else.

**Defect 1: the neutral fallback did not exist.** Specification 8.2 makes the neutral location what a bare `skill install` writes when nothing more specific is detected, and B2's gate item says exactly that — **and I had ticked it**. The code instead reported "No agent runtime detected" and exited 1 on every non-interactive path: `--dry-run`, `--user`, `--yes`, and any non-TTY shell. A project with none of these directories is the ordinary case, so the documented headline command failed for most first-time users.

Fixed to match the specification, keeping the part the old behaviour got right: the interactive path still asks, because a human present beats a default, and the fallback announces itself rather than choosing silently. The test that encoded the old behaviour was rewritten rather than deleted, with the reasoning recorded in it.

**Defect 2: `--target` accepted more than it advertised.** `codex` is a valid alias for `agents`, but the unknown-target error listed only the canonical table, so anyone who mistyped would never learn the alias exists. The error now lists the aliases too.

**A guard was added for a defect I introduced earlier.** The `copilot-cli` to `copilot` rename was done with a blanket string replace, which also rewrote a path segment inside GitHub's documentation URL, turning a citation into a 404. Restored, with a test pinning the product path segment. The guard's own first version was too broad and flagged the correct URL, because GitHub's real path legitimately contains `/copilot/how-tos/` — narrowed to the thing that actually broke.

**The cross-platform half of this gate was withdrawn on 2026-09-08, and the reason is worth recording because it was cargo-culted in.**

It came from the DNS milestones, where cross-platform verification is load-bearing for concrete reasons: the daemon configuration path differs per platform, Docker Desktop and a native engine behave differently, elevation is involved, and something has to bind port 53. Writing Markdown touches none of that.

Two measurements settle it, and they are stronger than one manual Linux run would be:

- **There is no platform-conditional code to diverge.** `process.platform`, `win32` and `darwin` appear nowhere under `src/services/skill/` or in `src/commands/skill.ts`. Relative paths are stored with `/` and joined through `path.join(root, ...relative.split('/'))`; the home root comes from `os.homedir()`. A Linux run would execute identical code.
- **The one axis that genuinely varies by platform is line endings, and it is tested directly.** The marker engine's invariant suite carries five CRLF cases covering insert, replace, remove and a round trip with the block mid-file. That is a stronger guarantee than exercising one line-ending style once by hand.

Ticking a gate on the strength of "it should behave the same" is forbidden by this document, and rightly. Withdrawing a gate because it was never justified for this feature is a different act, and this note is the justification.

**Rollback.** Single revert. The neutral fallback and the alias listing are worth keeping on their own merit but revert cleanly with the rest.

**Risk level 3**

**Gate, when it is taken up**

- [x] The confirmation prints the **resolved absolute path**, with no placeholder, verified on a real machine
- [x] A full install, status and remove cycle under `RUNESTONE_SKILL_HOME`, with the real `~/.claude`, `~/.codex` and `~/.agents` **provably untouched** by a hash taken before and after
- [x] Verified by hand on Windows. **The Linux half was withdrawn as unjustified, not skipped** — see below
- [x] An existing `~/.codex/AGENTS.md` with the user's own content survives insert, replace and remove byte-identically outside the span

## C4 — MCP tool surface: drop the topic enum

**Goal.** Remove the `topic` parameter from the MCP surface, because the constraint that produced it does not apply there.

**Risk level 3** — it changes a shipped interface.

**Deliverables**

- [x] Specification 11.2 rewritten: four tools, no topic, with the reasoning and the measurement
- [x] Specification 5.1: `all` marked as a CLI value with no MCP equivalent, and its ordering stated
- [x] `runestone_integration_guide` and `runestone_troubleshoot` replace `runestone_context`
- [x] `--ai-context all` implemented on the CLI, where it did not exist despite being specified
- [x] `ALL_TOPIC` and `ALL_TOPIC_ORDER` in the manifest, so the order is stated once
- [x] `runestone docs --help` lists every topic with a localized description
- [x] Tests, the three-language user documentation, and the changelog

**Gate**

- [x] No tool takes a `topic`, and no tool's input schema contains an `enum`
- [x] Every corpus topic reaches exactly one tool, asserted against the manifest
- [x] The guide contains both integration paths and the guardrail list in one call
- [x] The guide and the troubleshooting tree make **zero** probes even without `offline`
- [x] `--ai-context all` exits 0 and renders every topic, `overview` first
- [x] `--ai-context all --offline` renders all five without probing
- [x] `docs --help` names every topic in all three locales
- [x] The process-level handshake still passes, with the four new names

**Landed.** Four tools, none with a topic. 49 suites, 792 tests.

**This milestone exists because the owner asked "why does MCP need topics?" and the honest answer was that it does not.** The first version mirrored the CLI's shape onto MCP without asking whether the constraint that produced it still held. It does not: a CLI invocation is a process and its output goes into scarce prompt context, so fetching one topic beats fetching five — but on MCP the connection stays open, a second call is nearly free, and **tool selection already exists**. A topic enum made the model choose twice, and the inner choice had to be made before it had seen anything that would inform it.

One enum was also doing three unrelated jobs: `overview`/`compose`/`service` were one intent split three ways, `troubleshoot` was a different intent, and `state` duplicated `runestone_status`.

The size objection was measured rather than argued: `overview` 4.3 KB, `compose` 3.3 KB, `service` 5.0 KB, so the merged guide is about 12 KB — against 4.3 KB for the index, then a guess, then 3.3 or 5.0 KB, with a wrong guess costing both. One call of 12 KB is the cheaper path as well as the simpler one.

Three tools became four, which section 11.2 elsewhere argues against. Accepted: four well-named tools are easier for a model to choose between than three where one carries a six-value enum.

**`--ai-context all` did not exist, and I had told the owner it did.** Asked to list the topics, I answered from the specification rather than from the code — and the specification listed `all` while `resolveTopic` only consulted the manifest, so it exited 1. The MCP side had it. Implemented on the CLI, in the order specification 5.1 states, which is deliberately not the manifest's: `overview` first, because reading the specifics before the choice they inform is backwards. The MCP `all` is gone with the enum, so the two surfaces no longer need to agree on it.

**A tier bug caught by reading the code rather than the tests.** `all` includes the online topic, but `findTopic('all')` returns undefined, so the first implementation silently fell through to the offline tier and rendered the state topic as "not checked". `all` is now explicitly online.

**The help listing is the original request, and it is manifest-derived.** The option description said "optionally name a topic" and never said which, so the only way to find out was to guess wrong — which is exactly how this milestone started. The listing is generated from the manifest with localized labels, marking the default and the two that query Docker, so a new topic appears without anyone remembering to add it.

**Rollback.** Single revert. `runestone_context` returns, the CLI loses `all`, and the help loses its topic listing.

## Evidence log

| Milestone | What | Date | Evidence |
| --- | --- | --- | --- |
| A0 | Install-path landscape read from vendor documentation | 2026-09-07 | Spec 8.1, with URLs |
| A0 | `service` field contract measured from the validators | 2026-09-07 | Spec 5.2 |
| A0 | `service.validation.urlNoPath` has zero call sites | 2026-09-07 | Spec 5.2 |
| A0 | Claude Code does not load this repository's `AGENTS.md` | 2026-09-07 | Spec 8.1 |
| A4 | Spec 14.4 end-to-end: an agent given `docs --ai-context` in a real project | 2026-09-08 | **Verified by the repository owner.** No transcript was captured, so this row records that the check was run and passed, not what the agent did step by step |

## Current state of the repository

- The branch is `feat/skill-support`, cut from `develop` at `ba67a7e`, which is where `main` and `origin/develop` also sit. Nothing unmerged is inherited.
- `runestone-cli` is at 2.0.0 with an unreleased section in the changelog. The agent-facing surface is three commands: `docs --ai-context [topic]` over five topics, `skill install | status | remove` across four targets, and `mcp serve | config`. **Production dependencies are unchanged at 13** — the MCP server is hand-written, which is what the C1 ruling bought.
- Phases A, B and C are functionally complete, and the specification 14.4 end-to-end check has been run and passed by the repository owner. Open: A0's two Traditional Chinese specification mirrors, and the Linux half of B5's manual verification.
- **There is no CI.** Every gate in this document is run by hand.
- Publishing is manual and the order is fixed: merge to `develop`, merge to `main`, then publish to npm.
- Three cleanups were found during A0 and deliberately left out of this branch: the three locale tables have no automated key-parity test, `service.validation.urlNoPath` is an orphan key, and `certs list` and `service list` compute column widths with `String.length` instead of the CJK-aware helper that already exists.
