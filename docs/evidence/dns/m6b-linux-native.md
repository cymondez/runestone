# M6b evidence — Linux, native Docker Engine

*Traditional Chinese: [m6b-linux-native.zh-TW.md](m6b-linux-native.zh-TW.md)*

**Date.** 2026-08-29 · **Platform.** Ubuntu 26.04 LTS (kernel 7.0.0-22-generic, x86_64) in Hyper-V, Docker Engine — Community 29.5.3, context `default` (`unix:///var/run/docker.sock`), systemd-resolved active, `docker0` at `172.17.0.1`. The user is in the `docker` and `sudo` groups, with NOPASSWD sudo.

This is the other half of M6b. The Windows half is [m6b-windows-docker-desktop.md](m6b-windows-docker-desktop.md); it covers Docker Desktop's addressing and restart mechanism, and it left two things unverified that only a native engine can settle. Both are settled here.

**The whole cycle was run against the real `/etc/docker/daemon.json`, with real `systemctl restart docker` restarts, twice.** The machine is left exactly as it was found: no `/etc/docker/daemon.json`, the same one container running, and a fresh container's `resolv.conf` back to the VM's own resolver. The safety net's `status` says so at the end.

## What this environment answers that Docker Desktop cannot

| Question | Answer |
| --- | --- |
| Does `restart: unless-stopped` survive a daemon restart? | **Yes** — measured, twice. The Windows half could not tell, because `docker desktop restart` restarts the *application* |
| Does `dns disable` restore the machine after a real restart? | **Yes** — the file Runestone created is removed, and a fresh container goes back to the host's resolver |
| Does the elevated write of spec 9.3 work, and abort cleanly when refused? | **Yes to both** — and it did not exist before this run |

## Before anything: the safety net was watching the wrong file

```
$ bash docker/dns/test/m6b-safety-net.sh capture
Snapshot taken in /home/cymondez/.runestone-m6b-safety
  daemon    /home/cymondez/.docker/daemon.json (<absent>)
```

`~/.docker/daemon.json` is Docker Desktop's file. On this machine Docker never reads it, and it does not exist. The safety net would have reported "the machine matches the snapshot" throughout, while the file it exists to guard — `/etc/docker/daemon.json` — was not being watched at all.

The default was `${HOME}/.docker/daemon.json` on every platform; `platform_daemon_path()`, which knows better, was only consulted when deciding whether to restart Docker. Fixed, and a second Linux gap with it: restoring a root-owned file needs elevation, so the restore now elevates per operation, by testing the directory.

```
$ bash docker/dns/test/m6b-safety-net.sh capture
  daemon    /etc/docker/daemon.json (<absent>)
```

## The test suite had never run on Linux

```
$ npx jest
Test Suites: 4 failed, 38 passed, 42 total
Tests:       28 failed, 540 passed, 568 total
```

Four suites, 28 tests. None of them was a product bug on Linux; all of them were **fixtures that inherited the host's platform**. They describe a Docker Desktop machine, and on Windows the CLI agreed. On Linux, a Linux userland pointed at a Docker Desktop daemon is exactly the `docker-desktop-elsewhere` refusal — the product being right, and the fixture never having said which machine it meant.

One of the four was a product wrinkle worth fixing rather than papering over. `sameDaemonPath` normalised with `path.resolve`, which follows the *host's* separator rules, while what it compares is a path belonging to the platform the daemon lives on. It now chooses the flavour (`path.win32` / `path.posix`) from `osDetector.platform()`, which is identical to today's behaviour in production and no longer depends on where the comparison runs.

```
$ npx jest
Test Suites: 42 passed, 42 total
Tests:       568 passed, 568 total
```

568, with none skipped — five of them are the elevation tests that Windows skips, because they need real permission bits to mean anything.

## Preflight, on a machine that has no daemon file yet

```
$ node bin/runestone dns enable --dry-run
[info] Preflight
  Target IP: 172.17.0.1 (host.docker.internal, resolved from inside Docker)
  Bind IP: 172.17.0.1
  Docker context: default
  Daemon configuration: /etc/docker/daemon.json
  That file does not exist yet and will be created.
```

