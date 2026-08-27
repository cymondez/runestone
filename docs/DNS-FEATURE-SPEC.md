# Runestone DNS Feature Specification

English | [正體中文](DNS-FEATURE-SPEC.zh-TW.md)

## 1. About This Document

- Status: draft, pending review.
- This document replaces the earlier `docs/DNS-FEATURE-SPEC.md` from commit `8dc30c8`. The earlier version is void.
- It describes *what* to build and *why*; implementation details such as function decomposition are decided during implementation.
- **This feature is a necessary evil**: it modifies global Docker configuration that does not belong to Runestone. Section 2 states the costs first, then the design constraints derived from those costs. Every later section is an expansion of those constraints. If an implementation needs to deviate from one of them, return to 2.4 and identify what compensates for the corresponding cost.
- Findings verified on Windows 11 + Docker Desktop 29.6.2 (context `desktop-linux`) are marked "verified"; anything unconfirmed is marked "to be confirmed".
- **Section 16 is the milestone and risk-control plan, not an appendix.** Because enabling this feature modifies the machine's global state, the order in which it is built is itself a safety mechanism: implementation follows 16.3, and the risk level in 16.1 must not be raised ahead of schedule.

## 2. The Problem

### 2.1 One URL, two meanings

Runestone trades "a public wildcard DNS record pointing at `127.0.0.1`" for "the user never has to edit the hosts file". Verified: `api.local.developers-homelab.net` resolves to `127.0.0.1`.

That trade holds perfectly in the browser — `127.0.0.1` is exactly where Traefik binds ports 80 and 443. Inside a container, however, `127.0.0.1` is that container's own loopback. **The same hostname therefore means two different things depending on where it is resolved**: the browser reaches Runestone, the container reaches itself.

The real problem is not "containers cannot connect". It is that this failure lands precisely on Runestone's reason to exist. The target users described in `DESIGN.md` need to test HTTPS, cookies, OAuth redirects, webhooks and cross-subdomain behaviour — and all of those require **the browser and the server side to use exactly the same URL**:

- OAuth / OIDC issuer and redirect URI must match what the browser saw.
- Cookie domains, SSR base URLs, and webhook calls between projects.

Telling users to switch to `http://backend:3000` means telling them to give up testing those behaviours. What this feature must deliver is therefore: **make one hostname work both in the browser and inside containers.**

### 2.2 Why the Docker daemon configuration is the only option

Container-level workarounds all exist and all work, but they share one fatal flaw:

| Workaround | Why it is not enough |
| --- | --- |
| `extra_hosts: <domain>:host-gateway` in every project | Every project must enumerate every domain it talks to, and adding a domain means revisiting every project. Wildcard subdomains cannot be covered. |
| Docker network aliases | Resolves to the container IP and **bypasses Traefik** — TLS termination, routing rules and certificates are all lost. Same URL, different behaviour. |
| `dns: [<gateway ip>]` in every project | Still per-project configuration, and the host-gateway IP is machine-specific, so it cannot be committed to a shared repository. |
| Using container service names (`http://backend:3000`) | Gives up every scenario listed in 2.1. |

What they have in common is that **each project has to configure it**, which conflicts directly with Runestone's core value: a project only has to join the network and add Traefik labels.

The daemon `dns` setting is the only hook that is configured once, applies to every container on the machine, and requires no changes to any project. There is no second place that achieves the same thing.

### 2.3 Approach

Run dnsmasq on the host, answer every domain covered by a Runestone certificate with the IPv4 address of `host.docker.internal`, and insert that address at the front of the Docker daemon `dns` array so that every container query goes through it first.

### 2.4 This is a necessary evil: the cost list

The chosen approach carries costs that cannot be avoided. The design can only shrink them, never remove them:

1. `daemon.json` **is not Runestone's file**. Users and other tools write to it. We are modifying shared global state that we do not own.
2. Taking effect requires **restarting the Docker daemon**, which terminates every container on the machine, including projects unrelated to Runestone.
3. Once active, **name resolution for every container on the machine depends on a Runestone container**. People who do not know this feature exists will hit failures that look unrelated to Runestone.
4. It must occupy **port 53**, which systemd-resolved, ICS, Pi-hole and VPN clients may already be using.
5. Position matters (it must be `dns[0]`), so we modify **the ordering of a shared array** — the hardest kind of change to revert cleanly.
6. The daemon path, restart mechanism and bindable addresses **differ on every platform**, and so does the blast radius.
7. If a user removes Runestone without disabling the feature first, the machine is left with Docker DNS pointing at a container that no longer exists, **and the cause is hard to trace**.

### 2.5 Non-negotiable design constraints

Every row below exists to keep a cost from 2.4 under control. None of them is a matter of taste. Later sections are their expansion.

| Cost | Constraint | Section |
| --- | --- | --- |
| Modifying a file we do not own | Disabled by default; the only action is inserting our own entries at the front — one, or two when the optional fallback in 9.7 is enabled; never move, deduplicate or rewrite any existing item | 7.1, 9.1, 9.7 |
| The user keeps editing that file while the feature is enabled | Recognise only the entry we inserted; preserve the user's additions, ordering and formatting; whether to reorder automatically is the user's choice, defaulting to no change | 9.5, 9.6 |
| Hard to revert | Record what we did before doing it; on revert, remove only that item with no positional restoration; abort rather than guess when the record is missing; never restore a whole-file backup | 7.3, 9.2, 9.3 |
| Restart terminates every container | Require confirmation before restarting; complete all preflight checks before touching global state | 10.1, 11 |
| The whole machine depends on one container | `restart: unless-stopped`; `stop` leaves dns running; `down` revokes before tearing down; the optional fallback in 9.7 lets a user keep ordinary internet resolution working while dns is down | 8.2, 9.7, 10.2, 10.4 |
| Symptoms appear far from the cause | `dns status` and `doctor` must show ownership state and the current daemon contents; documentation must provide manual removal steps | 10.3, 10.4 |
| The user must understand what they consented to | Disclose concretely (with real paths and IPs) before every operation that touches global state; `--yes` does not suppress disclosure | 11.2, 11.3 |
| Any step can fail | Pair every mutation with a rollback; restore automatically on failure; never leave a half-applied state | 10.1, 12 |

Costs we explicitly refuse to pay: we do not modify the host operating system's resolver configuration, we do not change the contents or order of the user's `dns` entries (neither the pre-existing ones nor those added while the feature is enabled), we do not require any project to change its configuration, and we do not keep Runestone's changes when an operation fails.

## 3. Scope

### 3.1 In scope

- An independent `dns` Compose service (dnsmasq + webproc UI) using the Runestone-built multi-arch runestone-dns image.
- `runestone dns enable | disable | status`.
- DNS toggle, upstream DNS, optional daemon fallback entry and automatic-reordering settings in `runestone setup`, together with the matching risk disclosures.
- Ownership records, precise revocation and Target IP rotation for the Docker daemon `dns` array.
- dnsmasq mappings generated from the certificate list, integrated with `up` / `stop` / `down` / `certs` / `doctor`.
- Windows (Docker Desktop), WSL2 (Docker Desktop endpoint), macOS (Docker Desktop) and Linux (rootful Docker Engine).

### 3.2 Out of scope

- Changing the host operating system's own DNS configuration.
- Remote Docker contexts, Windows container mode, and rootless Docker that cannot bind port 53.
- IPv6 host-gateway resolution (IPv4 only).
- Letting users substitute the DNS image. Runestone pins its own image and does not allow overrides, to keep compatibility handling from spiralling.

## 4. Terminology

| Term | Definition |
| --- | --- |
| Runestone | The project as a whole: the CLI, the images and the local development environment. |
| runestone image | The main image `cymondez/runestone`, containing Traefik, Mailpit, nginx and mkcert. |
| runestone-dns image | The DNS-only image `cymondez/runestone-dns`, containing dnsmasq and webproc. |
| dns service | The Compose service named `dns`, container `${PREFIX}-dns`, running the runestone-dns image. |
| Target IP | The **IPv4** address obtained by resolving `host.docker.internal` from the Docker environment. Verified as `192.168.65.254` on Docker Desktop; on native Linux it is the docker0 gateway (typically `172.17.0.1`). |
| Bind IP | The address the dns service publishes port 53 on, on the host. Not necessarily the same as the Target IP — see 6.1. |
| Owned entry | An item Runestone wrote into the daemon `dns` array and recorded in ownership state. |
| Managed mapping | A dnsmasq `address=` rule generated automatically by Runestone from the certificate list. |
| Custom rules | dnsmasq rules maintained by the user. Runestone never overwrites them. |

