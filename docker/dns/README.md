# runestone-dns

dnsmasq answering Runestone domains, supervised by [webproc](https://github.com/jpillora/webproc) so that a user's own rules can be edited through a web UI without exposing the two configuration files Runestone owns.

The normative description is [`docs/DNS-FEATURE-SPEC.md`](../../docs/DNS-FEATURE-SPEC.md) sections 8.1 to 8.5; progress and gates are in [`docs/DNS-MILESTONES.md`](../../docs/DNS-MILESTONES.md).

## Ownership, which is the whole design

| File | Location | Owner | On every container start |
| --- | --- | --- | --- |
| `dnsmasq.conf` | Container only | Runestone | Regenerated and overwritten |
| `dnsmasq.d/managed.conf` | Container only | Runestone | Regenerated and overwritten |
| `dnsmasq.d/custom.conf` | Host `~/.runestone/dns/custom.conf` | User | Created only when missing, **never overwritten** |

The two Runestone files are not mounted, so the user cannot reach them and whatever the entrypoint produces is the authoritative version. What that buys: **if the container starts, the configuration is correct** — with no dependency on whether the CLI was ever run. That is what makes `restart: unless-stopped` bringing this container back after a host reboot safe with no CLI involvement at all.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `DNS_HOST_IP` | **yes** | The address Runestone domains resolve to. The container refuses to start without it, because it would otherwise come up and answer nothing useful. |
| `DNS_UPSTREAM` | no | Comma-separated upstream resolvers. dnsmasq runs with `no-resolv`, so an empty list would leave every container on the machine unable to resolve anything; the image falls back to `1.1.1.1` and says so. The CLI always passes a non-empty list (spec 8.4). |
| `HTTP_USER` / `HTTP_PASS` | no | webproc basic auth. Passed as environment variables rather than flags, so the password does not appear in the container's process list. **Unset means the UI has no authentication.** |
| `SSL_DIR` | no | Certificate directory to scan, default `/ssl`. |
| `DNS_UI_PORT` | no | webproc's port inside the container, default `8080`. The Compose service deliberately does not publish it. |

Mappings come from filenames only — one `address=/<domain>/<DNS_HOST_IP>` per `*.crt`, excluding `rootCA.crt` and any filename that is not a valid domain. Certificate contents are never read.

## Building and verifying locally

```bash
sh docker/dns/test/verify-image.sh
```

That builds the image for the local architecture and runs the spec 14.4 checks: webproc's flags, mapping generation, refusal to start without `DNS_HOST_IP`, a clean start with an empty `/ssl`, resolution over both udp and tcp, wildcard subdomains, UI authentication, and tamper resistance across a restart.

It **never uses port 53** — the service is published on 15353 instead — so running it cannot fight the host for the real DNS port. It also uses no host paths: the fixture `/ssl` directory is a Docker volume populated by a helper container, so it behaves the same in Git Bash on Windows as in a Linux shell.

## The end-to-end harness

```bash
sh docker/dns/test/dind-harness.sh
```

The one step this feature cannot rehearse on a developer's machine is the Docker daemon restart: it terminates every container they have. So the harness does it somewhere else. A privileged `docker:dind` container has its own daemon, its own `/etc/docker/daemon.json`, its own port 53 and its own set of containers — **restarting that daemon is the same operation with a blast radius of exactly one container.** What is risk level 3 on a real machine is level 2 here, which is why any contributor can run it and why CI can run it on every change.

The daemon inside the sandbox runs under a small supervisor loop rather than as the container's entrypoint. That is the whole trick: killing it is a real daemon restart, and the container — with the CLI and the checks running inside it — survives to observe the result. A pause file lets the harness also make the daemon *not* come back, which is how the rollback-on-timeout path is exercised in seconds rather than the two minutes the real poll limit would take.

What it proves, in one run: the Target IP resolved from inside Docker, the daemon configuration written, a real restart, a new container given our address as its first nameserver, a wildcard subdomain resolving, `restart: unless-stopped` bringing dnsmasq back after a bare daemon restart with no CLI command involved, an injected restart failure restoring the file rather than leaving it half-applied, `disable` returning the file to its starting state, and — checked explicitly — the host's own daemon configuration and container list untouched throughout.

It needs `docker`, `node` and `npm` on the host. No virtual machine.

`KEEP=1` leaves the sandbox running afterwards for inspection.

## Publishing

Publishing is a manual command, run from a clean `main` checkout (spec 15.2). There is no script: one that only runs under a POSIX shell was of no use on the platform this project is mostly developed on, and a wrapper nobody can run is worse than a command written down.

```bash
docker buildx build --platform linux/amd64,linux/arm64 --tag cymondez/runestone-dns:<tag> --label "org.opencontainers.image.source=https://github.com/cymondez/runestone" --label "org.opencontainers.image.revision=<commit>" --label "org.opencontainers.image.version=<tag>" --push docker/dns
```

Four things the script used to enforce and that are now yours to hold:

- **Name the tag.** `latest` as a default is how an unfinished image reaches everyone's next `docker pull`.
- **Publish from `main`, with nothing uncommitted**, and put that commit in the revision label. It is the image's only link back to its source, and a commit that lives on a feature branch or only on one machine makes the label a lie.
- **Verify both architectures first** with `verify-image.sh` against each build.
- **Check `docker buildx inspect` lists `linux/arm64`** before building.

### arm64 needs emulation the default builder may not have

The image targets `linux/amd64` and `linux/arm64`. Docker Desktop's default builder often supports only amd64, in which case an arm64 build fails with `exec format error`. `docker buildx inspect` lists what the builder can actually produce, so check it before building rather than reading the failure. Either:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

or:

```bash
docker buildx create --name runestone --driver docker-container --use
```

Both change state outside this repository, so neither is done for you. The second is **not** an alternative on its own: measured on Docker Desktop for Windows, a freshly bootstrapped `docker-container` builder reported only `linux/amd64` and `linux/386` until binfmt was registered. It helps when the limitation is the docker driver, not when the emulators are missing.
