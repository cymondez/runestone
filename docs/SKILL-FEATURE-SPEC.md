# Runestone Agent Support Feature Specification

English | [正體中文](SKILL-FEATURE-SPEC.zh-TW.md)

## 1. About This Document

- Status: draft, pending review.
- It describes *what* to build and *why*. Function decomposition is decided during implementation.
- **The purpose of this feature is narrow and the narrowness is deliberate: let an AI agent add Runestone support to a project.** It does not teach an agent to install or configure Runestone, and it presupposes that Runestone is already installed and configured. Section 3.2 states what that excludes.
- Findings marked **verified** were measured on 2026-09-07 (Windows 11, Docker Desktop, Node 24.16, `runestone` 2.0.0) or read from a vendor's own documentation with the URL given. Anything else is marked **to be confirmed**.
- **Section 16 is the milestone and risk-control plan, not an appendix.** The risk here is writing files into repositories and home directories that belong to other people and other tools, so the order of construction is itself a control.
- Where this document and `SKILL-MILESTONES.md` disagree, this document wins and the milestones document is wrong.

## 2. The Problem

`runestone docs --ai-context` renders `tool-docs/ai-prompt-context.tmp.md` (59 lines) through `src/utils/tool-docs.ts` (22 lines), substituting four `${VAR}` placeholders, and writes the result to stdout. Measured against the purpose in section 1, it is missing three things.

### 2.1 One product, two integration paths — the context knows only one

Runestone can route to a project in two structurally different ways:

| Path | When it applies | Mechanism |
| --- | --- | --- |
| Docker labels | The project runs in Docker | Traefik labels on the service, plus joining the external network |
| `runestone service add` | The project runs on the host (`npm run dev`), is already running, or is an external URL | Traefik file provider, written to `configuration/services/<name>.service.yml` |

**The generated context covers only the first.** Verified: the string `service add` does not appear in `tool-docs/ai-prompt-context.tmp.md`.

The consequence is not that the agent lacks a feature. It is that the agent **confidently does the wrong thing**: given a host dev server, an agent that knows only the label path produces a `compose.override.yml` that cannot work, because there is no container to attach labels to.

### 2.2 The agent has no facts about this machine

To pick a hostname an agent must know which domains a certificate already covers — an uncovered hostname produces a TLS warning rather than an error, so it fails quietly. To pick a router and service name it must know what other projects have already registered — a collision produces mis-routing, which fails confusingly.

None of that is in the output. This is the first item of the repository's own `TODO`:

```
1. docs ai context 需要更多資訊提示
    - 可用domain清單
    - 已使用的route、service名稱
```

Both are **pure file reads** (section 6.1), which is why they belong on the path an agent already calls rather than behind a new flag.

### 2.3 It depends on the human saying a magic sentence

`README.md` documents the intended workflow as writing, by hand, into the prompt: "For the Runestone settings, call `runestone docs --ai-context` directly." Nothing makes the command discoverable. If the human forgets the sentence, the agent invents Traefik configuration from priors.

### 2.4 The cost list

This feature writes files into repositories and home directories that Runestone does not own, and it feeds rules to something that will act on them without checking. Those costs cannot be removed, only bounded:

1. `AGENTS.md` **is not Runestone's file.** The user may already have one. This repository's own is 77 hand-written lines.
2. Generated files **enter the user's git history**, and therefore their commits, diffs and code review.
3. Generated files **go stale** when the CLI is upgraded, and nothing tells the user.
4. The user **may edit what we generated**, and a later install must not silently eat those edits.
5. User-scope installation **affects every project on the machine**, including projects that have nothing to do with Runestone.
6. The content **is executed as instructions** by something that does not push back. One wrong sentence and the agent edits the wrong file.
7. A snapshot of live state, once written into an installed file, **is a lie within minutes**.
8. **The install-path landscape is not stable.** Every runtime scans a different set of directories and the set changes between releases (section 8.1). Any path we hard-code is a path that will eventually be wrong.

### 2.5 Non-negotiable design constraints

Each row exists to bound a cost from 2.4. None is a matter of taste.

| Cost | Constraint | Section |
| --- | --- | --- |
| The file is not ours | Do not write it at all. Runestone installs a skill into a skills directory and touches no instruction or rules file the user owns | 8.4 |
| It enters the user's git | Print every absolute path before writing; `--dry-run` on every writing command; never write outside the printed plan | 10.3 |
| It goes stale | The marker carries the template version; `doctor` reports staleness; re-rendering and comparing detects both staleness and configuration drift | 9.1, 10.4 |
| The user edits it | Detect modification by re-render comparison; skip modified files unless `--force`; refuse to delete a file whose content we did not produce | 9.2, 9.5 |
| Home directory blast radius | User scope is opt-in, supports only the targets with a real user-level path, and carries its own disclosure | 10.2 |
| The agent acts on the content | Derive every rule from the code that enforces it, never from prose or from message catalogues; name the commands the agent must not run | 5.2, 5.1 |
| Live state becomes a lie | Only offline scalars are substituted into installed files; live facts are reachable only by running a command | 6.2 |
| Paths are unstable | A neutral default, a documented exception list, and a user-settable path — in that order of preference | 8.2 |

Costs we refuse to pay: we do not overwrite a file we did not generate, we do not restore whole-file backups, we do not write another tool's configuration file on the user's behalf, we do not occupy a port, and we do not mutate Runestone state through the MCP server.

## 3. Scope

### 3.1 In scope

- Both integration paths (2.1) as generated agent-facing content, with the rules taken from the validators that enforce them.
- Live facts about this machine that bear on integration: covered domains, certificate validity, registered services and routes, and names already taken by other projects.
- `runestone docs --ai-context [topic]`, replacing the single static brief with a topic corpus.
- `runestone skill install | status | remove`, installing that corpus into a project so no human transcription is needed.
- `runestone mcp serve`, a read-only MCP server over stdio, plus `runestone mcp config`.
- A guardrail list naming the commands an agent must not run on the user's behalf.

