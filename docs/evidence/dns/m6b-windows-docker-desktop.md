# M6b evidence — Windows, Docker Desktop

*Traditional Chinese: [m6b-windows-docker-desktop.zh-TW.md](m6b-windows-docker-desktop.zh-TW.md)*

**Date.** 2026-08-28 · **Platform.** Windows 11 Pro 26200, Docker Desktop, Docker Engine 29.6.2, Compose 5.3.1, context `desktop-linux` (`npipe:////./pipe/dockerDesktopLinuxEngine`), `docker info` reports `linux|Docker Desktop`.

This file records what was measured rather than what was expected, because [DNS-MILESTONES.md](../../DNS-MILESTONES.md) asks that the next contributor not have to re-run a T4 verification in order to trust it.

**Nothing in this session wrote to the real daemon configuration or restarted Docker.** The machine's `~/.docker/daemon.json` has the same SHA-256 before and after (`27369c83…`), and `docker ps -a` lists the same 17 containers. Every daemon write here went to a temporary file through `RUNESTONE_DNS_DAEMON_PATH`.

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

## What this file does not cover

- **The enable → restart → disable cycle on the real daemon.** It restarts Docker, terminating all 12 running containers on this machine, several of them stateful. It needs an agreed window (see the M6b checklist) and is not something to slip into a working day.
- **A native Linux engine.** This machine has none: the WSL distro carries only the Docker Desktop integration, so `/etc/docker/daemon.json`, `sudo`, `systemctl restart docker` and systemd-resolved's `127.0.0.53` remain unverified. That needs a VM or a Docker Engine installed inside a Linux distro.
- **macOS**, on either architecture — an M8 platform-matrix row.
