# Runestone: Overview For An Agent

Runestone is a local development environment: Traefik in front, locally trusted
certificates from mkcert, and Mailpit for outbound mail. It gives projects on
this machine real HTTPS on a real hostname, so that cookies, OAuth redirects,
webhooks and cross-subdomain behaviour can be tested the way they will behave
in production — and so that ports 80 and 443 can be shared instead of fought
over.

It is already installed and configured on this machine. Setting it up is not
your job and nothing here asks you to.

This machine:
- Host domain suffix: {{RUNESTONE_HOST_DOMAIN}}
- External Docker network: {{RUNESTONE_NETWORK_NAME}}
- HTTPS entrypoint name: {{RUNESTONE_HTTPS_ENTRYPOINT_NAME}}
- HTTP entrypoint name: {{RUNESTONE_HTTP_ENTRYPOINT_NAME}}

Hostnames under `{{RUNESTONE_HOST_DOMAIN}}` are meant to resolve to 127.0.0.1 on
this machine, where Traefik listens on ports 80 and 443. The default domain,
`local.developers-homelab.net`, and names under `traefik.me` do this through
public DNS; a domain of your own does it only if the user's DNS or hosts file
says so. `runestone status` reports it when this machine cannot resolve the
domain. Inside a container 127.0.0.1 is the container itself; the troubleshoot
topic covers that.

## How to connect a project, step by step

1. Read the whole guide: `runestone docs --ai-context` prints this overview followed by both integration paths.
2. Look at the project and choose the path, by the question under "There are exactly two ways to connect a project" below.
3. Run `runestone docs --ai-context state`. It lists the hostnames a certificate covers, and the names and hostnames already taken by any project.
4. Choose the hostname and the name yourself, from the project's directory name, and check them with `runestone service check <name> --route <hostname>`. It says whether each is free across every project, and which certificate to create if none covers the hostname. It changes nothing.
5. Write the Compose override, or run `runestone service add` with every value on the command line.
6. Verify with the checks at the end of the compose or the service topic, then report what you changed, the URL, and what you assumed.

If the `runestone` command is not found, you are probably inside a container or a
sandbox that cannot see the host. Ask the user to run the Runestone commands on
the host.

## Runestone already provides these: do not add your own

Every project on this machine shares one of each. A project connects to them; it
never runs its own copy.

| Provided | How a project uses it |
| --- | --- |
| Traefik: HTTPS on ports 80 and 443 for every `*.{{RUNESTONE_HOST_DOMAIN}}` hostname | Through one of the two paths below. Do not add Traefik, nginx-proxy, Caddy or any other reverse proxy, and do not publish ports 80 or 443 |
| Mailpit: catches every mail sent to it and shows it at {{RUNESTONE_MAILPIT_URL}} | Point the project's SMTP settings at it, using the addresses below. Do not add Mailpit, MailHog, smtp4dev, MailCatcher or any other mail catcher |
| Locally trusted certificates | Traefik terminates TLS, so the project serves plain HTTP and needs no certificate of its own. When no certificate covers a hostname, `runestone certs create <base-domain>` makes one |
| Traefik dashboard | {{RUNESTONE_TRAEFIK_URL}} shows every router and service registered, by every project |

Mailpit's SMTP address depends on where the sender runs. It needs no username, no
password and no TLS:

- From a process on the host: `{{RUNESTONE_SMTP_FROM_HOST}}`
- From a container on the `{{RUNESTONE_NETWORK_NAME}}` network, which every container exposed through Traefik labels joins: `{{RUNESTONE_SMTP_FROM_NETWORK}}`
- From any other container: add `extra_hosts: ["host.docker.internal:host-gateway"]` to that service, then use `{{RUNESTONE_SMTP_FROM_CONTAINERS}}`. Do not assume `host.docker.internal` resolves inside a container without that line; on some machines it does not

## Shared resources the user declared

