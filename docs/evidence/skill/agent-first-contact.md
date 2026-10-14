# An agent's first contact with Runestone: read-only probes before and after

*正體中文：[agent-first-contact.zh-TW.md](agent-first-contact.zh-TW.md)*

**Date.** 2026-10-14 · **Branch.** `feat/agent-first-contact` (before: `4a677b5`, 2.1.0; after: `bf1fab4`, with the follow-up fix `a118051`) · **Machine.** Windows 11, Docker Desktop, Runestone DNS enabled

This is the kind of evidence specification 14.4 has always lacked: an agent given only the CLI and a hypothetical project, recorded doing what it actually does rather than what it is reasoned to do.

## Method

Three read-only agents with no prior assumptions. Each knew only that a `runestone` command exists on this machine, plus one hypothetical project. They were allowed read-only commands only, and had to stop and write down any write or state change instead of performing it. They were not told what Runestone is, nor what had changed.

| Scenario | Entry point | Project |
| --- | --- | --- |
| Cold start × host | `runestone --help` only | `shop-web`: `vite --port 5173`, no Docker files at all |
| Skill × Docker | the runtime has loaded SKILL.md | `inventory-api`: `api` (`"8080:3000"`) and `db`, no override |
| Cold start × Docker | `runestone --help` only | same as above |

**Differences between the two runs, recorded as they were.** In the re-run, bare `runestone docs` was allowed (the first run forbade it, because it crashed without a terminal); `runestone doctor` was removed from the allowed list (the first run allowed it, but it is not read-only); and every agent first read a handoff file describing only the shared environment. The skill scenario used the SKILL.md of its day, which differs between the runs; that difference is what is being compared.

**Limits of this evidence.** One run per scenario, and model output varies; the probe agents and the author are the same model family; the projects are hypothetical and nothing was actually connected. It shows what an agent does when it follows the tool's own text, not a success rate.

## Results

| Scenario | Commands (before → after) | Path | Near-misses before | Near-misses after |
| --- | --- | --- | --- | --- |
| Cold start × host | 23 → 14 | Before: right, by its own account by luck (it read `docs --help` first). After: right directly | The bare default told it to "create compose.yml"; verification made no request, so Vite's refusal page would have been reported as success | None; it added Vite `allowedHosts` up front |
| Skill × Docker | 13 → 3 | Right both times | Attaching the network as written cuts `api` off from `db`; verifying by status code passes on a broken setup | None; the template keeps `- default`, verification checks the page |
| Cold start × Docker | 10 → 5 | Right both times | The same two; "would have run bare `runestone docs` first" (which crashed) | None; the root help points straight at `docs --ai-context` |

In neither run did an agent attempt a forbidden command or want to install its own Traefik or Mailpit. In the first run all three worked out a hostname and then listed it as a question for the user; in the re-run all three chose one and said so in their report.

## One-time measurements made during the implementation

Facts checked before they went into the corpus. They are premises about dependencies and deployment configuration, not tests of this project.

| Claim | How | Result |
| --- | --- | --- |
| Listing `networks:` in an override drops the implicit `default` | `docker compose config` on three files: base only (control), runestone only, both | Base: `default`; runestone only: `runestone` alone; both: both, `db` unaffected |
| A container on the Runestone network can send mail to `runestone:1025` | A `--rm` temporary container from the Runestone image, sending `EHLO` | Mailpit answers 220; extensions are SIZE, ENHANCEDSTATUSCODES and SMTPUTF8 only, no AUTH, no STARTTLS. Negative control: port 1026 refuses |
| `localhost:1025` from the host | A direct Node connection | Mailpit answers 220 |
| Ordinary containers resolve `host.docker.internal` | One temporary container each on the default bridge, the Runestone network and another user-defined network | **NXDOMAIN in all three**; reachable with `--add-host host.docker.internal:host-gateway`. One variable changed: with `--dns 192.168.65.7` it resolves; the default resolvers are daemon.json's `192.168.65.254` and `1.1.1.1`. The corpus therefore always gives the `extra_hosts` line with the address |
| HTTP redirects to HTTPS | `curl` an unrouted hostname | 301 → `https://…` |
| An unrouted hostname is not a 404 | `curl --ssl-no-revoke` the same hostname | 200, `<title>Service not found!</title>` |
| curl on Windows fails on local certificates | Git Bash's curl and `curl.exe` (both 8.21.0, Schannel) | Both `CRYPT_E_NO_REVOCATION_CHECK`; with `--ssl-no-revoke` the Traefik dashboard answers 302 |
| Host checks in Vite and webpack-dev-server | Their official documentation | Vite `server.allowedHosts` allows localhost, `.localhost` and IP addresses by default; webpack-dev-server `allowedHosts: 'auto'` allows localhost, its own host and the websocket hostname. Neither documents the status code of a refusal, so the corpus describes the message only |
| `runestone docs` crashes without a terminal | `node bin/runestone docs < /dev/null`, and with an open pipe | Before: an `ERR_TTY_INIT_FAILED` stack. After: the README address and "AI agents: run `--ai-context`", exit 0 |

## Gaps still open after the re-run

The follow-up commit `a118051` fixed: the footer not listing `guide` and `all`, the three topics disagreeing on where the hostname comes from, the order of "do not stop to ask" and "ask before committing", and Vite `allowedHosts` coming too late. The following are new scope and were not handled on this branch:

- Neither the corpus nor `status` says how the host resolves Runestone domains (measured: public DNS returns 127.0.0.1), and there is no fact for whether the host trusts the CA. All three probes checked with `nslookup` or `curl` on their own.
- `dns status` warns that the DNS UI has no authentication, but neither the problems of `status` nor the "Nothing to flag" of `state` mention it.
- Once a project's service joins the shared Runestone network, its Compose service name (such as `api`) becomes an alias on a network every project shares; if another project puts a `db` on it too, name resolution could collide.
- The bare guide is about 20 KB: the footer is printed three times, and the hostname and taken-name blocks twice each.
- The troubleshoot topic ends with "Container state was not checked.", which reads like a failure but only means that topic does not query containers.
- Why `host.docker.internal` does not resolve with Runestone DNS enabled (table above), and whether the DNS feature should handle it, has been split into its own task.