## 5. Architecture

```text
containers from other projects
      │ DNS query
      ▼
Docker daemon dns[0] = Target IP
      │
      ▼
host Bind IP:53 (tcp+udp)  ──►  dns container (runestone-dns)
                                  ├─ dnsmasq :53
                                  └─ webproc :8080 (container network only)
                                          ▲
                          Traefik ────────┘  https://dns.<HOST_DOMAIN>
```

### 5.1 Why a separate service

Traefik, Mailpit and nginx are bundled into the runestone image for ease of management — they are the parts this environment always has. DNS is different:

- It is an **optional feature** that users switch on and off; people who leave it off should not be forced to run a process occupying port 53.
- It makes **invasive changes to the Docker daemon**, so when something goes wrong it must be possible to disable, diagnose and recover it on its own, independently of the core services.

The more fundamental difference is **blast radius**: if Traefik fails, only Runestone's own routing breaks; once dns is written into `daemon.json` it becomes the name-resolution dependency of every container on the machine, including projects unrelated to Runestone. Those differ by an order of magnitude and must not share one restart command.

Therefore dns is a separate Compose service, a separate container, a separate lifecycle and a separate image. The following three constraints follow from that, and cannot be expressed in a merged architecture:

1. `runestone stop` stops the main service but keeps dns running (see 10.4) — one container cannot be "half stopped".
2. `runestone down` revokes the daemon configuration first and aborts if revocation fails (see 10.2, 10.4) — this requires dns staying alive and the main service being torn down to be two independently ordered steps.
3. When port 53 cannot be bound, only dns fails to start; Traefik and Mailpit are unaffected (see 6.1).

Additionally, expressing the on/off state through a declarative mechanism such as a Compose profile is more reliable than a shell branch inside an entrypoint (the inverted condition in commit `3581211` is the classic risk of such branches), and dnsmasq's release cadence should not be tied to the runestone image's tag.

### 5.2 runestone-dns image decision

Build our own **`cymondez/runestone-dns`**, located in `docker/dns/`:

- Alpine base, `apk add dnsmasq`, plus a pinned webproc binary (selected by `TARGETARCH`).
- **Must provide both `linux/amd64` and `linux/arm64`** so Apple Silicon runs natively rather than under emulation.
- The ready-made `jpillora/dnsmasq` is not used: verified to be amd64-only, built on 2018-12-22 (dnsmasq 2.80, webproc 0.2.2), no longer maintained upstream, and therefore unable to meet the arm64 requirement.
- **The image and tag are written into the generated `compose.yml` by Runestone and cannot be overridden through environment variables.** Allowing overrides would turn the configuration file format, entrypoint arguments and webproc behaviour into uncontrollable compatibility burdens.
- The tag advances with CLI releases: when the dns image changes, publish a new tag and update the Compose template in the CLI source accordingly.

### 5.3 Corrections to the initial plan (commit `3581211`)

| Initial plan | Problem | This specification |
| --- | --- | --- |
| dnsmasq runs inside the runestone container | Tied to the main service lifecycle | Separate `dns` service with its own image |
| webproc listens on 8080 | Collides with the Traefik API at `runestone:8080` | webproc runs on 8080 inside its own container; no collision |
| dnsmasq starts only when `[ -z "$DNS_ENABLE" ]` | The condition is inverted (it starts when the value is empty) | Controlled by a Compose profile; the runestone image does not need this code |
| The dns-ui router lives in the image's `traefik.dynamic.yml` template | That file is only copied when `/configuration` lacks it, so existing users would never receive the new block | The CLI generates `configuration/dns/dns-ui.yml`; remove the `{{ if env "DNS_ENABLE" }}` blocks from the template |

## 6. Platform Behaviour

### 6.1 Bind IP and port 53

| Platform | Bind IP | Rationale |
| --- | --- | --- |
| Docker Desktop (Windows / macOS / WSL2) | `0.0.0.0` | The Target IP (`192.168.65.254`) is an address inside the Docker VM. No such interface exists on the host, so a port cannot be published to it. |
| Native Linux Docker Engine | Target IP (docker0 gateway, e.g. `172.17.0.1`) | That address genuinely exists on the host. Binding it avoids the `127.0.0.53` address held by systemd-resolved and does not expose port 53 to the whole LAN. |

- The CLI determines the Bind IP from the platform and Docker context and writes it to `DNS_BIND_IP` in `.env`; users may override it.
- **Whether port 53 is usable must be verified by actually starting the dns service, never by inspecting netstat alone.** Verified: the Windows Internet Connection Sharing (ICS) service holds `0.0.0.0:53/udp`, yet Docker still published `-p 53:53/udp -p 53:53/tcp` successfully and a container querying a managed domain at `192.168.65.254:53` received the Target IP. Reading netstat alone would have reported the port as unusable.

### 6.2 Daemon configuration file and restart mechanism

| Platform | Daemon configuration file | Restart mechanism |
| --- | --- | --- |
| Windows / macOS Docker Desktop | `~/.docker/daemon.json` | Try `docker desktop restart` first (to be confirmed); if unavailable, instruct the user to restart Docker Desktop manually |
| WSL2 (Docker Desktop endpoint) | The Windows-side `/mnt/<drive>/Users/<user>/.docker/daemon.json` | As above |
| Native Linux Docker Engine | `/etc/docker/daemon.json` | `sudo systemctl restart docker`, falling back to `sudo service docker restart` |

- Both restart paths must poll `docker info` until Docker responds again (120 second limit) before reporting success.
- Remote contexts and Windows container mode (`docker info` reporting an OSType other than linux) must abort before any daemon configuration is modified.

## 7. Configuration and Files

### 7.1 New `.env` fields

```dotenv
DNS_ENABLE=false
DNS_HOST_IP=            # Target IP, managed by Runestone
DNS_BIND_IP=            # Address port 53 binds to, managed by Runestone, overridable
DNS_UPSTREAM=1.1.1.1    # dnsmasq upstream, comma separated. Never empty (see 8.4)
DNS_DAEMON_FALLBACK=    # Optional second owned entry in the daemon dns array (see 9.7). Empty = off
DNS_AUTO_REORDER=false  # Move our own entries back to the front when they are not (see 9.6)
DNS_UI_ENABLE=true      # Whether to generate the dns.<HOST_DOMAIN> Traefik route
DNS_UI_USER=            # Optional, webproc basic auth user (HTTP_USER)
DNS_UI_PASS=            # Optional, webproc basic auth password (HTTP_PASS)
```

An absent `DNS_ENABLE` means disabled, so existing installations behave exactly as before after an upgrade.

### 7.2 Project files

```text
~/.runestone/
├── .env
├── compose.yml                       # gains the dns service (profile: dns)
├── certs/                            # existing
├── dns/
│   └── custom.conf                   # user editable (the file webproc edits), never overwritten
└── configuration/
    └── dns/
        └── dns-ui.yml                # Traefik route generated by Runestone
```

`dnsmasq.conf` and `managed.conf` never appear on the host — the container regenerates them on every start (see 8.3).

**Persistent dnsmasq configuration files always live under `dns/` and must never be placed under `configuration/`.** Traefik's file provider reads `/configuration` recursively (see commit `69edef4`), so `.conf` files there would produce parse errors and log noise.

### 7.3 Ownership state

Stored in the existing `~/.runestone/runestone.config.json` as a new `dns` block:

```json
{
  "dns": {
    "schemaVersion": 1,
    "phase": "applied",
    "contextName": "desktop-linux",
    "daemonPath": "C:\\Users\\me\\.docker\\daemon.json",
    "targetIp": "192.168.65.254",
    "insertedEntries": [
      { "role": "target", "value": "192.168.65.254", "index": 0 }
    ],
    "createdDnsKey": true,
    "createdDaemonFile": false,
    "upstreams": ["192.168.1.1"],
    "updatedAt": "2026-08-27T10:00:00.000Z"
  }
}
```

