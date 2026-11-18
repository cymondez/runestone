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
- ~~`dns status` warns that the DNS UI has no authentication, but neither the problems of `status` nor the "Nothing to flag" of `state` mention it.~~ Fixed in `e2c5e95`.
- Once a project's service joins the shared Runestone network, its Compose service name (such as `api`) becomes an alias on a network every project shares; if another project puts a `db` on it too, name resolution could collide.
- ~~The bare guide is about 20 KB: the footer is printed three times, and the hostname and taken-name blocks twice each.~~ Fixed in `e2c5e95`: with `--offline`, the guide went from 21,924 to 19,770 bytes and `all` from 31,249 to 26,786. What remains is content, not repetition.
- ~~The troubleshoot topic ends with "Container state was not checked.", which reads like a failure but only means that topic does not query containers.~~ Fixed in `e2c5e95`.
- ~~Why `host.docker.internal` does not resolve with Runestone DNS enabled (table above), and whether the DNS feature should handle it, has been split into its own task.~~ The dns service now answers it with the Target IP, in image `cymondez/runestone-dns:1.1`; see DNS-FEATURE-SPEC 8.3.

## Follow-up measurements (2026-10-14, after `e2c5e95`)

Three of the open gaps needed a measurement before deciding whether to change anything. All three were then implemented: the root CA check in `0f29ba3`, the unresolvable-domain report in `23ea9a6`, and the shared-network names in `384b836`.

| Question | How | Result |
| --- | --- | --- |
| How does the host resolve Runestone hostnames? | `dns.lookup` (getaddrinfo, which honours the hosts file) from Node on the host | `traefik.local.developers-homelab.net`, an unrouted name under it, and `mysite.traefik.me` all give 127.0.0.1 (2, 15 and 334 ms). A name under a nonexistent domain gives `ENOTFOUND` in 15 ms |
| What does `status` say when the host cannot resolve the domain? | The existing Traefik probe against an unresolvable name | It fails with `getaddrinfo ENOTFOUND`, so `status` reports it, but under "Traefik's API did not answer" with a fix (open the dashboard, `up --force-recreate`) that is wrong for a DNS failure |
| Can the CLI tell whether the host trusts Runestone's CA? | `tls.getCACertificates('system')` (present in Node 22.22.3) compared by SHA-256 fingerprint with `~/.runestone/certs/rootCA.pem` | In the system store: true. Control, Node's bundled list: false. Reading the system store took 0.5 ms and needs neither Docker nor Traefik |
| Does that answer match what a TLS client sees? | `https.get` of the Traefik dashboard with `rejectUnauthorized: true`, `ca` set to the system store, then to the bundled list | System store: HTTP 200. Control, bundled list: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| Can a service on two networks resolve a sibling's name to another project's container? | Temporary networks and `--rm` containers only, never the real shared network: a project `db` on the project network, another project's `db` on the shared network, `api` on both; `dig db @127.0.0.11`, ten times per case | Control, `api` on its own network only: always its own `db`. On both networks, with the shared network created first in both cases: **when the shared network's name sorts first, every lookup returned the other project's `db`; when it sorts last, every lookup returned its own.** The attach order did not change the answer, and neither did network ID order. libc (`getent`) agreed with `dig` |

What follows for the last row, and what this does not show:

- The real shared network is `runestone-network` and a Compose project's network is `<project>_default`. A project whose name sorts after `runestone-network`, such as anything starting with s to z, resolves a name that also exists on the shared network to the other project's container. On this machine that already includes `vllm_default` and the three `webhub-*` networks.
- Compose registers every service's own name as an alias on each network it joins, so the names on the shared network are those of the services other projects expose: `api`, `web`, `app`, `frontend`. A database is rarely among them. The realistic failure is an exposed frontend calling `http://api:...` and reaching another project's `api`.
- Measured on one Docker Desktop version on one machine. The ordering is Docker's implementation, not a documented contract, so guidance should say what to check rather than promise an order.

## Unrouted hostnames answer 404 (2026-11-18)

The table under "One-time measurements" records an unrouted hostname answering 200. That was the image's nginx serving the page itself for `/`, not the error-page middleware. `docker/catchall/nginx.conf` now answers every path with 404 and the page, in image `cymondez/runestone:5.3`.

Measured with two temporary containers of the 5.2 image, `--providers.docker=false`, on other ports, differing only in the mounted `nginx.conf`; `curl -k --resolve` against an unrouted name:

| Path | 5.2 nginx.conf (control) | New nginx.conf |
| --- | --- | --- |
| `/` | 200, page | 404, page |
| `/index.html` | 200, page | 404, page |
| `/some/path` | 404, page | 404, page |

The error-page middleware keeps the original status and uses the body of its `/index.html` fetch even when that fetch itself answers 404, so an existing `traefik.dynamic.yml`, which `up` does not overwrite, keeps working.

## Headers Traefik sends to an app (2026-11-18)

One temporary Runestone container (5.2 image, `--providers.docker=false`, other ports) with a file-provider route to an nginx block that echoes the request headers. `curl -k --resolve` to that route:

| Request | What the app received |
| --- | --- |
| Plain | `X-Forwarded-Proto: https`, `X-Forwarded-Host: <hostname>:<port>`, `X-Forwarded-Port: <port>`, `X-Forwarded-For: <client>`, `Host: <hostname>` |
| With `X-Forwarded-Proto: gopher` and `X-Forwarded-Host: evil.test` from the client | The same as plain: Traefik replaced both |

The test port was 18445; through Runestone's own 443 the host carries no port. The corpus now tells an app behind Runestone to trust these headers, with Express's `trust proxy` as the example.