Three spec rules confirmed at once: the Target IP is the `docker0` gateway (6.1), the Bind IP is that same address rather than `0.0.0.0` (6.1's Linux row), and the daemon path is the native one (6.2).

The upstream came out as `1.1.1.1` "because nothing was detected" — which is spec 8.4 working exactly as written. This host's only resolver is systemd-resolved's `127.0.0.53`, a loopback stub that a container forwarding to it would be asking itself, so it is excluded; with no other candidate, the never-empty rule supplies the shipped default.

## Spec 9.3's elevated write did not exist

The spec says: *"`/etc/docker/daemon.json` on Linux needs sudo; if elevation fails, abort with no partial write."* The write was a plain `fs` write with no elevation anywhere in it. On this machine, as an ordinary user, `dns enable` could not have written the file at all.

It is implemented now, and the ordering keeps both of the properties the direct write has: the content is validated **before** elevation is asked for, and the target is only ever replaced by a rename inside its own directory.

```
$ node bin/runestone dns enable --yes --no-restart
  The dns service answered traefik.local.developers-homelab.net with 172.17.0.1.
[ok] Written and waiting. Nothing has taken effect yet: restart Docker for containers to start using it.

$ ls -l /etc/docker/daemon.json
-rw-r--r-- 1 root root 27 Aug 29 14:15 /etc/docker/daemon.json
{
  "dns": ["172.17.0.1"]
}
```

Root-owned, 0644, valid JSON, one entry.

### `phase: prepared` proved again, on the other platform

```
$ docker run --rm alpine:3.20 cat /etc/resolv.conf | grep nameserver
nameserver 192.168.144.1
```

The entry is in the real file and the effect is zero. This is the lever the whole plan rests on, and it now holds on both platforms.

### Elevation refused: abort, and nothing written

With a `sudo` on `PATH` that refuses:

```
$ PATH=/tmp/fakebin:$PATH node bin/runestone dns enable --yes --no-restart
[error] Could not write /etc/docker/daemon.json: elevation was refused while trying to
        stage the new file beside it; nothing was written. Everything done before it was undone.

$ ls -a /etc/docker/
.  ..
```

No file, and no debris beside it. **That is the M6b Linux pass condition, measured.**

## The restart cycle

```
14:15:47  dns enable --yes
14:15:59  ActiveEnterTimestamp=Sat 2026-08-29 14:15:59 CST   (dockerd)
14:16:00  [ok] DNS is active. A new container is given 172.17.0.1 as its first nameserver.
```

Thirteen seconds, `sudo systemctl restart docker` included.

```
$ docker ps -a --format '{{.Names}} {{.Status}}'
runestone-dns Up 12 seconds
runestone Up 12 seconds

$ docker run --rm alpine:3.20 cat /etc/resolv.conf | grep nameserver
nameserver 172.17.0.1
```

**`restart: unless-stopped` came back on its own**, for both containers, with no CLI involvement. Spec 8.3 assumes exactly this, and the Windows half could not confirm it: `docker desktop restart` restarts the application, and an application shutdown *stops* containers, which is precisely what `unless-stopped` does not come back from. A daemon restart is not that. The assumption is sound on the platform where the words mean what they say.

### Certificate domains, resolved through the daemon configuration

No `@server`, no explicit resolver — this is what an ordinary container gets.

```
traefik.local.developers-homelab.net       172.17.0.1
dns.local.developers-homelab.net           172.17.0.1
anything.local.developers-homelab.net      172.17.0.1
deep.nested.local.developers-homelab.net   172.17.0.1
example.com                                2606:4700:10::ac42:93f3   (forwarded upstream)
```

Every certificate's domain, every subdomain of it however deep, and nothing else.

## A finding I got wrong, and what is actually true

I reported an AAAA leak here: that `address=/domain/<ipv4>` answers A only, that the AAAA for the same name was forwarded upstream, and that containers asking for `traefik.me` were therefore being sent to a public address. I added a `local=/domain/` line to the image to fix it.

**It does not reproduce, and the fix has been reverted.** Re-measured against the real service, with the `local=` lines stripped from the running resolver — exactly the configuration that was supposedly leaking — and with a control proving that forwarding worked at all:

```
control:  dig AAAA google.com   →  2404:6800:4008:c1b::66 ...   (forwarding works)

address= only, no local=:
  A      traefik.me            →  172.17.0.1
  AAAA   traefik.me            →  (nothing)
  TXT    traefik.me            →  (nothing)
  MX     traefik.me            →  (nothing)
  HTTPS  traefik.me            →  (nothing)

$ docker run --rm alpine:3.20 getent hosts traefik.me
172.17.0.1        traefik.me
```

`address=/domain/<ipv4>` already makes dnsmasq authoritative for the whole name: A is answered, every other type is NODATA, and nothing goes upstream. Adding `local=/domain/` changed **no** record type — measured one at a time, with and without it.

**How I got it wrong** is worth recording, because it was a method failure rather than a typo. The original reading came from a before/after in which I changed two things at once: I rebuilt the image *and* recreated the container between the two measurements, so the "before" and the "after" were not the same resolver. I had no control proving that forwarding worked, and the "after" was consistent with a fix that did nothing. A single-variable A/B, which is what the retest above is, gives the opposite answer.

## What is actually true about `traefik.me`, and it matters more

[traefik.me](https://traefik.me/) is a public DNS service that **decodes an address out of the name**:

| name | public answer |
| --- | --- |
| `10.0.0.1.traefik.me`, `10-0-0-1.traefik.me` | `10.0.0.1` |
| `www.10.0.0.1.traefik.me` | `10.0.0.1` |
| `mysite.traefik.me` | `127.0.0.1` |
| `traefik.me` itself | GitHub Pages — the project's documentation site |

Runestone ships a certificate for `*.traefik.me` (locally issued by this machine's mkcert CA, not the project's), so under the rule that every certificate domain becomes a mapping, **the whole `traefik.me` zone is answered with the Runestone host for every container on the machine**:

```
$ docker run --rm alpine:3.20 getent hosts 10-0-0-5.traefik.me
172.17.0.1        10-0-0-5.traefik.me
```

That address should be `10.0.0.5`. The address-decoding is the entire point of the service, and Runestone overrides it — not for the developer's own machine, whose resolver is untouched, but for every container on it.

**Half of that is the feature working.** `mysite.traefik.me` publicly answers `127.0.0.1`, which inside a container means the container itself, so without the mapping a `traefik.me` name is useless from a container and with it the name reaches Traefik. That is presumably why the certificate exists.

The other half is a real cost that nobody chose: a container can no longer use `<ip>.traefik.me` to reach that IP. It is not a bug in the mapping code — it is what "every certificate domain becomes a mapping" means when the certificate covers a wildcard DNS service. It belongs in the user documentation, and it is [there now](../../DNS.md).

## `disable`, after a real restart — the half Windows left unverified

```
$ node bin/runestone dns disable --yes
  The dns key itself is removed, because Runestone created it and nothing else is left in it.
  The file is removed, because Runestone created it and nothing else is left in it.
  Docker restarted and answered again after 0s.
[ok] DNS is disabled. Runestone owns nothing in the Docker daemon configuration.

$ ls -l /etc/docker/daemon.json
ls: cannot access '/etc/docker/daemon.json': No such file or directory

$ docker run --rm alpine:3.20 cat /etc/resolv.conf | grep nameserver
nameserver 192.168.144.1
```

Spec 9.2 step 4 in full: Runestone created the file, removing its entry leaves `{}`, so the file goes. `dns/custom.conf` was kept, because it is the user's. Both containers came back again.

## The `.env` rollback was not what it claimed

A failed run says *"everything done before it was undone."* It was rewriting six named keys out of the merged config, which has the flags merged into it — so undoing a failed `--upstream 9.9.9.9` wrote `9.9.9.9` back rather than the user's value, and `DNS_DAEMON_FALLBACK` was not in the list at all. On a machine that had never used DNS it could not remove the keys either, so it left seven new lines behind while reporting that nothing had changed.

It now snapshots the file as text and puts it back as text — the same property the daemon file has.

```
$ sha256sum ~/.runestone/.env | cut -c1-16
11255983189e409c
$ PATH=/tmp/fakebin:$PATH node bin/runestone dns enable --yes --no-restart --upstream 9.9.9.9
[error] ... nothing was written. Everything done before it was undone.
$ sha256sum ~/.runestone/.env | cut -c1-16
11255983189e409c
```

Identical, with a flag set that the old rollback would have left behind.

## Smaller things this run corrected

- The elevated write asked `sudo` to `mkdir -p` a directory that already existed, spending the elevation on a no-op and, when sudo refused, naming the wrong step as the one that failed.
- A message on the DNS path said *"Restarting runestone container so Docker Desktop picks up dynamic config changes"*. Traefik picks it up, not Docker Desktop, and on this machine there is no Docker Desktop to name.

## What is left

Nothing for Linux. The remaining M6b Windows item is `disable` after a real Docker Desktop restart, which is [recorded there](m6b-windows-docker-desktop.md) as deliberately unverified rather than claimed.

Two things about this environment are worth carrying into M8 rather than generalising from here: this is a VM with a single Runestone container, so the restart never had to bring back a large or stateful set; and `1.1.1.1` as the detected upstream is a property of a stock systemd-resolved host, not of Linux.

## Reproducing this

The package was never published to run it. The source was copied to the VM, built there, and run from the checkout, and the DNS image was built locally because it is not on a registry yet:

```
git archive --format=tar -o rs.tar HEAD && scp rs.tar vm:/tmp/
ssh vm 'mkdir -p ~/rs && tar -xf /tmp/rs.tar -C ~/rs && cd ~/rs/runestone-cli && npm install && npx tsc'
ssh vm 'cd ~/rs && docker build -t cymondez/runestone-dns:1.0 docker/dns'
ssh vm 'cd ~/rs/runestone-cli && node bin/runestone dns status'
```

The globally installed `@developers-homelab/runestone-cli@1.0.1-beta.4` was left in place and never used; `node bin/runestone` runs the branch without touching it.