- `phase`: `prepared` (the daemon configuration is written, but Docker has not been restarted, so the change has no effect yet) → `applied` (restarted and verified). **`prepared` is not only a failure intermediate**: `dns enable --no-restart` deliberately stops there, and `status` must present that case as "written, waiting for a Docker restart" rather than as an error. This split is what allows the entire write/revoke cycle to be exercised against a real daemon file without interrupting a single container (see 16.1).
- `insertedEntries` lists **every** item Runestone owns, and nothing outside it belongs to us. It holds one entry (`role: "target"`) normally, and two when the optional fallback in 9.7 is enabled (`role: "fallback"`, at `dns[1]`). Per entry, `value` is used for matching and `index` is its last known position, used **for identification only, never to restore a position** — revocation removes those items and performs no positional restoration.

### 7.4 Development overrides (not a user-facing feature)

Two environment variables redirect the only two operations that touch global state, so that the ownership engine can be developed and tested without a real daemon file and without a real Docker restart:

| Variable | Effect |
| --- | --- |
| `RUNESTONE_DNS_DAEMON_PATH` | Use this path instead of the platform's daemon configuration file |
| `RUNESTONE_DNS_RESTART_CMD` | Run this command instead of the platform's Docker restart |

- **They are deliberately absent from `.env` and from `runestone setup`**, and are not documented as user-facing configuration. They exist to serve the contribution tiers in 16.2.
- They are a hazard in their own right — a wrong path means writing to the wrong file — so **`status` and `doctor` must report prominently whenever either one is active**, and the disclosure in 11.3 item 1 must always print the path actually in effect, whatever its source.
- Without them, a contributor who cannot restart Docker on their machine has no way to work on this feature at all. That is why they are a requirement of this specification rather than a convenience.

## 8. The DNS Service

### 8.1 runestone-dns image (`docker/dns/`)

- Alpine + `dnsmasq` + a pinned webproc (webproc v0.4.0 publishes `linux_amd64` and `linux_arm64` release assets, selected by `TARGETARCH`).
- Build targets: `linux/amd64` and `linux/arm64`.
- On every start the entrypoint does two things in order:

  1. Regenerate and overwrite `/etc/dnsmasq.conf` and `/etc/dnsmasq.d/managed.conf` per the rules in 8.3.
  2. Start the processes:

     ```sh
     webproc --configuration-file /etc/dnsmasq.d/custom.conf \
       --port 8080 --restart-watch \
       -- dnsmasq --no-daemon --conf-file=/etc/dnsmasq.conf --log-facility=-
     ```

  webproc watches only the custom rules; the files Runestone owns are outside its editing scope. If a user breaks the custom rules through the UI, managed mappings and upstream settings are unaffected.

  **Confirmed against webproc 0.4.0**, which was an open item of this section: the writable-configuration flag is `--configuration-file` (`-c`), and **`--config` does not exist** in 0.4.0. `--port`, `--user` and `--pass` do exist, and `--on-save` already defaults to `restart`, so saving through the UI restarts dnsmasq. `--restart-watch` is used as well, so a change to `custom.conf` **on disk** restarts dnsmasq too — which covers the user editing their own file with an editor instead of through the UI. `HTTP_USER` and `HTTP_PASS` are passed as environment variables rather than as flags, because a password given on the command line shows up in the container's process list.
- Supports enabling webproc basic auth through the `HTTP_USER` / `HTTP_PASS` environment variables.
- Build and publish mechanics: see 15.2.

### 8.2 Compose service definition

- Service name `dns`, container name `${PREFIX}-dns`, joined to the existing `${PREFIX}-network`.
- Image and tag are written literally by Runestone's Compose template (for example `cymondez/runestone-dns:1.0`) and **cannot be overridden by environment variables**.
- `restart: unless-stopped`.
- Uses the Compose profile `dns`. **When `DNS_ENABLE=true`, every Compose call made by the CLI (`up` / `stop` / `restart` / `ps` / `down`) must pass `--profile dns`**, so behaviour does not drift with differences in how Compose versions treat profiles.
- Publishes `${DNS_BIND_IP}:53:53/tcp` and `${DNS_BIND_IP}:53:53/udp`; webproc's 8080 is **not published to the host**.
- Mounts: `./certs:/ssl:ro` (so the entrypoint can scan certificate filenames) and `./dns/custom.conf:/etc/dnsmasq.d/custom.conf` (writable, edited by the user and webproc). The two files Runestone owns exist only inside the container and are not mounted (see 8.3).
- Environment: `DNS_HOST_IP` and `DNS_UPSTREAM` for the entrypoint to render the configuration; `DNS_UI_USER` / `DNS_UI_PASS`, when set, are passed in as `HTTP_USER` / `HTTP_PASS`.
- The service sets `dns:` explicitly to the upstream resolvers, so the dns container itself is never pointed back at itself by the daemon DNS setting and cannot form a loop.

### 8.3 dnsmasq configuration generation and tamper resistance

The two configuration files Runestone owns, `/etc/dnsmasq.conf` and `/etc/dnsmasq.d/managed.conf`, are **regenerated and overwritten by the entrypoint on every container start, and exist only inside the container — they are never mounted on the host**. The user does not "edit them and get them restored"; they cannot reach them at all, and whatever each start produces is the authoritative version.

This matches what the runestone image already does: `traefik.tmp.yml` is rendered into `/traefik.yml` at start (image-owned, regenerated every time), while `traefik.dynamic.yml` is copied only when missing (user-owned, never overwritten). Two kinds of ownership, two mechanisms.

| File | Location | Owner | On every start |
| --- | --- | --- | --- |
| `dnsmasq.conf` | Container only | Runestone | Regenerated and overwritten |
| `managed.conf` | Container only | Runestone | Regenerated and overwritten |
| `custom.conf` | Host `~/.runestone/dns/custom.conf` | User | Created only when missing, **never overwritten** |

Generation rules:

- `managed.conf`: the entrypoint scans the read-only `/ssl` mount for `*.crt`, excluding `rootCA.crt` and any filename that is not a valid domain, and emits one `address=/<domain>/<DNS_HOST_IP>` line per domain. dnsmasq's `address=/domain/ip` covers both the domain and all of its subdomains (verified). Only filenames are needed; certificate contents are never read.
- `dnsmasq.conf`: rendered by the entrypoint from environment variables, containing `no-resolv`, the `server=` list expanded from `DNS_UPSTREAM`, and includes of `managed.conf` and `custom.conf`.
- `custom.conf`: the CLI must ensure this file exists before starting the dns service (**bind-mounting a file that does not exist makes Docker create a directory instead**), containing explanatory comments.

When regeneration happens:

- Certificate changes (`certs create` / `certs remove`) → when the set of certificate-covered domains changed, the CLI runs a service-scoped `docker compose restart dns` (see 10.5).
- Target IP or upstream changes → the CLI updates `.env` and runs `docker compose up -d dns` (an environment change recreates the container).
- After a host reboot, a Docker restart, or a crash where `restart: unless-stopped` brings the container back → regeneration happens the same way, **with no CLI involvement at all**.

The trade-off: generation logic lives in the image entrypoint (shell), so the domain-filtering rules are covered by image verification tests (see 14.4) rather than jest unit tests, and changing the rules requires republishing the image. What that buys is "if the container can start, Runestone's dnsmasq configuration is correct", with no dependency on whether the CLI was ever run. The upstream resolution logic (8.4) stays in the CLI and is passed in through environment variables, so it remains unit-testable.

### 8.4 Upstream DNS

**The upstream list is mandatory and never empty.** dnsmasq runs with `no-resolv`, so it forwards only to the servers Runestone gives it; with none, every container on the machine loses internet name resolution the moment DNS is enabled. `dns enable` therefore never aborts for want of an upstream.

How the list is determined:

1. `DNS_UPSTREAM` from `.env` when non-empty. This is what setup writes, and it is authoritative.
2. Otherwise detection: existing `dns` entries in the daemon configuration file, then the host's resolvers (Node `dns.getServers()`), in both cases excluding loopback addresses and the Target IP.
3. If that yields nothing, `1.1.1.1`.

