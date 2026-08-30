# How Runestone's domains resolve

*Traditional Chinese: [DOMAINS.zh-TW.md](DOMAINS.zh-TW.md)*

Runestone deals with three different kinds of domain, and they behave differently in ways that are easy to get wrong. This document records what each one actually does, measured rather than assumed, and what the DNS feature ([DNS.md](DNS.md)) does to it.

**Read this before changing anything that maps a domain.** The last section lists the traps, including one that cost a real mistake.

Everything here was measured on 2026-08-29 against public resolvers and a real Docker Engine 29.5.3 host.

## The three kinds

### 1. The Runestone domain — `HOST_DOMAIN`, default `local.developers-homelab.net`

| name | public A | public AAAA |
| --- | --- | --- |
| `local.developers-homelab.net` | *(none)* | *(none)* |
| `app.local.developers-homelab.net` | `127.0.0.1` | *(none)* |

A real registered domain whose wildcard points at loopback. That is all it does: there is no service behind it, and the apex has no records at all.

It works because your browser runs on the host, where `127.0.0.1` is the host — so `app.local.developers-homelab.net` reaches Traefik, and the locally issued certificate makes it HTTPS. Nothing about it is special beyond the wildcard.

### 2. `traefik.me` — a domain that computes its own answers

This one is genuinely unusual, which is why it gets its own section. [traefik.me](https://traefik.me/) runs a DNS server that **extracts an address out of the name**:

| name | public A | public AAAA |
| --- | --- | --- |
| `traefik.me` | `185.199.108.153` … | `2606:50c0:8000::153` … |
| `mysite.traefik.me` | `127.0.0.1` | *(none)* |
| `10-0-0-5.traefik.me` | `10.0.0.5` | *(none)* |
| `10.0.0.5.traefik.me` | `10.0.0.5` | *(none)* |
| `www.10.0.0.5.traefik.me` | `10.0.0.5` | *(none)* |

Three things follow, and each has caught someone out:

- **The apex is not part of the mechanism.** `traefik.me` itself is the project's documentation website, hosted on GitHub Pages, with ordinary public A and AAAA records. It is not `127.0.0.1` and never was.
- **The address can appear anywhere in the name**, dashed or dotted, with labels in front of it. `www.10.0.0.5.traefik.me` is a valid way of saying `10.0.0.5`.
- **A name with no address in it means `127.0.0.1`.** That is the case Runestone's users actually use, and the reason `runestone setup` generates a wildcard certificate for `*.traefik.me`.

### 3. Any domain you create a certificate for

`runestone certs create <domain>` will happily issue a certificate for a name that exists on the public internet. Runestone does not check, and should not: a developer pointing `app.mycompany.com` at their own machine is a legitimate thing to do.

## What the DNS feature does to each

The `dns` container writes **one mapping per DNS name a certificate carries**, read out of the certificate itself, as `address=/<domain>/<target-ip>` — which covers that domain **and every subdomain of it, to any depth**. A wildcard name maps to the same zone as its base: `*.example.test` and `example.test` are both `address=/example.test/<target-ip>`.

| kind | effect | verdict |
| --- | --- | --- |
| 1. Runestone domain | containers resolve it to the host instead of to themselves | exactly what it is for |
| 2. `traefik.me` | `mysite.traefik.me` becomes usable from containers — **and `<ip>.traefik.me` stops meaning that address** | half feature, half cost |
| 3. Your own domain | that domain is answered locally for every container on the machine | intended, but say it out loud |

The reason kind 1 and kind 2 need the mapping at all is the same: their public answer is `127.0.0.1`, and inside a container `127.0.0.1` is the container itself. Without the mapping the name is useless from a container; with it, the name reaches Traefik.

The cost is confined to kind 2, and it is real: a container can no longer use `10-0-0-5.traefik.me` to reach `10.0.0.5`, because the whole zone now answers with the Runestone host. To keep the address-decoding, remove `traefik.me.crt` and `traefik.me.key` from the certs directory, or write your own rule in `dns/custom.conf`, which Runestone never overwrites.

## IPv4 only, and why

**This is a scope decision, taken up front. It is not something the implementation happened to end up doing.**

IPv4 is the common denominator: every environment Runestone targets has it, and it behaves the same way in all of them. IPv6 is not like that — whether it is there at all depends on the host, on the network, and on whether Docker itself was started with it enabled, and each of those can differ from one developer's machine to the next. Supporting it would mean supporting that whole matrix. **So the package targets IPv4 scenarios only**, deliberately, to keep a local development tool out of a class of complexity it has no reason to inherit. The DNS feature is simply where the decision is most visible.

It is a boundary, not a gap waiting to be filled. Anyone who wants to move it should start with "which environments am I now promising to support", not with "let me add an AAAA answer".

### How the decision shows up in the implementation

1. **The Target IP is resolved as IPv4 by construction** — `getent ahostsv4 host.docker.internal`, run inside a container (spec 10.1).
2. **The daemon entry, the bind address and the published port are all IPv4** — an address in the daemon's `dns` array, `172.17.0.1` or `0.0.0.0` for the bind, `53/tcp` and `53/udp`.
3. **`address=/domain/<ipv4>` answers A and nothing else.** Every other record type is NODATA, and none of them is forwarded upstream. Measured, one type at a time:

   ```
   A      traefik.me  →  172.17.0.1
   AAAA   traefik.me  →  (no answer)
   TXT    traefik.me  →  (no answer)
   MX     traefik.me  →  (no answer)
   HTTPS  traefik.me  →  (no answer)
   ```

   A client that asks for both takes the A. **This is correct behaviour, not a leak.**
4. **Containers have no IPv6 to begin with**, on a default installation:

   ```
   $ docker network inspect bridge --format '{{.EnableIPv6}}'
   false
   $ docker run --rm alpine:3.20 ip -6 addr show eth0 | grep -c inet6
   0
   ```

   So an AAAA answer would have nothing to travel over.

### What that means for anyone extending this

IPv6 in Docker is **opt-in and host-dependent**, which is exactly why it is out of scope rather than half-supported. If you enable it (`"ipv6": true` in the daemon configuration, or an IPv6-enabled network), the following have **never been measured** and none of them should be assumed:

- whether the daemon also hands containers an IPv6 resolver alongside ours, and in which order;
- whether our published `53` on the docker0 gateway is reachable over IPv6 at all;
- what a mapped domain should answer for AAAA once containers really do have IPv6 — `NODATA` stops being obviously right at that point;
- `DNS_UPSTREAM` with an IPv6 address: **the CLI's validation accepts the text today**, and nothing in the feature has ever exercised it. Whether dnsmasq can reach that upstream depends on the container having IPv6, which by default it does not.

Treat all of the above as unanswered. Measure before claiming any of it.

## Traps

Recorded because each one has already been hit, or came close.

- **A certificate in `certs/` is not evidence that the domain is inert publicly.** `traefik.me` has real public records at the apex and computed answers below it. Assuming "it's a local dev domain, so nothing is out there" is how you end up reasoning about the wrong thing entirely.
- **`address=/domain/ip` is already authoritative for the whole name.** Adding `local=/domain/` alongside it changes nothing — verified per record type, with a control proving forwarding worked. Someone will be tempted by it; it is a no-op. (This one is not hypothetical: it was added on 2026-08-29 to fix an AAAA "leak" that did not exist, and reverted the same day. The full retraction is in [`evidence/dns/m6b-linux-native.md`](evidence/dns/m6b-linux-native.md).)
- **The mapping covers subdomains to any depth.** A certificate for `example.test` takes `a.b.c.example.test` with it. For a wildcard-DNS service, that means the entire service.
- **`getent` and busybox `nslookup` are the wrong tools for a DNS claim.** They mix A and AAAA and hide which resolver answered. Use `dig`, name the record type, and name the server.
- **The names come from inside the certificate, not from its filename.** `rootCA.crt` is excluded by name, every other `*.crt` is opened and its `DNS:` names are read, names that are not valid domains are skipped and reported, and a file that cannot be parsed is skipped rather than falling back to what it is called. So one certificate can produce several mappings, and a file named after a domain it does not actually carry produces none for that domain.