### 3.2 Out of scope

- **Installing or configuring Runestone.** No generated content teaches `setup`, `doctor`, `dns enable`, `dns disable`, `certs install`, `up`, `down` or `stop` as something the agent performs. Those commands appear only in the guardrail list of 5.1 and, where a symptom demands it, as "ask the user to run this".
- **Any behaviour when Runestone is not configured.** The existing gate — exit 1, empty stdout, localized message on stderr — is correct and is preserved unchanged (section 7.3). This feature legitimately produces nothing on a machine where Runestone is not set up.
- **Mutating Runestone state through the MCP server** (section 11.3).
- **An HTTP MCP transport** (section 11.1).
- **Writing another tool's configuration file.** `runestone mcp config` prints; the user pastes (section 11.4).
- **Localizing the generated corpus.** Decision 1, section 15.

## 4. Terminology

| Term | Definition |
| --- | --- |
| Runestone directory | `~/.runestone` by default. **This is what `RunestoneEnv.PROJECT_DIR` and `resolveProjectDir()` mean** — not the user's repository. See 10.2. |
| Target directory | The user's repository, the one being wired up. Named `[dir]` on the command line, defaulting to `process.cwd()`. |
| Topic | One unit of the agent-facing corpus, one file under `tool-docs/ai-context/`. |
| Snapshot | The typed record of machine facts (section 6), consumed by both the renderer and the MCP tools. |
| Offline tier | Facts obtainable from `.env` and the filesystem, with no process spawn and no network. |
| Online tier | Facts requiring Docker or the Traefik HTTP API. |
| Target | A named install destination: a set of paths plus the wrapper format they need (section 8). |
| Class A file | A file Runestone generates and owns outright. Since 8.4 it is the only class there is. |
| Template version | The integer carried in every generated marker, used for staleness detection. |

## 5. Content Model

### 5.1 Topics

| Topic | Contents | Tier |
| --- | --- | --- |
| `compose` (default) | Today's brief verbatim, plus offline facts and the footer | Offline |
| `service` | The second path of 2.1: when it applies, the exact command, the field rules of 5.2, and the certificate requirement | Offline |
| `state` | Covered domains, certificate validity, registered services and routes, names taken by other projects, container state | **Online** |
| `troubleshoot` | Symptom to cause: 404, 502, TLS warning, and "works in the browser, fails from another container" | Offline |
| `overview` | What Runestone is, how to choose between the two paths, the topic index, and the guardrail list | Offline |
| `all` | `overview`, `compose`, `service`, `state`, `troubleshoot`, in that order, separated by `---`. **A CLI value only**, with no MCP equivalent — see 11.2 | Online |

`certs`, `dns` and `commands` are deliberately **not** separate topics. Certificate rules only mean something at the moment of choosing a hostname, so they belong in `service` and `compose`. DNS only matters as the cause of a symptom, so it belongs in `troubleshoot`. The command inventory *is* `overview`. Every additional topic costs the agent a round trip.

**The guardrail list is required even though this feature does not teach installation** — precisely because it does not. It must name, with the reason attached, the commands whose effects reach beyond the project: `dns enable` and `dns disable` (restart the Docker daemon, terminating every container on the machine), `certs install` (needs elevation, modifies the system trust store), `down` (removes the environment), `setup` (rewrites configuration), and `up` and `stop` (change what is running).

`all` concatenates in the order above, which is deliberately not the manifest's own order: `overview` comes first because it explains how to choose between the two integration paths, and reading the specifics before that choice is backwards.

**Discovery is solved by a footer, not by changing a default.** Every topic ends with the same generated block listing the other topic names and the literal command lines. A bare `runestone docs --ai-context` therefore teaches the agent that `state` exists on the very first call.

### 5.2 The fact source rule

**Every rule in the corpus must be derived from the code that enforces it — never from prose, and never from the message catalogue.**

The reason is cost 2.4 item 6: the reader acts on the content without checking it. The repository already contains a trap for anyone who reads message strings instead of validators. Verified: `service.validation.urlNoPath` ("URL cannot include a path, query, or fragment") exists in all three locale tables at `src/i18n/index.ts` lines 96, 617 and 1131, and has **zero call sites anywhere in the package**. The behaviour it describes is not the behaviour that runs.

The measured contract:

| Field | Enforced by | Rule |
| --- | --- | --- |
| Service name | `validateServiceName`, `namePattern` | `/^[a-z0-9][a-z0-9-]*$/` |
| Route domain | `normalizeRouteDomain`, `src/services/service-manager.ts:66-81` | Lower-cased; rejected if it contains `/` or `:`, so no protocol, port or path; every label must match `domainLabel` |
| Service URL | `normalizeServiceUrl`, `src/services/service-manager.ts:83-101` | **Path and query are accepted** — lines 98-100 preserve `pathname + search` and strip only a bare `/`. Protocol restricted to http and https |

`isContainerLoopbackUrl()` (`src/services/service-manager.ts:107`) and `replaceServiceUrlHost()` (`:112`) already encode the loopback problem — a URL pointing at `localhost` means the container itself when resolved inside a container. That is the substance of the `troubleshoot` topic, and it must be reused rather than restated.

### 5.3 Placeholders

Two constructs, one substitution pass, no template language and no new dependency:

- `{{VAR}}` — a scalar.
- `{{BLOCK:NAME}}` alone on a line — replaced by the string returned by the pure renderer registered under that name.

Repeated and conditional content is produced in TypeScript and rendered to Markdown, following the existing precedent where `src/services/dns/status.ts` builds a report as data and `src/commands/dns.ts` renders it.

The delimiter is `{{...}}` and **not** `${...}` because the corpus is full of Compose and shell interpolation. Verified: the current template contains `${RUNESTONE_NETWORK_NAME}` three lines away from generated YAML that must emit a literal `${PREFIX:-runestone}`.