`1.1.1.1` is both the shipped default of `DNS_UPSTREAM` and the last resort of the detection path, so a usable list always exists. Detection is still tried ahead of the public default because corporate and campus networks may permit only internal resolvers — but a failed detection is no longer fatal, it just means the public default is used and said so out loud.

Setup presents the computed list and offers three actions (see 11.2): keep it, replace it, or append to it. Whatever the user picks is written to `DNS_UPSTREAM` explicitly, so the effective value is always visible in `.env` instead of being implied by detection.

Multiple upstreams are a **pool, not a priority order**: dnsmasq favours servers that answer quickly. A user who needs strict ordering can add `strict-order` to `dns/custom.conf`, which Runestone never overwrites (8.3).

`--upstream <ip,...>` on `dns enable` replaces the list for that run and is written to `.env`.

Whether the daemon `dns` array should *also* carry a fallback is a separate, opt-in question — see 9.7. Either way, **Runestone never reorders or alters the user's own entries for the sake of a fallback**; it only inserts its own.

### 8.5 Web UI

- When `DNS_UI_ENABLE=true`, the CLI generates `configuration/dns/dns-ui.yml`, routing `https://dns.<HOST_DOMAIN>` to `http://${PREFIX}-dns:8080`.
- The UI edits only `custom.conf`; it never touches `managed.conf` or `dnsmasq.conf`.
- With `DNS_UI_USER` / `DNS_UI_PASS` unset the **UI has no authentication**: the setup description and `dns status` must state plainly that anyone able to reach this machine's HTTPS entrypoint can modify custom DNS rules. Set `DNS_UI_ENABLE=false` if the UI is not wanted.

## 9. Docker Daemon Ownership Model

This is the core of "revoke only what Runestone itself did".

### 9.1 Action at enable time

This section applies only to a first-time enable with **no existing ownership record**; when a record exists, follow the reconciliation path in 9.5.

Runestone does exactly one kind of thing: **insert its own entries at the front of the `dns` array** — the Target IP at index 0, and the fallback at index 1 when 9.7 is enabled. It never moves, deduplicates or rewrites any existing item.

| Current state | Action | Record |
| --- | --- | --- |
| No `dns` key | Create `dns: [TargetIP]`, with the fallback appended after it when 9.7 is enabled | `createdDnsKey=true`, `insertedEntries=[{role:"target",index:0}]`, plus `{role:"fallback",index:1}` when enabled |
| A `dns` array exists | Insert our entries at the front in that order; existing items shift down with their contents and relative order unchanged | `insertedEntries` as above |

**If the array already contains the same Target IP, our entry is still inserted and no deduplication happens.** That pre-existing item belongs to the user or another tool; moving or removing it would be interference, and a duplicate DNS entry is harmless to Docker. In this case `status` must note that "the daemon `dns` array already contains an entry pointing at the same address; Runestone will neither move nor remove it, and it will remain after disabling."

Every other key and the relative order of existing items are always preserved.

### 9.2 Inverse operation at disable time

1. Re-read the current daemon JSON (never overwrite the whole file from a backup, which would discard unrelated user edits made in the meantime).
2. Identify every entry in `insertedEntries` using the order defined in 9.5 and **remove only those items**. Every other item stays exactly where it is; no positional restoration or reordering is performed. If any one owned entry is in ownership conflict, remove none of them — see 9.7.
3. If `createdDnsKey=true` and the array is empty after removal, delete the `dns` key.
4. If `createdDaemonFile=true` and the whole object is `{}` after removal, delete the file.
5. Clear the ownership state.

### 9.3 Safety rules

- Writes are atomic: write a temporary file, re-parse it to confirm valid JSON, then rename over the original. Preserve the original file permissions wherever the platform allows.
- `/etc/docker/daemon.json` on Linux requires sudo; if privilege escalation fails, abort without any partial write.
- If the ownership state is missing, or the recorded context or daemon path no longer matches the environment, **abort and print the daemon path plus manual recovery steps. Never guess which entry to remove.** For those cases, provide `runestone dns disable --assume-entry <ip>` and `--assume-index <n>` so the user can state explicitly which item to remove.
- If the user edited the `dns` array by hand while the feature was enabled, handle it case by case per 9.5; in every case only our own entry is touched, and the output reports that an external change was detected.
- Only one DNS operation may run at a time: serialise with a `~/.runestone/dns.lock` file lock containing the pid and a timestamp.

### 9.4 Target IP rotation

If `dns enable` or `up` resolves a Target IP that differs from the recorded one (for example after Docker Desktop rebuilds its network), remove the old owned entry and insert the new Target IP within a single transaction, then update the mappings and `.env`.

### 9.5 Handling user edits made while the feature is enabled

Principle: **Runestone recognises only the entries it inserted and recorded in `insertedEntries`. Everything else belongs to the user, including entries the user added or changed after enabling.**

Order used to identify each of our entries, applied independently per recorded entry:

1. The value at the recorded `index` still matches `value` → that is the entry.
2. Otherwise, if **exactly one** item in the array matches the value → that is the entry.
3. Multiple items match the value and the recorded `index` no longer matches → ownership conflict; abort and require `runestone dns disable --assume-index <n>`. Do not guess.
4. No item matches the value at all → treat it as removed by the user (see the table below).

| User's edit | Required behaviour |
| --- | --- |
| Added entries after ours | Preserved completely, order untouched |
| Inserted their own entry before ours (we are no longer `dns[0]`) | Governed by `DNS_AUTO_REORDER` in 9.6; in either mode, disable removes only our entry and the user's entries and ordering are preserved entirely |
| Added the same Target IP at another position | If the recorded `index` still matches, remove only our entry and keep the user's duplicate, warning that "the daemon `dns` array still contains an entry pointing at the Runestone DNS; it will not resolve once the dns service is removed". If the recorded `index` no longer matches either (we were also pushed down), it is an ownership conflict requiring `--assume-index <n>` |
| Removed our entry by hand | Disable treats it as already revoked: no error, no change to the file, ownership state cleared, user informed |
| Changed the value of our entry (e.g. replaced it with a different IP) | **Indistinguishable from the row above**: in both cases our value is simply absent from the array, and no implementation can tell an entry that was deleted from one that was overwritten. Rule 4 therefore governs — treated as already revoked, changing nothing. The output must additionally report the value now occupying the recorded position, and `runestone dns disable --assume-entry <ip>` stays available for a user who knows their entry was renamed rather than deleted |
| We created the `dns` key and the user added other entries to it | Array is non-empty after removing ours → keep the `dns` key |
| We created the daemon file and the user added other settings | The object is not `{}` after removing ours → keep the file |
| The file was reformatted through Docker Desktop's Docker Engine UI | Value matching still identifies our entry; revocation proceeds normally |

Additional requirements when writing the file:

- Reuse the original file's indentation style (detect the existing indentation), do not reorder other keys, and do not perform unnecessary formatting normalisation — rewriting the formatting is itself a way of damaging the user's edits.
- Modify only the `dns` key; write every other key back verbatim.

Re-entrancy: when a `phase=applied` record already exists, `dns enable` and `up` follow the reconciliation path in this section and **do not re-run the insertion in 9.1** (which would add a second entry of our own). Section 9.1 applies only to a first-time enable with no existing ownership record.

### 9.6 Automatic reordering (`DNS_AUTO_REORDER`)

When the user inserts their own entry before ours, our DNS is no longer consulted first and Runestone domains may stop resolving. Whether that is corrected automatically is the user's decision, the default is **no automatic correction**, and setup asks about it as its own question (see 11.2).

| `DNS_AUTO_REORDER` | When `up` / `dns enable` detects our entries are no longer at the front (the Target IP at `dns[0]`, and the 9.7 fallback at `dns[1]` when enabled) |
| --- | --- |
| `false` (default) | **Warn only; change nothing.** The warning must state the actual current position of each of our entries, that DNS may not take effect, and that `DNS_AUTO_REORDER=true` makes Runestone move its own entries back to the front on every start. |
| `true` | Move **only the entries we recorded** back to the front, in role order, leaving the relative order of all other items untouched, update each recorded `index`, and tell the user that "the daemon configuration was updated and will take effect after the next Docker restart". |

