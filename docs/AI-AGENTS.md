# Runestone For AI Agents

English | [繁體中文](AI-AGENTS.zh-TW.md) | [日本語](AI-AGENTS.ja-JP.md)

Runestone can tell an AI coding agent how to connect your project to it, so you
do not have to explain it yourself.

This is only about connecting a project. It assumes Runestone is already
installed and configured; nothing here asks an agent to set it up, and the
commands below produce nothing until `runestone setup` has been run.

## What the agent gets

Two things it cannot work out on its own.

**Which of the two integration paths applies.** A project that runs in Docker is
connected with Traefik labels. A host dev server, an already-running process or
an external URL is connected with `runestone service add`. Getting this wrong
fails quietly: labels on a project with no container are inert, and a
file-provider entry pointing at `localhost` reaches the Runestone container
rather than your machine.

**Facts about this machine.** Which hostnames a certificate covers, and which
router and service names are already registered — including by other projects,
which is not visible from your project at all.

## Three ways to use it

### Print the guidance

```bash
runestone docs --ai-context
```

Prints the compose brief. Add a topic for the rest:

```bash
runestone docs --ai-context service        # not in Docker
runestone docs --ai-context state          # live facts about this machine
runestone docs --ai-context troubleshoot   # 404, 502, certificate warnings
runestone docs --ai-context overview       # how to choose, and what not to run
```

Every topic ends with the list of the others, so an agent that runs the bare
command finds the rest by itself.

### Install it into a project

```bash
runestone skill install
```

Writes the guidance where your agent tools already look, so nobody has to paste
anything. It detects which tools the project uses and writes only for those.

Preview first — this writes into your repository:

```bash
runestone skill install --dry-run
```

`runestone skill status` shows what is installed and whether it is current.
`runestone skill remove` takes it back out.

Where it writes:

| Tool | Destination |
| --- | --- |
| Codex, Cursor, VS Code, and anything reading the shared location | `.agents/skills/runestone/` and a section in `AGENTS.md` |
| Claude Code | `.claude/skills/runestone/` and a section in `CLAUDE.md` |
| Cursor rules | `.cursor/rules/runestone.mdc` |
| GitHub Copilot | `.github/skills/runestone/` |

`.agents/skills/` is the shared location several tools agree on, so one write
covers most of them. Claude Code reads its own paths instead, which is why it
gets a second copy.

If your tool is not listed, or its paths have moved, name them yourself:

```bash
runestone skill install --skills-dir .mytool/skills --instructions-file MYTOOL.md
```

Runestone owns only what it wrote. It adds a marked section to a file you
already have and never rewrites the rest, it backs a file up before changing it,
and it leaves alone anything you edited afterwards.

### Connect it as an MCP server

```bash
runestone mcp config --client claude
```

Prints what your client needs. Supported: `claude`, `codex`, `copilot`,
`cursor`, `vscode`, `gemini`, `windsurf` and `zed`; omit `--client` to see them
all. Note that `vscode` and `copilot` are different tools with different
files — VS Code's own documentation says the Agent Host does not read
`.vscode/mcp.json`.
Runestone prints rather than editing your client's configuration itself.

The shapes are not interchangeable, which is why this command exists at all.
Codex uses TOML, not JSON. VS Code uses the key `servers` and Zed uses
`context_servers`, where the rest use `mcpServers`. Where a client has its own
registration command — `claude mcp add`, `codex mcp add` — that is printed too,
because a command you run cannot be pasted into the wrong file.

The server is read-only. It answers questions and returns the exact command for
you to run; it never changes anything. Its most useful tool is
`runestone_check_name`, which says whether a name and a hostname are free before
your agent writes them into a file.

**You do not start or stop it yourself.** Unlike `runestone up`, this is not a
background service. Your client launches it when a session begins and closes it
when the session ends, so there is nothing to shut down and nothing left running
afterwards.

If you run it in a terminal to look at it, it will sit there waiting for input.
That looks like a hang and is not: it is a server with nobody talking to it.
Press Ctrl+D to close its input and it exits cleanly, or Ctrl+C to stop it
outright. Running it by hand is only useful for a quick check:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | runestone mcp serve
```

Note for Claude Code: a project-scoped `.mcp.json` asks for your approval the
first time it is used in an interactive session. If nothing seems to happen at
first, that prompt is what you are waiting for.

## What an agent will not do

The guidance tells the agent to propose these and leave them to you, because
they change things beyond the project it is working on:

| Command | Why |
| --- | --- |
| `runestone dns enable`, `runestone dns disable` | Restarts the Docker daemon, which stops every container on the machine |
| `runestone certs install` | Needs elevation and modifies the system trust store |
| `runestone setup` | Rewrites the configuration every project shares |
| `runestone down` | Removes the environment, and with flags its data too |
| `runestone up`, `runestone stop` | Changes what is running for every project |

It will run `runestone service add`, `runestone service remove` and
`runestone certs create` as part of connecting your project, and read-only
commands such as `runestone status` whenever it needs to look something up.

## If something looks wrong

**The command prints nothing and exits with an error.** Runestone is not
configured yet. Run `runestone setup`.

**The installed guidance is out of date.** Upgrading Runestone does not rewrite
files already in your repository. `runestone skill status` reports it, and
`runestone skill install` brings it up to date.

**A file you edited was left alone.** That is deliberate. Runestone will not
overwrite a change you made; `--force` overrides it, and keeps a backup.

**The agent suggests a hostname that shows a certificate warning.** No
certificate covers it. `runestone certs create <base domain>` fixes it, and
coverage is one level deep — a certificate for `example.test` covers
`api.example.test` but not `a.b.example.test`.

**It works in the browser but not from another container.** That is the loopback
problem, not a misconfiguration. See [DNS documentation](DNS.md).
