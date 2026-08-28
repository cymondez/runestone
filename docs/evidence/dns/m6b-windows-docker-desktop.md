# M6b evidence — Windows, Docker Desktop

*Traditional Chinese: [m6b-windows-docker-desktop.zh-TW.md](m6b-windows-docker-desktop.zh-TW.md)*

**Date.** 2026-08-28 · **Platform.** Windows 11 Pro 26200, Docker Desktop, Docker Engine 29.6.2, Compose 5.3.1, context `desktop-linux` (`npipe:////./pipe/dockerDesktopLinuxEngine`), `docker info` reports `linux|Docker Desktop`.

This file records what was measured rather than what was expected, because [DNS-MILESTONES.md](../../DNS-MILESTONES.md) asks that the next contributor not have to re-run a T4 verification in order to trust it.

Most of what follows was measured against temporary files through `RUNESTONE_DNS_DAEMON_PATH`. The last two sections are the deliberate exception: the real `~/.docker/daemon.json` was written, Docker was restarted, and **DNS is left enabled and applied** on this machine rather than reverted.

## Decision 1 — `docker desktop restart` is available

```
$ docker desktop version
Docker Desktop CLI plugin version: v0.4.3

$ docker desktop restart --help
Usage:  docker desktop restart
Options:
  -d, --detach            Do not synchronously wait for the requested operation to complete.
      --timeout seconds   Terminate the running command after the specified timeout ...
```

It exists, and it is **synchronous by default** — which is what `restartDocker` assumes when it runs the command and then polls `docker info`.

**The detection and the manual fallback both stay.** The plugin carries its own version (`v0.4.3`), separate from Docker Desktop itself, so its presence cannot be assumed from "this is Docker Desktop"; an older installation will not have it. One machine having it is not evidence that every machine does.

## Target IP

```
$ docker run --rm --add-host host.docker.internal:host-gateway --entrypoint sh cymondez/runestone:5.2 \
    -c 'getent ahostsv4 host.docker.internal | head -1 | cut -d" " -f1'
192.168.65.254
```

Matches the value spec 6.1 names for Docker Desktop.

## Port 53 — a real conflict, and a real bug behind it

This machine already had a conflict, with no arrangement on our part. `0.0.0.0:53/udp` is held by PID 5388:

```
$ netstat -ano | grep ":53 "
  UDP    0.0.0.0:53             *:*                                    5388

$ Get-WmiObject Win32_Service -Filter "ProcessId=5388"
SharedAccess    Internet Connection Sharing (ICS)    Running
```

**Internet Connection Sharing is what WSL2 uses for NAT networking, so this is the default state of a Windows machine running Docker Desktop — not an exotic one.**

### The two spellings are not equivalent

```
$ docker run --rm -p 53:53/udp alpine:3.22 true
                                                          # starts

$ docker run --rm -p 0.0.0.0:53:53/udp alpine:3.22 true
Error response from daemon: ports are not available: exposing port UDP 0.0.0.0:53
  -> 127.0.0.1:0: listen udp4 0.0.0.0:53: bind: Only one usage of each socket address
  (protocol/network address/port) is normally permitted.
```

Reproduced through Compose, which is the layer that actually runs:

```
$ docker compose ... up -d          # ports: ["0.0.0.0:53:53/udp"]
Error response from daemon: ports are not available: ... listen udp4 0.0.0.0:53: bind: ...

$ docker compose ... up -d          # ports: ["53:53/udp"]
 Container m6bbare-probe-1 Started
```

**The compose template wrote the failing form.** It published `${DNS_BIND_IP:-0.0.0.0}:53:53/udp`, which spells the address out. `dns enable` would therefore have failed at the service-start step on any Windows machine with WSL2 — that is, on most of them — and the user would have been shown a raw `bind:` error from Docker.

Spec 6.1 already recorded that ICS holds the port and that publishing works anyway. That observation was correct; it was made with the bare form, while the implementation used the explicit one. **The two were assumed interchangeable and are not.**

Fixed by deriving `DNS_BIND_PREFIX` from `DNS_BIND_IP`: empty for an all-interfaces bind, `<address>:` for an address that names one interface. The user-facing `DNS_BIND_IP` keeps its meaning and its place in disclosure item 4; only the Compose spelling changes.

### The port is genuinely usable once published that way

Both sockets coexist afterwards — ICS on 5388, Docker Desktop's backend on 25920:

```
$ netstat -ano | grep "UDP.*0.0.0.0:53"
  UDP    0.0.0.0:53             *:*                                    5388
  UDP    0.0.0.0:53             *:*                                   25920
```

And the service answers at the Target IP, through the real generated Compose file:

```
$ docker compose --profile dns up -d dns
 Container rs6b-dns Started

$ docker exec rs6b-dns sh -c 'cat /etc/dnsmasq.d/managed.conf'
address=/example.test/192.168.65.254

$ docker run --rm --add-host host.docker.internal:host-gateway ... \
    -c 'dig +short @192.168.65.254 anything.example.test A'
192.168.65.254                       # wildcard subdomain of a certificate-covered domain

$ ... -c 'dig +short @192.168.65.254 example.com A'
104.20.23.154                        # forwarded upstream
```