Constraints shared by both modes:

- **Never move, modify or remove any item that is not ours.** Automatic reordering adjusts the position of our own entries only.
- **Automatic reordering must never restart Docker on its own.** A restart terminates every container on the machine, and `up` is a routine command; only write the file and state when it takes effect. Users who want it applied immediately can restart Docker themselves or run `runestone dns enable`.
- Both modes must surface the current setting and the detection result in `status` and `doctor`.

### 9.7 Optional daemon fallback entry (`DNS_DAEMON_FALLBACK`)

Off by default. When set, Runestone inserts a **second owned entry** immediately after the Target IP, so the array begins `[Target IP, fallback, ...whatever was there before]`.

What it buys and what it costs, both measured:

| | Fallback off (default) | Fallback on |
| --- | --- | --- |
| While the dns service is running | Runestone domains resolve to the Target IP; everything else goes to dnsmasq's upstream (8.4) | Identical. Measured: with both nameservers reachable the first-listed answered 20/20, on glibc and musl alike, so the fallback does not race ours |
| While the dns service is down | Lookups **fail immediately and loudly**, so the cause is obvious | Lookups **succeed through the fallback**. Measured: 5/5 answered by the second nameserver at 0.01 s per lookup, on glibc and musl alike |
| A Runestone domain while the dns service is down | Fails | **Resolves to `127.0.0.1`**, because that is what these domains resolve to publicly (verified). The container then connects to its own loopback and reports a connection error, or reaches an unrelated local service |

Both directions matter, and neither is strictly better. Both must be disclosed.

**What enabling it buys.** This is the only setting that directly mitigates cost 3 in 2.4 — "once active, name resolution for every container on the machine depends on a Runestone container". With the fallback in place, if the dns container is stopped, has crashed, is being recreated by `up`, or is waiting on an image pull, **every container on the machine keeps resolving ordinary internet names**, immediately and with no timeout penalty (second row above). It also softens cost 7: a machine left carrying Runestone's daemon entry after Runestone itself is gone still resolves normally; it simply cannot resolve Runestone domains.

**What enabling it costs.** Runestone domains stop failing and start resolving to `127.0.0.1` (third row above). A loud DNS failure becomes a silent wrong answer, and that silent wrong answer is precisely the defect this entire feature exists to remove (2.1).

**Runestone advises; the user decides.** The default is off, because adding a second owned entry is a further invasive change and should be asked for rather than assumed. The advice to present:

| Situation | Advice |
| --- | --- |
| The machine also runs containers belonging to projects unrelated to Runestone | Enabling it is usually right — those projects should not lose internet DNS because a Runestone container is down |
| A machine used mainly for Runestone development, where broken DNS should be obvious at once | Leaving it off is usually right — a loud failure is easier to diagnose than a wrong answer |
| Unsure | Leave it off. It can be enabled later; that costs another daemon write and another Docker restart, nothing more |

The setup question and the enable confirmation must present **both** directions. Describing it only as "adds a backup DNS" hides the cost; describing it only as "makes Runestone domains resolve to `127.0.0.1`" hides the benefit. Both are unacceptable.

Ownership rules do not change in kind, only in count:

- Both entries are recorded in `insertedEntries` with distinct `role` values, and each is identified independently using the order in 9.5.
- Revocation removes both. **If one is identifiable and the other is in ownership conflict, remove neither**: abort, report both states, and require an explicit `--assume-index` for the conflicting one. The user must never be left holding half of Runestone's changes.
- Turning the fallback off while DNS stays enabled removes only the `role: "fallback"` entry.
- Changing its value is a remove-then-insert inside a single transaction, as in 9.4.
- `DNS_AUTO_REORDER` (9.6) applies to our entries as a block: it restores the Target IP to index 0 and the fallback to index 1, and still touches nothing else.

## 10. Operation Flows

### 10.1 `runestone dns enable`

1. **Preflight, changing nothing**: setup completed, Docker available, context not remote, not Windows container mode, an IPv4 Target IP resolvable, and the daemon configuration file readable and valid JSON. The upstream list cannot fail preflight, because 8.4 guarantees one exists; when it falls back to `1.1.1.1`, say so.
2. Write `.env`, ensure `dns/custom.conf` exists, generate `configuration/dns/dns-ui.yml`, update `compose.yml`.
3. Start the `dns` service and **verify for real**: from a throwaway container, query a managed domain at `Target IP:53` and require the Target IP in the answer. If this fails, stop the dns service, restore `.env`, and finish without having touched the daemon configuration at all.
4. Write the ownership state (`phase=prepared`) and update the daemon JSON atomically.
5. After user confirmation, restart Docker and poll until it responds. **With `--no-restart`, stop here**: leave `phase=prepared` and report that the daemon configuration has been written and will take effect once the user restarts Docker themselves.
6. Verify: a newly created container's `/etc/resolv.conf` lists the Target IP first, and `traefik.<HOST_DOMAIN>` resolves to the Target IP.
7. Mark `phase=applied`, print the UI URL and the relevant warnings.

If any step fails: invert the daemon JSON change, restart Docker, stop the dns service, clear the state. If the inversion itself fails, keep `phase=prepared` and print the exact daemon path together with manual recovery instructions.

`--dry-run` performs step 1 only, then prints the before/after diff of the daemon configuration and exits. It writes nothing at all: no `.env`, no service, no ownership state, no daemon file.

### 10.2 `runestone dns disable`

1. Confirm the recorded context and daemon path still match the current environment.
2. Apply the inverse operation from 9.2 and write atomically.
3. After user confirmation, restart Docker and poll until it responds.
4. Verify the owned entry is no longer part of the effective configuration.
5. Set `DNS_ENABLE=false`, stop and remove the dns service, remove `configuration/dns/dns-ui.yml`, clear the ownership state. `dns/custom.conf` is kept.

The dns service must not be removed before the daemon revocation has succeeded.

`--dry-run` resolves which entries would be removed (using the order in 9.5), prints the before/after diff and exits without writing.

### 10.3 `runestone dns status`

Read-only. Reports: desired state, dns service state, Target IP, Bind IP, daemon path, ownership record (including `phase` and every entry in `insertedEntries` with its role), the upstream list with where each value came from, whether the 9.7 fallback is enabled and its current state, UI URL and authentication state.

External-change detection must also be shown (per 9.5):

- For each entry in `insertedEntries`: whether it is still present and its value still matches.
- Whether the Target IP entry is still `dns[0]` (and the 9.7 fallback still `dns[1]` when enabled); if not, show the actual current position, a "DNS may not take effect" notice, and the current `DNS_AUTO_REORDER` setting.
- Whether the array contains duplicate entries pointing at the Runestone DNS that Runestone does not own.
- Whether `phase=prepared` is in effect — the daemon configuration is written but is still waiting for a Docker restart — and whether that is a deliberate `--no-restart` or the residue of a failed rollback.
- Whether either development override from 7.4 is active, together with the daemon path and restart command actually in effect.

### 10.4 Lifecycle integration

| Command | Behaviour |
| --- | --- |
| `up` | When DNS is enabled, start it as well with `--profile dns`, reconcile Target IP rotation, and regenerate mappings. If our entry is no longer at `dns[0]`, warn or move it per `DNS_AUTO_REORDER` in 9.6, and never restart Docker on its own. |
| `stop` | **Stops only the `runestone` service; the dns service keeps running.** The daemon still points at it, so stopping it would break DNS for every container on the machine. Use `runestone stop --all` to stop both, with the warning above displayed. |
| `down` | When DNS is enabled, run the full disable flow first (including the Docker restart); if it fails, abort `down` without performing any destructive cleanup. |
| `certs create` / `certs remove` | When DNS is enabled and the set of certificate-covered domains changed, restart the `dns` service so the entrypoint regenerates the mappings. |
| `doctor` | When DNS is enabled, check that the owned entry is still first in the daemon `dns` array, that the dns service is running, and that the Target IP still matches. **Report only; never auto-correct** (see 9.5). |