Substitution must use a **function replacer**. Verified defect in the current renderer: `src/utils/tool-docs.ts:9` passes the value as a replacement *string*, so `$&`, `$1`, `$'` and `$$` inside it are interpreted as patterns. That is unreachable with today's four inputs and reachable the moment a service URL or a certificate SAN is substituted. The same line interpolates the key into a `RegExp` unescaped.

An unknown `{{TOKEN}}` is a hard error naming the token, not a silent passthrough.

## 6. The Context Snapshot

One dependency-injected module, `src/services/agent-context/`, consumed by the renderer and by the MCP tools, so that a future `--json` is a second renderer over the same value.

It lives under `src/services/` because it composes other services. **It does not need `child_process` and must not acquire it.** This is worth stating because `tests/integration/design-acceptance.test.ts:108-120` makes `src/services/` the one place where a contributor is *allowed* to add a spawn, which is the opposite of the intent here.

### 6.1 Fields and sources

| Field | Source | Tier |
| --- | --- | --- |
| Host domain, network name, entrypoint names and ports, Runestone paths | `envLoader.load()` | Offline |
| `configured` | `envLoader.hasRequiredVars()` | Offline |
| Covered domains, wildcards, certificate validity and expiry | `listDomainCertificates(projectDir)`, field `sans` | Offline |
| Registered services, used names, used routes | `listServices(config)` | Offline |
| Whether a route is covered by a certificate | `findCoveringCertificate` | Offline |
| DNS enabled | `isDnsEnabled()`, `src/services/dns/settings.ts` — reads `.env` | Offline |
| Active development overrides | `activeOverrides()`, plus `RUNESTONE_TOOL_STATE_PATH` | Offline |
| Container state | `composeService.ps(composeFilePath, 8000)` — the second parameter does not exist yet, see below | **Online** |
| Routers and services registered by other projects | `readTraefikSnapshot(traefikApiBaseUrl(config))` | **Online** |
| Full DNS ownership report | `buildDnsStatusReport(config, deps)` — **injected deps, never the defaults** | **Online** |

**`buildDnsStatusReport` is not offline.** Verified: its default dependencies reach `detectDaemonEnvironment()` then `readDaemonInfo()` then `spawnCommand('docker', ['info', ...])`, and separately `composeService.ps`. Reusing it for the offline tier would make `docs --ai-context` spawn Docker twice on a path that must spawn nothing. The offline tier reads `isDnsEnabled()` instead.

**`composeService.ps` takes no timeout parameter today.** Verified: `src/services/docker-compose.ts:244` calls `runCompose(['ps', '--format', 'json'], composePath, 30000)` with the value hard-coded, while `runCompose` itself already accepts a `timeout` argument. Thirty seconds is far too long for a call an agent makes on every task, so `ps` gains an optional second parameter defaulting to `30000` and the snapshot passes `8000`. The change is purely additive: the acceptance test asserts only that `ps` is a function, and its arity assertion is on `restart`, not on `ps`.

**`traefikApiBaseUrl` is already duplicated and must be promoted rather than copied a third time.** Verified: identical bodies returning `` `https://traefik.${hostDomain}` `` exist at `src/commands/certs.ts:62` and `src/commands/service.ts:81`. It belongs beside `readTraefikSnapshot` in `src/services/traefik-api.ts`, with both command copies deleted in favour of it.

`CertificateListItem.status` is typed `'✓' | '✗'`. The snapshot maps it to a boolean. Passing the glyph through would ship Unicode as an enum value in any future `--json`.

### 6.2 Cost tiers

- `compose`, `service`, `overview` and `troubleshoot` are **offline always**. Three reasons, and the asserted `stderr === ''` is only the third: this is the hot path of every agent prompt and must not wait on a cold Docker daemon; the compose brief is most useful *before* the user has run `up`; and a golden test cannot assert output that depends on whether Docker happens to be running.
- `state` and `all` are online by default, with `--offline` to force file-only.
- **No probe failure reaches stderr.** A failure becomes a typed absent value plus a warning that the renderer turns into prose naming the unreachable source and the command that would fix it.
- **Live facts are never substituted into an installed file** (cost 2.4 item 7). Installed files carry offline scalars and an instruction to run `runestone docs --ai-context state`. This is the entire reason to install a skill rather than paste a blob of context.

### 6.3 Degradation

| Condition | Snapshot | `docs --ai-context` | MCP |
| --- | --- | --- | --- |
| Not configured | not built | exit 1, empty stdout, stderr message (unchanged) | `configured: false` as a **successful** result |
| No `certs` directory | empty lists, warning | "No certificates yet; run `runestone certs create <domain>`" | same |
| Unreadable certificate | that entry invalid, with its error | listed as unusable, **separately** from covered domains | same |
| No services registered | empty list, no warning — empty is normal | "No routed services are registered." | same |
| Docker unreachable | container and DNS facts absent | offline topics unaffected; `state` still exit 0, `stderr === ''` | still a successful result |
| Traefik unreachable | collision facts absent | as above, and the text says collisions could not be checked | as above |
| Override active | warning naming the variable and its value | printed prominently, per the disclosure rule in `AGENTS.md` | same |

## 7. CLI Surface: `docs --ai-context`

### 7.1 Option shape

`--ai-context [topic]`, an optional-value option. A required value would turn today's bare `runestone docs --ai-context` into a parse error. A positional or subcommand form would break the assertion that `docs --help` contains both `Options:` and `--ai-context`.

`--offline` forces the offline tier. It is the only new user-visible flag.

An unrecognized topic sets `process.exitCode = 1`, writes nothing to stdout, and lists the valid topics on stderr. `process.exitCode` rather than `process.exit(1)` is deliberate and pre-existing: it lets buffered stdout flush.

### 7.2 Backward compatibility

**A bare `--ai-context` continues to mean the `compose` topic.** The footer and the offline facts are *appended* to it.

This is a published CLI whose own README ships example prompts containing the bare invocation, and those strings now live in other people's repositories and saved agent instructions. Changing what the command means changes the behaviour of prompts nobody will re-read.

