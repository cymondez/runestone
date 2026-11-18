# Runestone For AI Agents

English | [繁體中文](AI-AGENTS.zh-TW.md) | [日本語](AI-AGENTS.ja-JP.md)

Runestone can tell an AI coding agent how to connect your project to it, so you
do not have to explain it yourself.

This is only about connecting a project. It assumes Runestone is already
installed and configured; nothing here asks an agent to set it up, and the
commands below produce nothing until `runestone setup` has been run.

## What the agent gets

Three things it cannot work out on its own.

**What Runestone already runs.** Traefik and Mailpit are already running for
every project on the machine. The guidance tells the agent not to add its own
reverse proxy or mail catcher, and where to send the project's mail.
`runestone status` shows the same addresses.

**Which of the two integration paths applies.** A project that runs in Docker is
connected with Traefik labels. A host dev server, an already-running process or
an external URL is connected with `runestone service add`: a route you add
yourself, not a service Runestone provides. Getting this wrong
fails quietly: labels on a project with no container are inert, and a
file-provider entry pointing at `localhost` reaches the Runestone container
rather than your machine.

**Facts about this machine.** Which hostnames a certificate covers, and which
router and service names are already registered — including by other projects,
which is not visible from your project at all. The agent checks the name and
hostname it chose with `runestone service check`, which changes nothing. The
shared resources you declared with `runestone resource add`, such as one
Postgres for every project, are listed too, so the agent uses them rather than
adding its own.

## Three ways to use it

### Print the guidance

```bash
runestone docs --ai-context
```

Prints the whole guide: how to choose between the two ways of connecting a
project, then both of them. Add a topic for one part:

```bash
runestone docs --ai-context state          # live facts about this machine
runestone docs --ai-context troubleshoot   # a route that does not work
runestone docs --ai-context compose        # only the path for a project in Docker
runestone docs --ai-context service        # only the path for something not in Docker
runestone docs --ai-context all            # everything, including the live facts
```

`runestone docs --help` lists every topic.

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
| Codex, Cursor, VS Code, and anything reading the shared location | `.agents/skills/runestone/` |
| Claude Code | `.claude/skills/runestone/` |
| GitHub Copilot | `.github/skills/runestone/` |

`.agents/skills/` is the shared location several tools agree on, so one write
covers most of them. Claude Code reads its own path instead, which is why it
gets a second copy.

**Runestone installs a skill and nothing else.** It does not write into your
`AGENTS.md` or your `CLAUDE.md`, and it installs no rules file: those carry your
own instructions to your agent, and every tool in the table finds a skill by
scanning those directories anyway.

If your tool is not listed, or its paths have moved, name the directory
yourself:

```bash
runestone skill install --skills-dir .mytool/skills
```

Runestone owns only what it wrote. Every file it installs carries its marker, it
never removes one that does not, and it leaves alone anything you edited
afterwards.

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
you to run; it never changes anything. Four tools:

| Tool | What it answers |
| --- | --- |
| `runestone_integration_guide` | How to connect this project: both paths, which one applies, the field rules |
| `runestone_troubleshoot` | Why a route is not working |
| `runestone_status` | The machine facts, as structured data |
| `runestone_check_name` | Whether a name and a hostname are free — before your agent writes them into a file |

There is no topic to choose. The agent picks a tool, which is a choice it is
already making, rather than picking a tool and then a topic inside it.

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
| `runestone resource add`, `modify`, `remove` | The list is your statement of what runs on this machine, for every project |

It will run `runestone service add`, `runestone service remove` and
`runestone certs create` as part of connecting your project, and read-only
commands such as `runestone status` whenever it needs to look something up.

## If something looks wrong

**The command prints nothing and exits with an error.** Runestone is not
configured yet. Run `runestone setup`.

**The agent reports "There is no terminal to answer this question".** It ran a
command that wanted to ask you something, from a shell that has no terminal.
The message says what to pass instead: `runestone service add`, for instance,
needs the name, `--route` and `--url` on the command line, and a hostname a
certificate already covers.

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