### 10.5 Required prerequisite: fixing the existing restart behaviour

`composeService.restart()` currently runs `docker compose restart` without a service name, restarting every service in the project. It is called by certificate and service dynamic-configuration changes as well as by setup.

**It must become service-scoped**: dynamic configuration changes restart only `runestone`, DNS configuration changes restart only `dns`. This is the precondition for the DNS service not being interrupted by unrelated operations.

## 11. CLI Surface and Risk Disclosure

### 11.1 Commands

```text
runestone dns enable  [--yes] [--dry-run] [--no-restart] [--upstream <ip,...>]
runestone dns disable [--yes] [--dry-run] [--assume-entry <ip>] [--assume-index <n>]
runestone dns status
```

- `--yes` skips the Docker restart confirmation; without it, confirmation is mandatory before restarting.
- `--assume-entry` and `--assume-index` may each be given more than once, because ownership can cover two entries (9.7). One occurrence per entry that needs to be stated explicitly.
- `--dry-run` prints the before/after diff of the daemon configuration and exits, writing nothing whatsoever. It is the primary development tool for the tiers in 16.2, and it stays in the shipped CLI because a user who wants to see the change before consenting to it deserves the same tool.
- `--no-restart` writes the daemon configuration and stops at `phase=prepared`, leaving the Docker restart to the user. Nothing takes effect until they restart, which is precisely why this flag makes the write safe to rehearse.
- Exit code `0` on success, non-zero on operational failure.
- All strings need `en` / `zh-TW` / `ja-JP` translations.

### 11.2 Setup integration

Four DNS questions in a fixed order; the second, third and fourth appear only when DNS is enabled:

| Question | Default | The description must explain |
| --- | --- | --- |
| Enable DNS? | Disabled | Items 1, 2, 3, 4 and 7 from 11.3, with the actual daemon path filled in |
| Upstream DNS — keep, replace or append | Keep the list computed in 8.4, displayed with the origin of each value | Item 10 from 11.3: that every non-Runestone lookup from every container on the machine passes through it, that `1.1.1.1` is what appears when nothing could be detected, and that multiple values are a pool rather than a priority order |
| Add a fallback entry to the daemon `dns` array? | No | Item 11 from 11.3, giving **both** directions from the 9.7 table — what it buys while the dns service is down, and what it costs for Runestone domains — followed by the situational advice in 9.7. The description must read as advice, not as a verdict |
| Enable automatic reordering? | Disabled | The risk of each mode: when off, DNS may stop taking effect after the user inserts their own entry and Runestone will not correct it; when on, Runestone rewrites the daemon configuration on every `up` (its own entries only, without restarting Docker) |

- Per `AGENTS.md`: correctable input errors must return to the same prompt, with the error message rendered in that prompt's description.
- The review summary must show all four values.
- Cancelling, or failing preflight, must leave no daemon configuration, service or state changes behind.

### 11.3 Risk disclosure requirements

Principle: **the user consents to concrete actions, not to abstract warnings.** Disclosures must contain real values (daemon path, Target IP, Bind IP, UI URL), never vague text such as "Docker configuration will be modified". They must also be repeated before every operation that touches global state — stating them once during setup and assuming the user remembers is not acceptable.

Items that must be disclosed:

| # | Disclosure |
| --- | --- |
| 1 | `<actual daemon path>` will be modified, adding `<Target IP>` at the front of the `dns` array |
| 2 | Docker must be restarted, which **terminates every container on the machine**, including projects unrelated to Runestone |
| 3 | Once enabled, DNS queries from every container on the machine pass through the Runestone dns container; if that container stops, containers across the machine may be unable to resolve anything |
| 4 | Host `<Bind IP>:53` will be occupied (both tcp and udp) |
| 5 | `runestone stop` deliberately leaves the dns service running; `stop --all` stops it too, which disables DNS machine-wide |
| 6 | `runestone dns disable` must be run before removing Runestone, otherwise the daemon configuration is left pointing at a container that no longer exists |
| 7 | Disabling removes only the entries Runestone added — one, or two with the 9.7 fallback enabled; all other entries and their order are untouched |
| 8 | The dns UI has no authentication unless `DNS_UI_USER` / `DNS_UI_PASS` are set |
| 9 | With automatic reordering on, Runestone rewrites the daemon configuration on every `up` (its own entries only, without restarting Docker) |
| 10 | Every lookup from every container on the machine that is not a Runestone domain is forwarded to `<upstream list>`. It is never empty; `1.1.1.1` is used when nothing else could be determined, and where each value came from is shown |
| 11 | With the 9.7 fallback enabled, a second entry `<fallback>` is added at `dns[1]`. **Benefit**: while the dns service is down, every container on the machine keeps resolving ordinary internet names immediately, including projects unrelated to Runestone. **Cost**: Runestone domains then resolve to `127.0.0.1` instead of failing, which presents as an application bug rather than a DNS outage. Runestone recommends per the 9.7 table; it does not decide |

When each disclosure is required:

| Moment | Must disclose |
| --- | --- |
| The setup DNS toggle question | 1, 2, 3, 4, 7 |
| The setup upstream question | 10 |
| The setup fallback question | 11, together with the measured behaviour in the 9.7 table |
| The setup automatic-reordering question | 9, plus the risk of leaving it off |
| Confirmation before `dns enable` modifies the daemon | All of 1–11, with real values |
| Confirmation before `dns enable` restarts Docker | 2, stating explicitly that every container will be terminated |
| `dns status` | The invasive settings currently in effect: daemon path, the actual position of each of our entries, Bind IP, upstream list, whether the 9.7 fallback is enabled, UI authentication state, automatic-reordering setting |
| Confirmation before `dns disable` | 2 and 7 |
| `up` (when DNS is enabled) | The 9.6 warning when our entry is not at `dns[0]` |
| `stop` (when DNS is enabled) | 5 |
| `stop --all` | 3 and 5 |
| `down` (when DNS is enabled) | That the daemon configuration is revoked first and Docker is restarted |
| Any failed rollback | The exact daemon path and manual recovery steps (see 12) |
| README / DESIGN documents | A summary of items 1–8, 10 and 11, and the manual removal steps |

`--yes` skips only the interactive confirmation; it **must not suppress the disclosure output**.

## 12. Failure Handling

| Condition | Result | Retryable |
| --- | --- | --- |
| The dns service cannot bind port 53 | Abort with the daemon configuration untouched; print troubleshooting guidance for the port holder | After the port is freed |
| No IPv4 Target IP resolvable | Abort | After the Docker environment is fixed |
| Nothing detectable for the upstream list | Use `1.1.1.1` and say so; **never abort** (8.4) | Not applicable |
| One owned entry is identifiable and another is in ownership conflict | Remove neither; abort and report both states (9.7) | After `--assume-index <n>` is given for the conflicting entry |
| Daemon JSON is invalid | Abort without writing | After fixing the file |
| Remote context / Windows containers | Refuse to run | After switching environment |
| Docker restart fails or times out | Invert the daemon configuration change | Yes |
| DNS verification fails after enabling | Invert the change and stop the dns service | Yes |
| The inversion itself fails | Keep `phase=prepared`, print the daemon path and manual recovery steps | After manual recovery |
| Ownership state missing at disable time | Abort and suggest `--assume-entry` | Yes |
| The user replaced the value of our entry | Treated as revoked (9.5): leave the file untouched, clear the state, and report the value now at the recorded position | Not applicable; `--assume-entry <ip>` when it was in fact renamed |
| Multiple items match the value and the recorded `index` does not | Ownership conflict; abort and suggest `--assume-index <n>` | After manual recovery |
| Our entry was already removed by the user | Treat as revoked; leave the file untouched and clear the state | No retry needed |
| Our entries are no longer at the front | Per `DNS_AUTO_REORDER`: `false` warns only; `true` moves our own entries alone and reports that it takes effect after the next Docker restart | Yes |
| The user added their own duplicate entry pointing at the Runestone DNS | Keep it; warn that it will not resolve once the service is removed | Handled by the user |
| Setup cancelled midway | No changes at all | Yes |

`phase=prepared` arises from two unrelated situations: a failed rollback (the row above) and a deliberate `--no-restart` (10.1). `status` must distinguish them, because the first needs manual recovery while the second needs nothing but a restart.