**This is what spec 6.1 means by deciding port availability by starting the service.** Reading netstat would have said the port was taken; TCP would have said it was free; only starting it gives the answer, and the answer differs by protocol and by spelling.

### A specific-address bind also works on Docker Desktop

Not needed after the fix, but worth recording, since it contradicts the reason spec 6.1 gives for `0.0.0.0`:

```
$ docker run --rm -p 127.0.0.1:53:53/udp alpine:3.22 true        # starts
$ docker run --rm -p 192.168.0.182:53:53/udp alpine:3.22 true    # starts
```

With the service published on `127.0.0.1:53` **only**, a container still reached it at the Target IP:

```
$ ... -c 'dig +short @192.168.65.254 sub.example.test A'
192.168.65.254
```

Negative control — the same query with the service stopped:

```
;; communications error to 192.168.65.254#53: timed out
;; no servers could be reached
```

So `DNS_BIND_IP=127.0.0.1` is a working configuration on Docker Desktop, and a tighter one: port 53 never reaches the LAN. It is **not** made the default here, because the same has not been measured on macOS, and a default that is only known to work on one of the two Docker Desktop platforms is not a default. That is an M8 platform-matrix question.

## The revocation escape hatch (spec 16.5 safety net)

Against a temporary daemon file holding an entry Runestone never recorded:

```
$ runestone dns disable --dry-run
[error] Runestone has no record of owning any entry in ...daemon.json. It will not
guess which entry to remove. If you know which entry belongs to Runestone, state it:
runestone dns disable --assume-entry <ip>

$ runestone dns disable --yes --assume-entry 192.168.65.254
  Removing 1 entry that Runestone added.
  - 192.168.65.254
    10.0.0.53
[ok] DNS is disabled.
```

Before: `{"dns": ["192.168.65.254", "10.0.0.53"], "experimental": false}`
After: `{"dns": ["10.0.0.53"], "experimental": false}`

The unrelated entry and the unrelated key both survive. The escape hatch works, which is what the safety net needed to establish before any write to a real daemon file.

## WSL, and the refusal that replaced WSL detection

```
$ wsl -l -v
  Ubuntu-26.04      Running         2

$ wsl -d Ubuntu-26.04 -- bash -lc '...'
systemd-pid1: systemd
docker bin: /usr/bin/docker
dockerd bin: none
resolved: active

$ wsl -d Ubuntu-26.04 -- docker info --format '{{.OSType}}|{{.OperatingSystem}}'
linux|Docker Desktop
```

This distro is the exact shape M6a's refusal was written for: a Linux userland whose `docker` is Docker Desktop's, reached through the WSL integration, with no daemon of its own. **`docker info` reports `Docker Desktop` from inside it**, which is the signal `preflight`'s `docker-desktop-elsewhere` failure keys on — confirming in the real environment that the replacement signal is present and correct where the old kernel-string detection could not distinguish anything.

The CLI itself was not run inside WSL: the distro has no Linux-side `node`.

## The interruption itself — attempted, and stopped by Docker Desktop

Run on 2026-08-28 against the real `~/.docker/daemon.json`, with the Runestone project deliberately a sandbox: the daemon file is the global thing M6b is about, and there was nothing to gain by also putting the user's own installation in the blast radius. It was never touched — no DNS keys in its `.env`, no ownership record in its state file, before or after.

### What the write proved

`dns enable --yes --no-restart` wrote the real file. The keys that were already there survived exactly:

```json
{
  "builder": { "gc": { "defaultKeepStorage": "20GB", "enabled": true } },
  "experimental": false,
  "dns": ["192.168.65.254"]
}
```

Before the daemon was touched at all, the service had already answered a real query — `traefik.m6b.test` → `192.168.65.254` — which is the ordering spec 10.1 exists to enforce: everything that can fail, fails before the machine's global DNS changes.

**`phase: prepared` is now proven on a real machine, not only in the sandbox.** With the entry sitting in the real daemon file, a new container's `resolv.conf` still read:

```
nameserver 192.168.65.7
```

Docker's own resolver. The write was real and had no effect. That separation is the lever the entire risk plan rests on, and until now it had only been demonstrated inside dind. `dns status` reported it in those words: *"Written, waiting for a Docker restart. Nothing has taken effect yet."*

### Docker Desktop rewrites `daemon.json` itself

Between our write and the next read of the same file, it had become:

```json
{
  "builder": { ... },
  "dns": [
    "192.168.65.254"
  ],
  "experimental": false
}
```

Keys reordered alphabetically, the array expanded to multiple lines. Nothing of ours did that — Runestone splices bytes precisely so it does not. **Docker Desktop normalises the file when it starts.**

This costs nothing in correctness: the order of elements *inside* the `dns` array was preserved, so identification by recorded index still holds. What it does mean is that the byte-preservation invariant M1 tests is a property of Runestone's own operations, not a promise about the file across a Docker Desktop restart. Anyone reading spec 9.5 as "your formatting will survive" should read it as "Runestone will not be the one to change it".