Backing services already running on this machine for every project to use. Use
these rather than adding a database, a cache or an object store of your own:

{{BLOCK:RESOURCES}}

## There are exactly two ways to connect a project

Choose by asking one question: **does the thing being exposed run in a
container that Traefik can discover?**

| Answer | Path | Topic |
| --- | --- | --- |
| Yes | Traefik labels on the service, plus joining the external network | `compose` |
| No | `runestone service add`, which writes a Traefik file-provider entry | `service` |

Getting this wrong is the most common failure, and it fails quietly. Traefik
labels on a project that has no container are inert: the file reads correctly
and nothing routes. A file-provider entry pointing at `localhost` is inert for
the mirror-image reason — inside the Runestone container, `localhost` is that
container.

If the project has a Compose file but the thing the user wants exposed is a host
process, the second path is still the right one. The presence of a Compose file
does not decide it; the presence of a container does.

## What "service" means in these topics

The word means four different things around Runestone, so these topics keep
them apart:

- **Runestone's own components**: Traefik, Mailpit and the DNS service. They are already running; a project never adds or configures them.
- **A route added with `runestone service add`**: something outside Docker that you put on a Runestone hostname. `runestone service list` lists these and nothing else, so an empty list does not mean Runestone provides nothing.
- **Traefik router ID and Traefik service ID**: the names inside Traefik labels. Traefik shares them across every project on the machine.
- **Compose service**: a service in this project's own Compose file, such as `api`.

## Commands you must not run

These change state outside this project. Propose them, explain what they cost,
and let the user run them.

| Command | Why it is not yours to run |
| --- | --- |
| `runestone dns enable`, `runestone dns disable` | Writes the Docker daemon's own configuration and restarts the daemon, which stops **every container on the machine**, including ones unrelated to this project |
| `runestone certs install` | Requires elevation and modifies the system trust store |
| `runestone setup` | Rewrites Runestone's configuration for every project on the machine |
| `runestone down` | Removes the environment; with flags, its volumes and images too |
| `runestone up`, `runestone stop` | Changes what is running for every project |

## Commands that are safe

Read-only, no confirmation needed:
`runestone status`, `runestone service check`, `runestone service list`,
`runestone certs list`, `runestone dns status`, `runestone docs --ai-context`.

`runestone doctor` checks the host environment, but in a terminal it offers to
install what is missing, so ask the user to run it.

Project-integration writes, fine to run as part of the task you were given:
`runestone service add`, `runestone service remove`, `runestone certs create`.

## Rules that hold on both paths

- Use the **internal** container port, never the host-published one. `"8080:3000"` means the port Traefik needs is 3000.
- Never add a reverse proxy or a mail catcher of your own (see the table above), and never edit Runestone's own Compose file or the generated files under its `configuration/` directory.
- Traefik router IDs and Traefik service IDs are global, not scoped per project. Check for a collision before choosing one.
- A hostname with no certificate covering it still routes, but the browser warns. Coverage is by wildcard and one level deep only.
- Traefik ends HTTPS and talks to the app over plain HTTP. It sends `X-Forwarded-Proto: https`, `X-Forwarded-Host`, `X-Forwarded-Port` and `X-Forwarded-For`, replacing any the browser sent, and passes the `Host` header unchanged. An app that builds absolute URLs, redirects to HTTPS or sets secure cookies has to trust those headers, or it produces `http://` links or a redirect loop. In Express that is `app.set('trust proxy', 1)`; most frameworks have an equivalent setting.
- Do not assume the Compose service or the port. Read them from this project, and ask when one is not discoverable.
- Do choose the hostname: default its prefix to the project's directory name (for a Compose project, its Compose project name), check it against `runestone docs --ai-context state`, and say in your report that you chose it. Do not stop to ask.

## Anything to flag on this machine

{{BLOCK:WARNINGS}}

## Topics

{{BLOCK:FOOTER}}