## 13. Compatibility and Migration

- Existing installations without `DNS_ENABLE` are disabled, and behave exactly as before.
- **`compose.yml` is regenerated from a version marker** (settled, 15.4): `ensureProjectFiles()` currently writes the Compose file only when it is absent, so existing users who upgrade the CLI would never receive the new Compose file containing the dns service. `COMPOSE_TEMPLATE_VERSION` in `.env` records which template version produced the file; when it differs from the CLI's own, the file is regenerated and the user is told. **A hand edit must never be discarded silently**: if the file on disk differs from what the recorded template version would have produced, back it up beside the original and name the backup in the output before overwriting.
- The `{{ if env "DNS_ENABLE" }}` blocks added to `docker/traefik/dynamic/traefik.dynamic.yml` in commit `3581211` must be removed; the route is generated by the CLI instead.
- The `start_dnsmasq()` function and its condition added to `docker/traefik/entrypoint.sh` in commit `3581211` must be removed; the runestone image no longer needs dnsmasq or webproc.
- `docker/dns/` now holds the new image's Dockerfile and entrypoint.
- The dns image must be published (including arm64) before the CLI presents DNS as an available feature.

## 14. Test Plan

### 14.1 Unit tests (jest, fully offline)

- Daemon JSON ownership: both enable cases, insertion without deduplication when the same IP already exists, disable removing only our entry, missing key, missing file, invalid JSON, Target IP rotation, `--assume-entry`, `--assume-index`.
- User edits made while enabled (every row of 9.5 needs a test): entries added after ours, an entry inserted before ours, a duplicate Target IP added elsewhere, our entry removed by hand, the value of our entry changed, a key or file we created that the user has since added content to, and a reformatted file.
- Both `DNS_AUTO_REORDER` modes: `false` warns with zero file changes; `true` moves only our own entries, leaves the relative order of other items unchanged, updates each recorded `index`, and never triggers a Docker restart.
- Re-entrancy: running `up` / `dns enable` repeatedly must not insert a second entry of our own.
- Write fidelity: the original indentation style and the order of other keys are unchanged after writing back.
- Detecting changes to the set of certificate domains: no `dns` restart when the set is identical, a restart when it changed.
- Upstream DNS: the 8.4 determination order, exclusion of loopback addresses and the Target IP, `1.1.1.1` as the last resort, and that the resulting list is **never empty** under any input.
- The three upstream setup actions — keep, replace, append — each writing an explicit `DNS_UPSTREAM`.
- The 9.7 fallback: both entries inserted in the right order and recorded with distinct roles; revocation removing both; turning the fallback off alone removing only that entry; and one entry in conflict causing neither to be removed.
- Bind IP determination per platform.
- Compose rendering: no dns service when disabled; correct ports, profile and image tag when enabled.
- Generating and removing `dns-ui.yml`.
- `--dry-run` on both `enable` and `disable`: the printed diff matches what a real run would produce, and **not one file, service or state change occurs**.
- The development overrides in 7.4: when set, the engine reads and writes the redirected path and never touches the platform default, and `status` reports that they are active.

### 14.2 Command entrypoint tests

- `dns enable` / `disable` / `status`: success, failure, exit codes, confirmation prompts, and that `status` is read-only.
- The four setup DNS questions: defaults (disabled, the computed upstream list kept, fallback off, reordering off), errors return to the same prompt, the review summary shows all four values, and cancelling leaves no trace.
- Risk disclosure (every row of the 11.3 timing table needs a test): the matching items actually appear, carrying the real daemon path, Target IP and Bind IP rather than placeholders; `--yes` still prints the disclosures. Item 11 must carry **both** the benefit and the cost — a disclosure stating only one of the two fails the test.
- `stop` does not stop the dns service; `down` aborts when disable fails.
- `certs create` / `remove` trigger mapping regeneration.

### 14.3 Manual platform verification

| Platform | Tier | Who performs it |
| --- | --- | --- |
| Linux rootful | T2 for everything 14.5 covers, T3 for the rest | Any contributor for the dind-covered part; maintainers for sudo and systemd-resolved |
| Windows Docker Desktop | T4 | Maintainers only |
| WSL2 | T4 | Maintainers only |
| macOS Intel and Apple Silicon | T4 | Maintainers only |

On each platform verify: enable → a new container's resolv.conf lists the Target IP first → a subdomain covered by a certificate resolves to the Target IP → after disabling, the daemon `dns` array is back to its original state, including the user's pre-existing entries.

- **Maintainers must commit the output of the T4 rows**, so that the next contributor does not have to re-run them in order to trust them.
- Anything 14.5 can cover must not be left as a manual-only check, because manual platform verification is by nature performed once and then never again.

### 14.4 runestone-dns image verification

- Both `linux/amd64` and `linux/arm64` start successfully, and dnsmasq answers on both 53/tcp and 53/udp.
- Mapping generation rules (verified with a fixture `/ssl` directory): one `address=` line per `*.crt`, `rootCA.crt` excluded, invalid domain filenames excluded, and a clean start when the directory is empty.
- **Tamper resistance**: after editing `/etc/dnsmasq.conf` and `/etc/dnsmasq.d/managed.conf` inside the container, restarting the container restores both, while `custom.conf` is left completely untouched by the same restart.
- After a host reboot or Docker restart where `restart: unless-stopped` brings the container back, the configuration is still correct without any CLI command having run.
- After editing `custom.conf` through webproc, dnsmasq is restarted and the new rules take effect.
- The UI requires authentication when `HTTP_USER` / `HTTP_PASS` are set, and does not when they are unset.

### 14.5 The dind harness (risk level 1, no virtual machine required)

A privileged `docker:dind` container has its own `/etc/docker/daemon.json`, its own port 53 namespace and its own set of inner containers, and **restarting that container is semantically a daemon restart** whose blast radius is one container. Verified on Windows 11 + Docker Desktop 29.6.2, inner engine 29.7.2:

| Checked | Result |
| --- | --- |
| The inner `/etc/docker/daemon.json` | Absent to begin with, so the `createdDaemonFile=true` path is reachable |
| Writing a `dns` array, then restarting the dind container | A fresh inner container's `/etc/resolv.conf` lists the entries in array order, ours first, and reports `Overrides: [nameservers]` |
| dnsmasq bound to the inner docker0 gateway `172.18.0.1:53` | Published on both tcp and udp; the inner network namespace is separate, so **it does not contend for the host's port 53** |
| `restart: unless-stopped` | Brought dnsmasq back automatically after the daemon restart with no CLI involvement — the same case as the fourth item in 14.4 |
| Wildcard subdomains | `address=/test.local.example/9.8.7.6` correctly answered `sub.api.test.local.example` |
| The host | `~/.docker/daemon.json` unchanged, and not one host container restarted |

What the harness covers, and what it does not:

| Covered | Not covered |
| --- | --- |
| The native Linux row of 6.1 (binding the docker0 gateway) | The Docker Desktop row: `192.168.65.254` and the requirement to bind `0.0.0.0` |
| The whole write → identify → revoke → restart cycle of the daemon configuration | `~/.docker/daemon.json` and `docker desktop restart` (15.1) |
| 8.2's `restart: unless-stopped` and the explicit `dns:` loop guard | The sudo escalation path in 9.3 (dind runs as root) |
| 8.3 mapping generation and regeneration | Contention with systemd-resolved on `127.0.0.53`, and with Windows ICS on port 53 |
| — | WSL2 path translation, macOS, and Apple Silicon |

Consequences:

- **The harness itself belongs in the repository** (`docker/dns/test/`), together with instructions for reproducing M6a without a virtual machine. Left in a conversation, it is tribal knowledge.
- A Linux virtual machine adds only what the "not covered" column lists for Linux: sudo, systemd-resolved and `systemctl restart docker`. Docker Desktop behaviour can be verified only on a real machine (M6b).

## 15. Decisions Needed From You

Each decision below has a milestone deadline; see 16.6. **Only decision 1 is still open**, and it blocks nothing before M6b.