### `docker desktop restart` crashed Docker Desktop

The restart never completed. Docker Desktop terminated with:

```
starting services: initializing Inference manager: listening on
unix://C:/Users/cymondez/AppData/Local/Docker/run/dockerInference:
remove C:/Users/cymondez/AppData/Local/Docker/run/dockerInference:
The file cannot be accessed by the system.
```

Its Inference manager could not re-create its own socket. Nothing in that path involves DNS, the `dns` array, or port 53, and the daemon file at that moment held one added string. Two `docker desktop restart` invocations were run on this machine today; the first completed, the second did this.

**That is a fact about the mechanism decision 1 settled on.** `docker desktop restart` exists and is synchronous — and it is not dependable. `completeEnable` depends on it twice: once to apply, and once more to restart after inverting a failed apply. A restart that can crash the daemon is a restart that can crash during the recovery too.

The design survives that, and this incident happened to demonstrate why: **the inversion writes the file before it restarts.** Docker was down with our entry in the file; restoring the file while it was down was enough, and Docker read the corrected file when it came back. Had the order been "restart, then write", there would have been no safe moment to intervene.

### The safety net did its job

`m6b-safety-net.sh restore` put the daemon file back byte-for-byte (`27369c83…` before and after), printed the diff it was discarding first, declined to restart a daemon that was not running, and started the five containers that had not come back. `status` then reported the machine identical to the snapshot. Total time from crash to a machine matching its snapshot: a few minutes, no manual editing.

### Still unverified, and why

The half of the gate that needs a completed restart:

- a new container's `resolv.conf` listing the Target IP **first**
- a certificate-covered subdomain resolving through the daemon setting rather than through an explicit `@server`
- `disable` restoring the array with a second restart
- whether `restart: unless-stopped` survives a **graceful** `docker desktop restart`, which spec 8.3 relies on and which M6a demonstrated only against a killed daemon

None of these can be reached until `docker desktop restart` completes on this machine. That is a Docker Desktop problem to resolve first, not a Runestone one.

## The interruption, completed

Docker Desktop was updated to 4.88.1 partway through, and its own restart applied the configuration that had been sitting at `phase: prepared`. That is the restart this milestone needed, and it produced the gate.

### The gate

A newly created container, with nothing arranged for it:

```
$ docker run --rm ... cat /etc/resolv.conf
nameserver 192.168.65.254      # the Target IP, first
nameserver 1.1.1.1             # the 9.7 fallback, second
```

Every certificate-covered domain, resolved through the daemon setting rather than an explicit `@server` — these are ordinary `getent hosts` lookups going through the container's own `resolv.conf`:

```
traefik.local.developers-homelab.net     192.168.65.254
anything.local.developers-homelab.net    192.168.65.254     # wildcard subdomain
sub.traefik.me                           192.168.65.254     # a second certificate
tunnel.local.developers-homelab.net      192.168.65.254
github.com                               20.27.177.113      # the internet still works
```

### The 9.7 fallback table, measured in the wild

For a window the dns service was down while the daemon still pointed at it — the exact situation the fallback exists for. Both rows of the 9.7 table came out as written:

```
$ getent hosts github.com                              # ordinary internet name
20.27.177.113 github.com                               # keeps resolving, via 1.1.1.1

$ getent hosts traefik.local.developers-homelab.net    # a Runestone domain
127.0.0.1     traefik.local.developers-homelab.net     # the documented cost, exactly
```

That is the trade spec 9.7 describes, no longer as a prediction.

### Two defects the completion found

**Docker Desktop's version decides whether an automatic restart is safe.** Below 4.86.0 its restart stops the containers, and `unless-stopped` keeps them down for good — measured twice here, and the reason the earlier attempts looked like DNS failures when the configuration was correct. The version is read from `docker version --format '{{.Server.Platform.Name}}'` and the automatic restart is gated on it; below the threshold Runestone attempts nothing and offers three ways forward.

**`dns enable` restarted a machine that was already running the configuration.** The write and the restart are separable by design, so the restart can arrive from a manual restart, a reboot or an update — and in each case restarting again terminates every container to achieve nothing. It now asks a throwaway container what its `resolv.conf` says and skips the restart when the answer is already ours. On this machine that turned the last step into a no-op.

### Still not verified

`disable` restoring the array **after a real restart**. Its file operation is proven — the escape-hatch run removed exactly the recorded entry from a real file and left the unrelated one and the unrelated key untouched — but tearing the working configuration down again to watch the restart half was not worth another machine-wide interruption.

## What this file does not cover

- **The enable → restart → disable cycle on the real daemon.** It restarts Docker, terminating all 12 running containers on this machine, several of them stateful. It needs an agreed window (see the M6b checklist) and is not something to slip into a working day.
- **A native Linux engine.** This machine has none: the WSL distro carries only the Docker Desktop integration, so `/etc/docker/daemon.json`, `sudo`, `systemctl restart docker` and systemd-resolved's `127.0.0.53` remain unverified. That needs a VM or a Docker Engine installed inside a Linux distro.
- **macOS**, on either architecture — an M8 platform-matrix row.
