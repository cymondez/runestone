# Runestone DNS

English | [繁體中文](DNS.zh-TW.md) | [日本語](DNS.ja-JP.md)

This document explains what Runestone's DNS feature does, what it changes on your machine, and how to undo it. **It is longer than a feature description usually needs to be, because this feature changes global state**: it edits the Docker daemon's configuration and restarts Docker. You should know exactly what that means before you turn it on.

If you only want the short version: it makes your project's domains resolve correctly *inside* containers, at the cost of every container on the machine asking a Runestone container for DNS. It is off by default, and `runestone dns disable` removes it.

## Contents

- [The problem it solves](#the-problem-it-solves)
- [What enabling it does to your machine](#what-enabling-it-does-to-your-machine)
- [Turning it on](#turning-it-on)
- [Checking what is in effect](#checking-what-is-in-effect)
- [Turning it off](#turning-it-off)
- [Removing the entry by hand](#removing-the-entry-by-hand)
- [When something goes wrong](#when-something-goes-wrong)
- [Settings](#settings)

## The problem it solves

Runestone gives your projects real domains with real certificates — `app.local.example.net` instead of `localhost:3000`. From your browser that works, because Runestone's certificates and Traefik routing take care of it.

From **inside a container** it does not. A Runestone domain resolves publicly to `127.0.0.1`, and inside a container `127.0.0.1` is the container itself. So a backend container trying to reach `https://api.local.example.net` connects to its own loopback address and gets a connection error — or worse, reaches an unrelated service that happens to be listening there.

That failure is quiet. Nothing reports "this domain resolved to the wrong place"; you get a connection error, or a wrong answer from a wrong service, and you go looking for a bug in your application.

The DNS feature fixes it by giving containers a resolver that knows about your Runestone domains. Once enabled, a container asking for `api.local.example.net` gets the address of your host machine, reaches Traefik, and is routed exactly as your browser would be.

## What enabling it does to your machine

All of this is disclosed again by the CLI, with your actual values filled in, before it changes anything. It is repeated here so you can read it before you start.

### 1. It edits the Docker daemon's configuration

Runestone adds one entry to the `dns` array in:

| Your setup | File |
| --- | --- |
| Docker Desktop (Windows, macOS) | `~/.docker/daemon.json` |
| Native Linux Docker Engine | `/etc/docker/daemon.json` (needs `sudo`) |

The entry is the address containers use to reach your host — on Docker Desktop typically `192.168.65.254`. It is added **at the front** of the array, because the daemon consults these in order and Runestone has to be asked first.

Runestone edits only the bytes it owns. Your existing settings, their order, your indentation and your comments-by-convention are left exactly as they were.

### 2. Docker has to be restarted, and that stops every container

The Docker daemon reads that file only at startup. Until Docker restarts, **the change has no effect at all** — which is deliberate, and is why Runestone separates writing the file from restarting.

The restart terminates **every container on the machine**, including containers that have nothing to do with Runestone. Databases, queues, anything you have running. Containers with a restart policy of `always` or `unless-stopped` come back by themselves; containers without one do not.

Check what you have running before you start:

```bash
docker ps
```

**On Docker Desktop older than 4.86.0, they do not all come back.** That version restarts the whole application, and an application shutdown *stops* the containers — `unless-stopped` means "restart unless it was stopped", so those stay down for good and waiting does not help. Runestone checks the version and **refuses to restart automatically below 4.86.0**, offering three ways forward instead: update Docker Desktop, restart it through its own Settings → Docker Engine → Apply & restart, or run `runestone dns enable --restore-containers` so Runestone notes what was running and starts back whatever the restart left down. That last one is opt-in and never a default.

**If Docker is already handing out the address, nothing is restarted at all.** Runestone checks before it acts, so applying a configuration that is already in effect — after your own restart, a reboot, or a Docker Desktop update — costs you nothing.

### 3. Every container's DNS then goes through a Runestone container

This is the cost that is easy to underestimate. After enabling, **every DNS query from every container on the machine** — not just Runestone projects — goes to the Runestone `dns` container.

If that container stops, is being recreated, or is waiting on an image pull, containers across the whole machine may be unable to resolve anything. See [the fallback setting](#11-a-fallback-entry) for the one option that softens this.

### 3a. Every certificate's domain is answered locally, including its subdomains

The `dns` container maps **one entry per certificate** in your Runestone `certs` directory: the domain, and every subdomain of it however deep. So a certificate for `example.test` makes `example.test`, `app.example.test` and `a.b.c.example.test` all answer with your host's address — for every container on the machine, whatever that name resolves to publicly.

That is the feature. It is also worth knowing when a certificate covers a domain that is real on the public internet, because inside containers the public answer no longer applies.

**`traefik.me` is the case where this bites.** Runestone ships a certificate for `*.traefik.me`, and [traefik.me](https://traefik.me/) is a public DNS service that decodes an address out of the name — `10.0.0.1.traefik.me` and `10-0-0-1.traefik.me` both resolve to `10.0.0.1`, and anything else resolves to `127.0.0.1`.

| From | `mysite.traefik.me` | `10-0-0-5.traefik.me` |
| --- | --- | --- |
| Your host (unchanged by Runestone) | `127.0.0.1` | `10.0.0.5` |
| Inside a container, DNS enabled | your host's address | **your host's address**, not `10.0.0.5` |

The first column is why the mapping is wanted: `127.0.0.1` inside a container means the container itself, so without it a `traefik.me` name is useless from a container. The second is the cost: a container can no longer use `<ip>.traefik.me` to reach that address. If you need that, remove `traefik.me.crt` from your certs directory, or add your own rule to `dns/custom.conf`, which Runestone never overwrites.

### 4. Port 53 on the host is occupied

The `dns` container publishes port 53, **both TCP and UDP**. If something else on your machine already holds it, the service will not start — and Runestone will tell you so before it touches the daemon configuration.

### 5. `runestone stop` deliberately leaves the DNS service running

`runestone stop` stops the Runestone environment but **keeps the `dns` container running**. That is not an oversight: the Docker daemon is pointing at it, so stopping it would break name resolution for every container on the machine.

To stop it as well:

```bash
runestone stop --all
```

That disables DNS machine-wide until it starts again. Runestone warns you before doing it.

### 6. Disable before you remove Runestone

If you delete Runestone while DNS is still enabled, the Docker daemon is left pointing at a container that no longer exists. Every container on the machine then fails to resolve anything, and nothing on the machine explains why.

**Always run `runestone dns disable` before removing Runestone.** If it is already too late, see [removing the entry by hand](#removing-the-entry-by-hand).

### 7. Disabling removes only what Runestone added

Runestone records exactly which entries it inserted. `runestone dns disable` removes those and nothing else — every other entry keeps its value and its position.

If it cannot establish with certainty which entry is its own — because the file was edited by hand, or because the same address appears more than once — **it removes nothing and says so**, rather than guessing and deleting a resolver you depend on. You can then tell it explicitly:

```bash
runestone dns disable --assume-entry 192.168.65.254
```

### 8. The DNS web UI has no authentication by default

Runestone exposes a small web UI at `https://dns.<your-domain>` for editing your own dnsmasq rules. **With `DNS_UI_USER` and `DNS_UI_PASS` unset, it has no authentication at all** — anyone who can reach this machine over HTTPS can change your DNS rules.

Set both, or turn the UI off:

```dotenv
DNS_UI_ENABLE=false
```

### 10. Everything that is not a Runestone domain is forwarded upstream

The `dns` container answers Runestone domains itself and forwards everything else to an upstream resolver. That means **every ordinary internet lookup from every container on the machine passes through the servers you configure here.**

The list is never empty — with none, containers would lose internet name resolution entirely. Runestone works out a list by looking at your Docker daemon configuration and then your host's own resolvers, and falls back to the public `1.1.1.1` only when nothing else could be determined. It tells you which happened, and where each value came from.

Multiple values are a **pool, not a priority order**: dnsmasq favours whichever answers fastest. If you need them tried in order, add `strict-order` to your own `dns/custom.conf`, which Runestone never overwrites.

### 11. A fallback entry

Off by default. When you set `DNS_DAEMON_FALLBACK`, Runestone adds a **second** entry immediately after its own, so the daemon has somewhere else to ask.

Both directions matter:

| | Fallback off (default) | Fallback on |
| --- | --- | --- |
| While the DNS service is running | No difference | No difference |
| While the DNS service is down | Lookups fail immediately and loudly, so the cause is obvious | Ordinary internet names keep resolving, for every container on the machine |
| A Runestone domain while the service is down | Fails | **Resolves to `127.0.0.1`** — the original problem, back again |

So turning it on buys resilience for unrelated projects and costs you the loud failure that makes a DNS outage obvious. Runestone's advice:

- **The machine also runs containers for projects unrelated to Runestone** → turning it on is usually right. Those projects should not lose internet DNS because a Runestone container is down.
- **A machine used mainly for Runestone development, where broken DNS should be obvious at once** → leaving it off is usually right.
- **Unsure** → leave it off. Turning it on later costs one more daemon write and one more Docker restart, nothing else.

`runestone dns enable` asks you this, and asks about the upstream list, before it
plans anything — the same two questions `runestone setup` asks, so a change of
mind does not mean running setup again.

To answer without being asked, set it in `.env` or give it on the command line:

```bash
runestone dns enable --fallback 1.1.1.1
```

```bash
runestone dns enable --no-fallback
```

A flag answers its own question and suppresses that prompt; `--yes` suppresses
every prompt, which is what makes the command usable from a script. Whichever
way you answer is written to `DNS_DAEMON_FALLBACK`, so the value in effect is
always one you can read back.

Because it asks, the command needs a terminal. Off one — in a pipe, in CI — it
stops and tells you to pass `--yes` rather than proceeding without your
consent.

## Turning it on

`runestone setup` asks whether you want DNS and records your answers. **Setup does not enable it** — it never touches the Docker daemon configuration. Enabling is its own command, so that the two confirmations it needs belong to a command you ran for that purpose.

See exactly what would change, without changing anything:

```bash
runestone dns enable --dry-run
```

That prints the full disclosure with your real values and the exact before/after of the `dns` array, then exits having written nothing.

Enable it:

```bash
runestone dns enable
```

It asks twice, and the two questions are different. The first is consent to edit the daemon configuration. The second is consent to restart Docker, which is the part that stops your containers. Answering the first does not commit you to the second.

Before it writes anything global, it checks that Docker is reachable, works out the address containers should use, starts the DNS service, and **asks that service a real question** to confirm it answers correctly. Anything that can fail, fails before your machine's global DNS has been touched.

### Writing it now and restarting later

```bash
runestone dns enable --no-restart
```

This writes the daemon configuration and stops. Nothing takes effect until you restart Docker yourself, whenever suits you. `runestone dns status` will keep telling you the change is written and waiting.

## Checking what is in effect

```bash
runestone dns status
```

This reads only — it never changes anything. It reports the daemon configuration path, where each of Runestone's entries actually sits in the array, the address containers resolve to, the upstream list and where each value came from, whether the fallback is on, and whether the web UI has authentication.

`runestone doctor` also reports on DNS when it is enabled: whether Runestone's entries are still first, whether the service is running, whether the address still matches, and whether the domain mappings are current. **`doctor` reports only** — it will not edit your daemon configuration, because deciding which entry belongs to Runestone is not something a diagnostic should guess at.

## Turning it off

```bash
runestone dns disable
```

This removes the entries Runestone recorded as its own, restarts Docker so the removal takes effect, and stops and removes the `dns` container. Your own `dns/custom.conf` is kept — it is yours.

To see what it would do first:

```bash
runestone dns disable --dry-run
```

`runestone down` also disables DNS automatically before tearing the environment down, and **aborts without removing anything** if the disable fails — because removing the `dns` container while the daemon still points at it is exactly the failure this feature exists to prevent.

## Removing the entry by hand

If Runestone is gone, or its ownership record is lost, you can remove the entry yourself. Nothing about it is magic — it is one string in a JSON array.

1. Open the daemon configuration file:
   - Docker Desktop: `~/.docker/daemon.json`
   - Native Linux: `/etc/docker/daemon.json` (needs `sudo`)

2. Find the `dns` array. It will look something like:

   ```json
   {
     "dns": ["192.168.65.254", "1.1.1.1"],
     "experimental": false
   }
   ```

3. Remove the address Runestone added — on Docker Desktop usually `192.168.65.254`, on native Linux the docker0 gateway such as `172.17.0.1`. **Leave every other entry alone.** If removing it leaves the array empty, you can delete the whole `dns` key.

4. Restart Docker so it reads the file again:

   ```bash
   docker desktop restart
   ```

   On native Linux:

   ```bash
   sudo systemctl restart docker
   ```

   If neither works, restart Docker however you normally would. **The edit takes effect only after a restart**, so until then nothing has changed.

5. Confirm a new container is no longer pointed at it:

   ```bash
   docker run --rm alpine cat /etc/resolv.conf
   ```

## When something goes wrong

### The DNS service will not start: port 53 is in use

Something else on your machine holds port 53. Runestone finds this out by trying to start the service, not by reading `netstat` — a port can look free and not be, or look taken and work anyway, and the answer can differ between TCP and UDP.

**On Windows this is commonly the Internet Connection Sharing service**, which WSL2 turns on. It holds `0.0.0.0:53/udp`. Runestone publishes port 53 in the form that coexists with it, so this usually works — but if you have set `DNS_BIND_IP` yourself, try clearing it.

Other common holders: `systemd-resolved` on Linux (it holds `127.0.0.53`), Pi-hole, dnsmasq, or another local DNS server.

To see what is holding it:

```bash
netstat -ano | findstr :53
```

On Linux:

```bash
sudo ss -ulpn 'sport = :53'
```

### Containers cannot resolve anything

Check whether the DNS service is running:

```bash
runestone dns status
```

If it is not, start it:

```bash
runestone up
```

If you cannot get it running and need your machine working now, disable DNS:

```bash
runestone dns disable
```

Consider [the fallback setting](#11-a-fallback-entry) so this cannot happen again.

### Runestone's entry is no longer first

Something else added its own entry ahead of Runestone's. The daemon asks them in order, so Runestone may no longer be consulted first and your domains may stop resolving.

`runestone dns status` and `runestone doctor` both report the actual position. By default Runestone **warns and changes nothing**, because reordering someone else's configuration without being asked is not its place. To have it move its own entries back to the front on every `runestone up`:

```dotenv
DNS_AUTO_REORDER=true
```

It moves only its own entries, never anyone else's, and it never restarts Docker to do it — the change takes effect at your next Docker restart.

### The daemon configuration was written but nothing takes effect

That is the expected state after `--no-restart`, and after any run where the restart did not complete. `runestone dns status` will say so. Restart Docker and it takes effect.

### A restart failed and the machine is in a strange state

Runestone inverts its own change when a restart or a verification fails, and **it writes the corrected file before restarting again** — so even if that second restart also fails, the file on disk is already correct and Docker will read it when it next starts.

If you are left with a file you do not trust, [remove the entry by hand](#removing-the-entry-by-hand). The exact path is printed in every failure message.

## Settings

All of these live in your Runestone `.env`.

| Setting | Default | What it does |
| --- | --- | --- |
| `DNS_ENABLE` | `false` | Whether DNS is on. **Managed by `dns enable` / `dns disable`** — setting it by hand does not enable or disable anything, it only makes Runestone's reports disagree with reality |
| `DNS_HOST_IP` | *(detected)* | The address containers resolve Runestone domains to. Managed by Runestone |
| `DNS_BIND_IP` | *(detected)* | Which host address port 53 binds to. Empty or `0.0.0.0` means all interfaces |
| `DNS_UPSTREAM` | *(detected)* | Comma-separated upstream resolvers. Empty means detect, then fall back to `1.1.1.1` |
| `DNS_DAEMON_FALLBACK` | *(empty)* | A second daemon entry. Empty means off. See [item 11](#11-a-fallback-entry) |
| `DNS_AUTO_REORDER` | `false` | Whether to move Runestone's own entries back to the front on every `up` |
| `DNS_CONTAINER_RESOLVER` | *(detected)* | The resolver the DNS container itself uses |
| `DNS_UI_ENABLE` | `true` | Whether to route `https://dns.<your-domain>` to the web UI |
| `DNS_UI_USER` | *(empty)* | Web UI username. Unset means **no authentication** |
| `DNS_UI_PASS` | *(empty)* | Web UI password. Unset means **no authentication** |

`DNS_BIND_PREFIX` also appears in `.env`. It is derived from `DNS_BIND_IP` for the Compose file's benefit; set `DNS_BIND_IP` instead.

### Your own dnsmasq rules

`dns/custom.conf` in your Runestone directory is yours. Runestone creates it once and **never overwrites it**. Use it for your own `address=` or `server=` lines, or `strict-order` if you need upstreams tried in sequence.

The two files Runestone generates — `dnsmasq.conf` and `managed.conf` — exist only inside the container and are regenerated on every start. You cannot reach them, and you do not need to: whatever each start produces is correct, with no dependence on whether the CLI ever ran.