1. **Whether `docker desktop restart` is available**: the implementation will detect it, falling back to "instruct a manual restart and poll". If you already know the answer, the automatic path can be dropped.
2. **Settled for now — the image is built and published by a script kept beside it.** `docker/dns/publish.sh` runs `docker buildx build --platform linux/amd64,linux/arm64 --push`, publishing `cymondez/runestone-dns:1.0`, and a maintainer runs it. **This is explicitly an interim answer.** A hand-run publish leaves no record of what produced the image, so CI remains the intended destination; it is deferred only because obtaining the registry token and getting a workflow green takes time that M2 should not wait on. `origin` is a self-hosted Gitea and GitHub is a mirror, so when CI does land, Gitea Actions is the natural first target — its workflow syntax is close enough to GitHub Actions that the file is portable either way. Until then **the script itself must be committed**, so that what produced a published image is at least reconstructable, and the script must refuse to publish without an explicit tag argument rather than defaulting to `latest`.
3. **Settled — the `TODO` requirement "users must be able to configure another DNS as fallback" is answered in two places.** The dnsmasq upstream (8.4) is **mandatory and never empty**, defaulting to `1.1.1.1`, because without it every container on the machine loses internet name resolution; setup offers keep / replace / append. A fallback inside the daemon `dns` array (9.7) is **optional and off by default**, because measurement showed that it converts a loud DNS failure into Runestone domains silently resolving to `127.0.0.1`. `insertedEntries` is consequently an array of owned entries, which M1 must implement from the start.
4. **Settled — `compose.yml` is regenerated automatically from a version marker.** `COMPOSE_TEMPLATE_VERSION` in `.env`; when it differs from the CLI's template version the Compose file is regenerated and the user is told, and a file the user has hand-edited is backed up beside the original first (see 13).

## 16. Milestones and Risk Control

The working checklist derived from this section — deliverables, gates, safety-net procedures and the evidence log — is [`DNS-MILESTONES.md`](DNS-MILESTONES.md). This section states the principle and the ordering; that document tracks the work.

### 16.1 The principle: the write is not the dangerous part

Writing `daemon.json` changes nothing until Docker restarts. **The restart is the destructive step, and it can be separated in time from the write.** The `prepared → applied` split in 7.3 is exactly that separation, and it means the entire write / identify / revoke cycle — the part with the most logic and the most ways to be wrong — can be exercised against a real daemon file without interrupting a single container.

Every milestone below is ordered by one rule: **a milestone may raise the risk level by at most one step, and the level below it must be fully green first.**

| Level | Impact on the machine | Recovery |
| --- | --- | --- |
| 0 | Reads only; fixtures and temporary directories | Nothing to recover |
| 1 | Builds an image, runs a container, binds a port other than 53 | Delete the container |
| 2 | Writes the real `daemon.json`, **without restarting** | Edit the file back; zero behavioural change in the meantime |
| 3 | Restarts Docker, binds port 53 | Every container on the machine restarts once |

### 16.2 Contribution tiers

Not every future maintainer can run a virtual machine. The feature must therefore be developable and verifiable without one, and that boundary has to be stated rather than assumed:

| Tier | Requires | Who must have it |
| --- | --- | --- |
| T0 | Node and jest; no Docker | **Every contributor (mandatory baseline)** |
| T1 | Docker on any platform | Every contributor |
| T2 | `docker:dind` — a single container (see 14.5) | **Every contributor; verified feasible** |
| T3 | A Linux virtual machine or a real Linux host | Maintainers only |
| T4 | Restarting Docker Desktop on a real machine | Maintainers only, once |

The three mechanisms that make T0–T2 possible at all — the overrides in 7.4, `--dry-run` and `--no-restart` — are requirements of this specification, not conveniences. Without them a contributor at T0 or T1 cannot work on this feature at all.

### 16.3 Milestones

| # | Content | Level | Gate |
| --- | --- | --- | --- |
| M0 | Make `composeService.restart()` service-scoped (10.5, a pre-existing defect); add the overrides in 7.4; write the safety net in 16.5 into the documentation | 0 | Existing tests green; no DNS behaviour exists yet |
| M1 | The daemon ownership engine as pure functions: insert, identify, remove, reorder, atomic write, indentation preservation | 0 | Every row of 9.5 has a test, plus an invariant test: after any sequence of enable → user edit → disable, **the values, the count and the relative order of entries we do not own are unchanged**. No CLI command is wired up yet, so none of it can be invoked |
| M2 | The runestone-dns image and its entrypoint, multi-arch | 1 | 14.4 green on amd64 and arm64, **verified on a port other than 53 so that port 53 is never contested at this stage** |
| M3 | Service plumbing and `dns status`, feature still off: compose profile, `.env`, `custom.conf`, `dns-ui.yml`, compose template versioning (13) | 0 | With `DNS_ENABLE=false`, `up` / `stop` / `down` behave exactly as they do today; `status` correctly reads hand-crafted daemon files covering every state in 9.5 |
| M4 | **`dns disable` before `dns enable`**, including `--assume-entry` and `--assume-index` | 2 (redirected path) | Correctly revokes an entry planted by hand with no ownership record. The escape hatch must exist before the trap: if enable lands first and misbehaves, there is no tool to clean up with |
| M5 | `dns enable` as far as `phase=prepared`, plus `--dry-run` and `--no-restart`: full preflight, dns service start, real query verification, daemon write — **no restart** | 2 | On a real machine: `enable --no-restart` → inspect the diff → `disable` → the file is byte-identical to the snapshot |
| M6a | End to end inside the dind harness: preflight → write → restart → resolv.conf → wildcard resolution → disable → file restored; including a deliberately injected restart timeout to prove the rollback actually rolls back | 2 on the host (level 3 inside the sandbox) | Runs on any contributor's machine, **and in CI** |
| M6b | Real machine and virtual machine: Docker Desktop's Target IP and the `0.0.0.0` bind, `docker desktop restart`, Linux sudo and systemd-resolved, a genuine port 53 conflict | 3 | Maintainers only, in a scheduled window, with the output committed |
| M7 | Lifecycle integration, the 11.3 disclosure matrix, i18n | 3 | 14.2 green, with one test per row of the 11.3 timing table. This is the first point at which existing commands touch DNS code |
| M8 | The 14.3 platform matrix; publish the image including arm64 before the CLI presents the feature (13) | 3 | — |

Through M6a, `DNS_ENABLE` defaults to false and no existing command path calls into DNS code, so **each milestone can be reverted completely with a single `git revert`**. Treat that as a hard constraint: do not wire DNS into `up` early because it is convenient.

### 16.4 Why M6a matters more than "no virtual machine required"

The dind harness can run in CI. That turns "write `daemon.json` → restart → resolve" from a one-off manual check into a **regression test**. Manual platform verification is by nature performed once and then never again; the part of it that dind can cover must not be left in that category.

### 16.5 One-time safety net before M5

- Copy the current `daemon.json` outside version control and record its hash. This is a safety net for the human, not a Runestone-managed backup — the 9.3 prohibition on whole-file restoration is unchanged.
- Confirm that M4's `disable --assume-entry` genuinely works against a hand-planted entry with no ownership record.
- Walk the manual recovery path once by hand: edit `daemon.json`, remove the entry, restart Docker.
- Before M6b, additionally save `docker ps -a`, because that step restarts every container on the machine.

### 16.6 Milestone deadlines for the section 15 decisions

| Decision | Deadline | Why |
| --- | --- | --- |
| 15.3 — fallback DNS in dnsmasq's upstream or in the daemon array | **Before M1 — settled**: both, per 8.4 and 9.7 | It decided that `insertedEntries` is an array of owned entries, which M1 must implement from the start |
| 15.2 — how the image is built and published, its name and initial tag | **Before M2 — settled for now**: a committed buildx script publishing `cymondez/runestone-dns:1.0`; CI deferred, Gitea Actions first when it lands | A publish run by hand is traceable only if the script that ran it is in the repository |
| 15.4 — the `compose.yml` regeneration strategy | **Before M3 — settled**: automatic, driven by `COMPOSE_TEMPLATE_VERSION`, backing up hand edits | — |
| 15.1 — whether `docker desktop restart` exists | Before M6b | Can wait; the implementation detects it anyway |