The golden test at `tests/integration/cli.test.ts:158-196` uses `toContain`, not equality, so appending satisfies every existing assertion. **Zero existing assertions change.** The one that needs strengthening rather than changing is line 192's `not.toContain('${RUNESTONE_')`, which becomes vacuous under the new delimiter and must also forbid `{{`.

### 7.3 The unconfigured gate

Unchanged: exit 1, `stdout === ''`, localized message on stderr naming `runestone setup`. `tests/integration/cli.test.ts:198-218` passes without edits, and the same behaviour extends to every topic.

The tempting alternative — print the static prose with a banner, since that is exactly when an agent most needs telling — is rejected. Exit 1 with empty stdout is a contract: it means *this output is unusable, do not paste it into a prompt*. An agent piping stdout must never receive half a brief. Per 3.2 this feature presupposes a configured Runestone, so producing nothing is correct rather than a gap.

## 8. Install Targets

### 8.1 The landscape

Verified 2026-09-07 from each vendor's own documentation.

| Runtime | Project skill directories | User skill directories | Instruction file |
| --- | --- | --- | --- |
| Codex | `.agents/skills`, scanned in every directory from the working directory up to the repository root; `.codex/skills` | `~/.agents/skills`, `~/.codex/skills` | `AGENTS.md`, with `AGENTS.override.md` at any level; `~/.codex/AGENTS.md` |
| Cursor | `.agents/skills`, `.cursor/skills`; also reads `.claude/skills` and `.codex/skills`; walked recursively | `~/.cursor/skills`, `~/.agents/skills` | `AGENTS.md` |
| VS Code / Copilot | `.github/skills`, `.claude/skills`, `.agents/skills`; more via the `chat.agentSkillsLocations` setting | `~/.copilot/skills`, `~/.claude/skills`, `~/.agents/skills` | `AGENTS.md` |
| Claude Code | `.claude/skills` | `~/.claude/skills` | `CLAUDE.md` |

Sources: <https://developers.openai.com/codex/skills>, <https://cursor.com/docs/skills>, <https://code.visualstudio.com/docs/agent-customization/agent-skills>, <https://agents.md>.

Two conclusions follow, and they are the whole basis of 8.2:

- **`.agents/skills/` is the neutral location.** One write is read by Codex, Cursor and VS Code / Copilot.
- **Claude Code is the documented exception**: it scans `.claude/skills` rather than the neutral location, which is why it needs a target of its own. Its instruction file is `CLAUDE.md` rather than `AGENTS.md`, and Runestone writes neither (8.4). Verified in this repository: its root `AGENTS.md` is not loaded into a Claude Code session's context.

`AGENTS.md` precedence across the tools that read it: the closest file to the edited file wins, and an explicit user instruction overrides everything.

### 8.2 Three layers

Hard-coding a vendor's path is cost 2.4 item 8. The resolution order is:

1. **Neutral default.** `.agents/skills/runestone/`. This is what a bare `runestone skill install` writes when nothing more specific is detected.
2. **Documented exceptions**, as named targets: `claude` and `copilot-vscode`, with `codex` as a named alias of the neutral target because Codex scans the `.agents/skills` the neutral target already writes. Selected explicitly with `--target`, or automatically when that runtime's directory is already present in the target directory. The unknown-target error lists the aliases as well as the canonical ids, because an accepted value missing from the advertised list is a value nobody finds.

   Cursor needs no target of its own: 8.1 records it scanning `.agents/skills` alongside `.claude/skills` and `.codex/skills`, so the neutral write already reaches it. The `.cursor/rules/runestone.mdc` this specification once required went with the instruction files on 2026-09-09, for the same reason — a rules file is guidance, not a skill.

   `copilot-vscode` rather than `copilot`: `mcp --client copilot` is the Copilot **CLI**, a different product with its own configuration file, and one id meaning both read as though installing one would configure the other.
3. **User-settable paths**, for a runtime not in the table or a path that has moved: `--skills-dir <path>`. A machine-level default may be persisted in tool state, because "which agent tools I use" is a property of the person rather than of the repository.

The built-in table is a convenience, not an assumption. It must be one data structure in one file so that a path change is a one-line edit, and every entry must carry the documentation URL it came from and the date it was verified.

### 8.3 Skill package format

The format is specified at <https://agentskills.io/specification> and is not Runestone's to invent. Verified requirements:

- A skill is a directory containing `SKILL.md`, with optional `scripts/`, `references/` and `assets/`.
- `SKILL.md` carries YAML frontmatter. **`name` and `description` are required**; `license`, `compatibility` (max 500 characters), `metadata` and `allowed-tools` (experimental) are optional.
- `name`: 1 to 64 characters, lowercase `a-z`, `0-9` and hyphens, no leading, trailing or consecutive hyphens, and **must match the parent directory name**. Ours is therefore `runestone` in a directory named `runestone`.
- `description`: 1 to 1024 characters. It is the only part loaded before activation, so it must name the trigger words.
- `metadata` is a map of string keys to **string** values. The template version is recorded here, quoted.
- References are relative paths, one level deep. `SKILL.md` should stay under 500 lines.
- `allowed-tools` is omitted. Restricting an agent's tools inside someone else's project is presumptuous and would break their workflow silently.

A validator exists and is used as a gate: `skills-ref validate ./my-skill`.

### 8.4 No instruction-file block

**Runestone installs a skill and writes nothing else.** Earlier revisions of this specification had it splice a marked block into `AGENTS.md` and `CLAUDE.md` and write a `.cursor/rules/runestone.mdc`. All three were removed on 2026-09-09 by the repository owner, whose request had been a skill and an MCP server and neither of those. It was never one of section 15's decisions — it entered as an unexamined assumption while this document was being written, which is how it survived four milestones without being questioned.

**The removal costs nothing measurable.** Every runtime in 8.1's table finds a skill by scanning its skills directories, so the block bought no discoverability the skill did not already have. Its content — one brief per topic and the "never run these yourself" list — is already in `SKILL.md`, which those runtimes load when the skill activates.

**What it bought instead was risk.** Those files carry the user's own instructions to their agent; this repository's own `AGENTS.md` is 77 hand-written lines. A splice engine that gets it wrong damages a file nobody asked us to touch, and not writing is a stronger guarantee than splicing carefully.

The enforcement is `tests/services/skill/apply.test.ts`: every path a target renders must lie inside `<skills-dir>/runestone/`, and none may be an `AGENTS.md`, a `CLAUDE.md` or a `.mdc`.

### 8.5 Ownership classes

| Class | Files | Engine |
| --- | --- | --- |
| A | `<skills-dir>/runestone/**` | Version-gated whole-file rewrite, backed up before the bytes change |

There is one class, and that is what 8.4 buys: every file Runestone writes is a file Runestone generated in full. A directory is created but never removed beyond emptiness, and never above `<skills-dir>/runestone`.

## 9. Ownership Model

### 9.1 Markers are the state

There is no receipt file. Every generated file carries a marker naming the template version, and rendering is deterministic, so:

- **stale** — marker version below the current template version.
- **modified** — marker version current, but re-rendering produces different bytes.
- **configuration drift** — the installed file substituted an older `.env` value. This falls out of the same comparison at no extra cost.
- **orphan** — a file carrying our marker that the current template no longer generates. Removed without bookkeeping.

Markers:

```
references/*.md, line 1   <!-- runestone:generated skill-template=1 -->
SKILL.md                  inside the frontmatter, as metadata plus a YAML comment
```

A `toolState` index was considered and rejected: it would make every *project-scope* install write into the user's home directory, raising that milestone's risk level by a whole step to buy a cross-project `skill list` that nobody asked for. The DNS engine must remember its insertions because an IP string cannot carry a marker; Markdown can. **Identify by content, not by a remembered list.**

### 9.2 Class A

Version-gated whole-file rewrite, following `updateComposeFile` in `src/utils/project-files.ts:149-181`. Its comment at lines 173-175 states the principle to inherit: when the tool cannot distinguish an older template's output from something the user edited, it keeps the file either way rather than deciding which it is looking at.

A file at the current version whose content differs is **modified**: skipped without `--force`, backed up and rewritten with it.

### 9.3 There is no Class B

This section specified the splice engine for files belonging to the user. It was removed on 2026-09-09 with the instruction files themselves (8.4), and with it the `conflict` and `unterminated` states, the blockers they raised, and the whole marker-block module. Runestone writes only files it generated in full, so there is no span to own inside somebody else's file.

### 9.4 Backup

**Back up only when the bytes are about to change.** `updateComposeFile` already returns early when the rendered output equals what is on disk, before it copies anything. Therefore a repeated install creates no backup, and `--dry-run` creates none.

Reuse `nextBackupPath()` (`src/utils/project-files.ts:129`), which already handles non-clobbering `.bak`, `.bak2`, `.bak3`. It is module-private today and must be exported rather than reimplemented.

### 9.5 Removal

- **Never restore a whole-file backup** — the same prohibition the DNS specification places on `daemon.json`, for the same reason: it would discard unrelated edits made since.
- Delete Class A files carrying our marker. Remove the skill directory only if it is then empty. **Never a recursive delete.** An unmarked file keeps the directory and is named in the output.
- Refuse to delete a file whose content we did not produce, unless `--force`.

## 10. CLI Surface: `skill`

### 10.1 Commands

```
runestone skill                                     no options of its own
  install [dir]  [--target <name...>] [--skills-dir <path>]
                 [--user] [--dry-run] [--force] [-y|--yes]
  status  [dir]  [--user] [--no-header]
  remove  [dir]  [--target <name...>] [--user] [--dry-run] [--force] [-y|--yes]   aliases rm, del
```

The parent carries no options because `tests/integration/cli.test.ts:106` asserts that a command whose only option is `--help` shows no `Options:` section and no `[options]` in its usage line.

### 10.2 Scope

**`--project` is forbidden.** The binding reason is not a test: `PROJECT_DIR` and `resolveProjectDir()` already mean `~/.runestone` throughout this CLI. Reusing that word for the user's repository would collide with the CLI's own vocabulary at the exact point where being wrong writes files into the wrong tree. `tests/integration/cli.test.ts:55-87` additionally asserts that `--project` and `--env` are rejected, and `skill` and its subcommands are added to that list.

Scope is therefore a positional `[dir]` defaulting to `process.cwd()`, matching `certs create <domain>`, plus one boolean opt-in, `--user`. `--user` together with `[dir]` is an error.

`--user` supports only the targets with a real user-level skills directory, and it must write **that** directory: the neutral `~/.agents/skills`, `claude` (`~/.claude/skills`) and `copilot-vscode` (`~/.copilot/skills`, per 8.1). Since 8.4 there is no instruction file to place, so the only question left is which directory the runtime scans in the home directory rather than in a project.

**Known divergence, measured on 2026-09-09 and not yet fixed.** `targetsForScope` tests only whether `userScope` is *defined*; its value is never read as a path. So `--user --target copilot-vscode` writes `~/.github/skills` — the project-scope path joined to the home root — rather than the `~/.copilot/skills` the table records. The neutral and `claude` targets are unaffected only because their two paths happen to be identical.

`RUNESTONE_SKILL_HOME` redirects the home root for development and testing, following `RUNESTONE_TOOL_STATE_PATH`. Per the override rule in `AGENTS.md`, `skill status` must report loudly whenever it is active.

### 10.3 Behaviour

- **Target detection** when none is named: a runtime's target is selected when its **directory** is already present in `[dir]`; otherwise the neutral default. This is what stops a repository that uses one runtime acquiring another's directory. Directories only: an `AGENTS.md` or a `CLAUDE.md` is the user's own instruction file, and since 8.4 Runestone neither writes nor reads one.
- **Plan and apply are separate functions**, following `dns disable`, so `--dry-run` is not a second implementation that can drift. A test asserts the dry-run output matches the real run's plan line for line.
- **Blockers replace the plan**; they are not appended to it.
- `-y, --yes` consents to the printed plan. `--force` rewrites a file that carries no marker or that the user modified. The two are not interchangeable.
- **Non-TTY** without `--yes` or `--dry-run` is refused with an explanation, mirroring the one existing precedent at `src/commands/dns-enable.ts:537`.
- Confirmation enumerates every absolute path to be created, overwritten with its backup path, or deleted.
- Interactive correction obeys the prompt rules in `AGENTS.md`: a bad `[dir]` returns to the *same* prompt with the reason in that prompt's description, following `promptForExistingServiceName`; an empty target selection returns to the same multi-select. Both are tested at the real command entry point.

### 10.4 Lifecycle

- `doctor` gains one read-only check reporting installed artefacts that are stale, and naming `runestone skill install` as the fix.
- `up` writes nothing and at most prints one line. `AGENTS.md` states the principle: a command run several times a day must not hold the power to write the user's files.
- `skill status` is the complete view, showing both scopes and which is in effect.

## 11. MCP Server

### 11.1 Transport: stdio

stdio only. Two of the reasons are specific to this product.

**The working directory is the project.** Every tool answers "how should *this* project be wired up". A stdio server is spawned by the client in the project directory, so the project is `process.cwd()` for free. An HTTP server is one machine-wide process that cannot know which project a request concerns; every tool would need a project-path argument that the agent must supply correctly. That is a correctness regression, not an inconvenience.

**A port contradicts the product.** Runestone exists in part to reduce port conflicts between local projects. Claiming another port — configurable, conflict-checked, documented, surfaced in `doctor` — argues against the product's own premise. The existing dependency on `node-netstat` shows port conflict is already a live concern here.

Three smaller reasons: stdio has no lifecycle for Runestone to own, because the client starts and stops it; it needs no authentication, whereas a localhost HTTP endpoint exposing certificate lists, service lists and filesystem paths is reachable by every process on the machine; and every client configuration format takes `command` and `args` as its primary shape.

**The one case for HTTP that is real for this product** is an agent running inside a devcontainer, where the `runestone` executable is not present. It is not a reason to build HTTP now: an installed `SKILL.md` is committed into the project and therefore visible inside the container, already carrying the offline scalars, so only online collision checking is missing. The transport is a thin shell over pure tool functions, so a second transport remains additive — but adding it requires solving project identification explicitly. **This is the trigger to revisit, recorded here so that a successor does not mistake it for an oversight.**

### 11.2 Tools

Four, all read-only, all annotated `readOnlyHint: true`. **None takes a topic.**

| Tool | Input | Returns |
| --- | --- | --- |
| `runestone_integration_guide` | `offline` | How to connect this project: both paths, how to choose between them, the field rules, and the commands the agent must not run |
| `runestone_troubleshoot` | `offline` | Symptom to cause: 404, 502, TLS warning, and "works in the browser, fails from another container" |
| `runestone_status` | `offline` | The snapshot, plus a short text summary |
| `runestone_check_name` | `serviceName`, `route`, `offline` | Whether each is available, why not, the covering certificate if any, and the `certs create` command if not |

**There is no `topic` parameter, and its removal is a correction rather than a simplification.** The first version of this surface mirrored the CLI's topic split onto MCP, without asking whether the constraint that produced that split still applied. It does not.

The split exists because a CLI invocation is a process and its output goes into a prompt whose context is scarce, so fetching one topic beats fetching five. On MCP neither holds: the client keeps the connection open, so a second call is nearly free, and **tool selection already exists** — the model chooses a tool from `tools/list` by its description. A `topic` enum makes it choose twice, and the inner choice has to be made *before* it has seen anything that would inform it.

Worse, one enum was doing three unrelated jobs:

| Former topic | Actual intent | Why it did not belong |
| --- | --- | --- |
| `overview`, `compose`, `service` | "How do I connect this project?" | One intent split three ways. `overview`'s whole job is to say "choose between these two paths", so splitting it demanded a guess before supplying the basis for the guess |
| `troubleshoot` | "It is broken, why?" | A different intent, and therefore a different tool |
| `state` | "What is true right now?" | Already `runestone_status`: the same snapshot, only rendered as prose instead of returned as data |

Measured, so the size objection is answered rather than waved away: `overview` is 4.3 KB, `compose` 3.3 KB and `service` 5.0 KB, so the merged guide is about 12 KB. The shape it replaces cost 4.3 KB for the index, then a guess, then 3.3 or 5.0 KB — and a wrong guess cost both. One call of 12 KB is the cheaper path as well as the simpler one.

Going from three tools to four is a real cost, and section 11.2 elsewhere argues that every extra tool degrades tool selection. It is accepted here because four well-named tools are easier for a model to choose between than three where one carries a six-value enum.

**`all` is a CLI value and has no MCP equivalent** (section 5.1). It exists so a human can paste everything at once, where a second invocation costs a process and possibly another human action. On MCP that need does not arise, and a 20 KB dump works against the reason the corpus is split at all.

**The corpus is shared; only the access shape differs.** Both surfaces render the same topic assets through the same renderer. What changed is how a caller asks for them, because the two callers select differently.

`runestone_check_name` is the tool that prevents wrong edits, and it is composed entirely of existing validators — `validateServiceName`, `normalizeRouteDomain`, `serviceExists`, `assertNoTraefikNameConflict`, `assertNoTraefikHostConflict`, `findCoveringCertificate`. Their exceptions become an unavailable verdict with a reason; nothing throws.

Separate list-certificates and list-services tools are deliberately omitted: they are already fields of `runestone_status`.

### 11.3 Read-only, as a design constraint

Not a phased shortcut.

1. `AGENTS.md` makes the interactive prompt a **contract**, not an implementation detail, and states that a shared helper does not excuse per-entry-point coverage. An MCP call has no prompt to return to.
2. The interactive path is **physically impossible** over stdio: `@clack/prompts` writes to stdout, so reusing the existing command flow inside a handler would corrupt the protocol stream. There is no version of "just call the existing command" that works.
3. **No human is present at the moment of the change.** A client's tool approval is per-tool and often per-session; it is not per-call informed consent and cannot render Runestone's disclosure as a blocking gate.
4. Little is lost. `runestone_check_name` does the hard part, and `runestone_context` returns the exact command line for the human to run in their own terminal, where the prompt rules and the disclosure both still apply. The agent proposes; the person executes.

Should this be overruled, the gates are all of the following: an `--allow-write` flag typed into the client configuration by hand and never defaulted or shipped; an allowlist of exactly `service add` and `service remove`; a `dryRun` input defaulting to true; a plan hash returned by the dry run that the write call must echo back; `destructiveHint: true`; the disclosure text carried verbatim in the tool description; and an append-only audit log.

### 11.4 Registration

Runestone does not write another tool's configuration file. `runestone mcp config` prints a block and the user pastes it.

The shapes differ, and every difference produces a configuration that silently does not work rather than one that errors. Eight clients, each row read from that vendor's own documentation and carrying the URL and the date it was checked:

| `--client` | Location | Format | Key | `type` |
| --- | --- | --- | --- | --- |
| `claude` | `.mcp.json` at the project root | JSON | `mcpServers` | `stdio` |
| `codex` | `~/.codex/config.toml`, or `.codex/config.toml` | **TOML** | `[mcp_servers.<name>]` | — |
| `copilot` | `~/.copilot/mcp-config.json` | JSON | `mcpServers` | **`local`** |
| `cursor` | `.cursor/mcp.json`, or `~/.cursor/mcp.json` | JSON | `mcpServers` | `stdio` |
| `vscode` | `.vscode/mcp.json` | JSON | **`servers`** | `stdio` |
| `gemini` | `~/.gemini/settings.json` | JSON | `mcpServers` | — |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` | JSON | `mcpServers` | — |
| `zed` | the Zed settings file | JSON | **`context_servers`** | — |

Three of these are not variations on a theme. **Codex is TOML**: a JSON block pasted into `config.toml` is not a configuration at all. **`type` is not a yes-or-no field**: VS Code documents `"stdio"`, Copilot CLI documents `"local"`, and Gemini, Windsurf and Zed show `command` and `args` alone — so each row emits exactly the shape its cited documentation shows, because emitting a field, or a value, a vendor does not document is a guess a schema validator may reject.

**VS Code and GitHub Copilot CLI are different clients**, routinely assumed to share configuration. They differ in file, key and `type` value, and VS Code's own documentation states the Agent Host does not read `.vscode/mcp.json`. Both rows cross-reference the other.

Where a client has its own registration command — `claude mcp add`, `codex mcp add`, `copilot mcp add` — it is printed above the block, because a command the user runs cannot be pasted into the wrong file.

Project-scoped `.mcp.json` requires the user to approve the server on first use in an interactive session, and does not prompt in non-interactive ones. The user documentation must say so, or a working installation will look broken.

### 11.5 stdout purity

stdout carries protocol frames and nothing else.

- `src/commands/mcp.ts` and `src/services/mcp/**` must contain no `console.log`, no `process.stdout.write`, and no import of the logger or of `@clack/prompts`. They must also not contain the strings `child_process`, `spawnSync` or `execSync` **even inside a comment**, because the acceptance test matches file text.
- **The logger is a stdout writer.** Verified: `info`, `success` and `debug` all use `console.log`. The rule is "do not import the logger", not "route warnings carefully". The MCP layer gets its own stderr-only logger, gated on `DEBUG`.
- Every service reachable from a handler is audited. `composeService` captures child output rather than inheriting it; the Traefik reader and the two list functions write nothing. `environment-doctor`'s install path uses `stdio: 'inherit'` and must never be reachable — which read-only tools guarantee.
- `mcp serve` must not exit before stdout has flushed.

## 12. Failure Handling

- Every writing operation is paired with its inverse, and a failure mid-write leaves no half-applied state: writes are atomic through a same-directory temporary file and a rename, following `daemon-file.ts`.
- An unrecognized topic, an invalid name, or an unconfigured Runestone is a **correctable** condition: the message carries the fix. This is the same principle as the same-prompt correction rule, applied to a machine reader.
- Docker or Traefik being unreachable is **not an error**: the answer remains useful, so it is a warning plus an absent value inside a successful result.
- A protocol or internal fault is an error. Nothing else is.

## 13. Compatibility and Migration

- A bare `runestone docs --ai-context` behaves as before, with content appended (section 7.2).
- `tool-docs/ai-prompt-context.tmp.md` is removed and its content becomes the `compose` topic. `renderAiPromptContext()` keeps its signature as a thin wrapper for one release.
- `src/utils/tool-docs.ts` must be **deleted** when `src/utils/tool-docs/` is created. Leaving both would silently keep the old renderer live, because module resolution prefers the file.
- `README.md` currently links `runestone-cli/tool-docs/ai-prompt-context.tmp.md`. That link resolves on GitHub but is already broken in the npm copy, and the file is removed here. `scripts/sync-readme.js` rewrites six specific link patterns and needs a rule for every new documentation link.
- No `.env` field is added and no state schema is introduced (section 9.1).

## 14. Test Plan

### 14.1 Offline unit tests

- Renderer: byte-identical `compose` output against a committed fixture; a value containing `$&`, `$1` and `$$` substituted literally; an unknown token throwing; manifest and topic files in bijection.
- Snapshot: every row of 6.3; zero spawns, with a spy on `spawnCommand`; zero writes to stdout and stderr; `JSON.parse(JSON.stringify(snapshot))` deep-equal to the snapshot; no string field containing `'✓'`, `'✗'` or an escape character.
- Write boundary (8.4): every path each target renders lies inside `<skills-dir>/runestone/`, and none is an `AGENTS.md`, a `CLAUDE.md` or a `.mdc`. Verified by injecting a deliberate `AGENTS.md` write and confirming that the test fails.

### 14.2 Command entry-point tests

Through `createProgram().parseAsync`, with services mocked, following `tests/commands/status.test.ts`. Interactive correction is tested here, not only at the helper.

### 14.3 Integration

- Both existing golden tests pass **unedited**.
- Table-driven: each topic exits 0 with `stderr === ''`, non-empty stdout, and no `{{`.
- Unconfigured, every topic: exit 1 and empty stdout.
- `status` and `install --dry-run` write nothing, proven by a recursive hash before and after, including no backup file.
- Install into a fixture git repository: `git status` lists exactly the planned paths.
- `skills-ref validate` passes on the generated skill directory.
- A process-level MCP handshake: a real `initialize`, `notifications/initialized` and `tools/list` on stdin; exit 0, `stderr === ''`, and every stdout line a JSON-RPC frame with the expected ids and nothing else. **This is the most valuable test in the plan** — the only one that catches a stray write added later by someone reusing a service that grew one.
- A packed tarball installed globally renders every topic, which is the only way to prove the asset path is right in `dist/`.

### 14.4 Manual verification

The purpose of this feature is not provable by unit tests. After the online tier lands, give an agent nothing but `runestone docs --ai-context` in two real projects — one host dev server, one Docker project — and record whether it selects the correct path, an available hostname, and a non-colliding name. Evidence goes in `docs/evidence/skill/`.

## 15. Decisions

All settled by the repository owner on 2026-09-07.

1. **The generated corpus is English only.** It is a prompt for a machine, it is committed into the user's repository where English is the lingua franca of configuration, and localizing it would apply the structural-parity gate to every one-sentence edit. Operator-facing messages still go through `t()` in all three locales. This is a deliberate departure from the CLI's i18n rule and is recorded as such.
2. **Settled as: hand-written, not the SDK.** ~~`@modelcontextprotocol/sdk` is adopted, gated by measurement.~~ **Overturned on 2026-09-08 by the gate that existed to overturn it.** C1 adopted the SDK and passed technically — no `paths` mapping was needed after all, `engines.node` was unchanged, no new vulnerabilities — but the measured cost was **107 production dependencies and about 15 MB against a baseline of 13**. Bundling was also measured and worked (364 KB, clean handshake), but it moves dependency security from npm to us and adds a bundler to a `tsc`-only build. The owner ruled for the hand-written server. C1 was reverted; production dependencies remain at 13.

   What the SDK was buying, now owned here: **protocol conformance**. Five methods is a small surface, but MCP revises quickly, and a break presents to the user as "my agent cannot see Runestone" with nothing in the output to explain it. `PROTOCOL_VERSION` in `src/services/mcp/jsonrpc.ts` is the thing to bump, and the process-level handshake test is the thing that catches a break.
3. **The MCP server is read-only** (section 11.3).
4. **`troubleshoot` is in scope.** It is the only place "works in the browser, fails from another container" can land, and that is the most common failure after integration succeeds.
5. **User scope is scheduled last, and was then built.** It is the only home-directory write, and it serves cross-project convenience rather than the purpose in section 1, so it was specified here and sequenced last such that dropping it would have cost nothing. It was taken up on 2026-09-08 and is done, verified on Windows; the Linux half of its manual gate is not met.
6. **stdio, not HTTP** (section 11.1).
7. **Runestone writes no instruction file.** Ruled on 2026-09-09, and the only decision here that was not settled before implementation — because it was never put as a question. The owner's request had been a skill and an MCP server; the marked block in `AGENTS.md` and `CLAUDE.md`, and the Cursor rules file, were assumed into 8.2 while this document was written, and then built. Removed in full: the marker engine, the `--instructions-file` option, the `cursor` target, and the blockers that only a malformed marker in someone else's file could raise. See 8.4.

## 16. Milestones and Risk Control

### 16.1 The risk ladder

Nothing here can interrupt a machine. This ladder is much shallower than the DNS feature's, and over-fragmenting a feature whose worst failure is a stray file in a git repository is its own kind of error.

| Level | Impact | Recovery |
| --- | --- | --- |
| 0 | Fixtures and temporary directories; no user-visible change | nothing to recover |
| 1 | Output appended to an existing command; reads the user's real paths, writes nothing | nothing to recover |
| 2 | A path that spawned nothing now spawns Docker or makes a network call; or writes into the user's repository | `git status` shows it; `skill remove`; a backup beside it |
| 3 | Writes into the user's home directory, which is not under version control; or runs a long-lived process speaking a protocol | our backup and `skill remove` only |

Level 3 sits above 2 because a repository is almost always version-controlled and a home directory is not.

### 16.2 Ordering rule

A milestone may raise the level by at most one step, and the level below must be green first. Every milestone is a single-`git revert` increment; this is a hard constraint, not an aspiration.

### 16.3 Milestones

Sequenced in `SKILL-MILESTONES.md`, which records progress and gates. Phases A, B and C are independently shippable, so work may stop at the end of any of them.

| # | Milestone | Level |
| --- | --- | --- |
| A0 | This document and the milestones document | 0 |
| A1 | Renderer and topic corpus; output byte-identical | 0 |
| A2 | Offline snapshot module | 0 |
| A3 | `--ai-context [topic]` and `--offline` wired, offline tiers only | 1 |
| A4 | Online tier: collision detection | 2 |
| B1 | Marker-block ownership engine, pure — **removed on 2026-09-09, see 8.4** | 0 |
| B2 | `skill status` and `skill install --dry-run` | 1 |
| B3 | `skill install` and `skill remove`, target-directory scope | 2 |
| B4 | The full target table and its wrappers | 2 |
| C1 | MCP dependency spike, revertible by design | 0 |
| C2 | `runestone mcp serve`, read-only | 3 |
| C3 | `mcp config`, documentation, release | 1 |
| B5 | User scope | 3 |
| C4 | MCP tool surface: drop the topic enum | 3 |

A3 is the first user-visible milestone.
