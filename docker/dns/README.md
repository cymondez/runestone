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

## Publishing

```bash
sh docker/dns/publish.sh 1.0
```

A tag is required and never defaulted, because `latest` as a default is how an unfinished image reaches everyone's next `docker pull`. The script refuses to publish from a dirty working tree, and stamps the commit into the image as `org.opencontainers.image.revision` — a hand-run publish otherwise has no traceable origin at all.

This is the interim publish path (spec 15.2). CI is the intended destination and is deferred, not abandoned.

### arm64 needs emulation the default builder may not have

The image targets `linux/amd64` and `linux/arm64`. Docker Desktop's default builder often supports only amd64, in which case an arm64 build fails with `exec format error`. `publish.sh` checks the builder's platform list first and refuses with the remedy rather than failing deep inside the build. Either:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

or:

```bash
docker buildx create --name runestone --driver docker-container --use
```

Both change state outside this repository, so neither is done automatically.
