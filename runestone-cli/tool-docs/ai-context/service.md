# Runestone: Routing Something That Is Not In Docker

Goal:
Give this project a Runestone HTTPS domain when Traefik labels cannot be used.

Use this path, not Compose labels, when any of these is true:
- The app runs on the host, not in a container. A dev server started with `npm run dev`, `vite`, `next dev`, `dotnet watch`, `php artisan serve`.
- The app is already running and you must not restart it.
- The target is a URL you do not control, on this machine or elsewhere.
- The project has no Compose file and adding one would be a bigger change than the user asked for.

Compose labels only work when there is a container for Traefik to discover. If there is no container, labels are inert — the file will look correct and nothing will route.

Runestone provides:
- Host domain suffix: {{RUNESTONE_HOST_DOMAIN}}
- HTTPS entrypoint name: {{RUNESTONE_HTTPS_ENTRYPOINT_NAME}}

The command:
runestone service add <name> --route <domain> --url <url>

Optional: --group <group-name> to file it under a group.

Field rules. These are enforced, and violating them is an error, not a warning:
- <name>: must match ^[a-z0-9][a-z0-9-]*$ — lowercase letters, digits and hyphens, and it may not start with a hyphen. It becomes the Traefik router and service ID, so it must not collide with a name another project already registered.
- <domain>: a hostname only. No scheme, no port, no path — the presence of `/` or `:` is rejected. It is lower-cased for you. Normally `<something>.{{RUNESTONE_HOST_DOMAIN}}`.
- <url>: where Runestone should forward to, as `http://host:port` or `https://host:port`. The scheme must be http or https. **A path and a query string are accepted and preserved**; a bare trailing `/` is dropped.

Reaching the host from Runestone:
The Runestone container has to be able to reach your app. If the app listens on the host, `localhost` and `127.0.0.1` in --url mean the Runestone container itself, not the host, so they will not work. Use `host.docker.internal` as the host instead:

  runestone service add web --route web.{{RUNESTONE_HOST_DOMAIN}} --url http://host.docker.internal:3000

Certificates:
A domain with no certificate covering it still routes, but the browser shows a TLS warning. When no certificate covers the hostname, `service add` asks whether to create one. Coverage is by wildcard: a certificate for `example.test` covers `api.example.test` but not `a.b.example.test`, and the base domain must have at least two labels.

Running it without a terminal:
`service add` asks its questions in a terminal. From a non-interactive shell, which is how an agent runs commands, it cannot ask, so it stops with an error at the first question. Leave it nothing to ask:
- Pass the name, --route and --url on the command line, all three.
- Use a hostname a certificate already covers; `runestone docs --ai-context state` lists them. Otherwise run `runestone certs create <base-domain>` first.
- Use `host.docker.internal` in --url, never `localhost` or `127.0.0.1`. Given a loopback host, `service add` asks whether to rewrite it.

Do not:
- Start a reverse proxy or a mail catcher of your own for the app. Runestone already runs Traefik and Mailpit; an app on the host sends mail to Mailpit at `{{RUNESTONE_SMTP_FROM_HOST}}`.
- Add Traefik labels for this path. They do nothing without a container.
- Write into Runestone's `configuration/services/` directory by hand. `service add` generates those files and `service remove` deletes them; a hand-written file there will be overwritten or orphaned.
- Guess the port. Read it from this project, and if it is not discoverable, ask the user.
- Run `runestone certs install`, `runestone dns enable` or `runestone dns disable` yourself. See the overview topic for why.

Inspect this project to determine:
- Whether the app runs in Docker at all. If it does, use the compose topic instead.
- The port it actually listens on, from its dev script, its config, or its `.env`.
- Whether its dev server checks the Host header. Vite (`server.allowedHosts`, since 6.0.9, 5.4.12 and 4.5.6) and webpack-dev-server (`devServer.allowedHosts`) refuse hostnames they do not know, so add the Runestone hostname there before you verify. That change carries this machine's host domain; ask the user before committing it.
- Whether the dev server keeps its port. Vite moves to the next free port when its own is taken, and the route then reaches nothing, or another app. Start it with `--strictPort` (or set `server.strictPort: true`) so it exits instead.

Choose these yourself and state them in your report; do not stop to ask:
- Hostname prefix: the project's directory name.
- Route name: the same value. Check both first with `runestone service check <name> --route <hostname>`; it changes nothing, and exits 1 when either is taken.

Verify afterwards:
- `runestone service list` shows the new entry with its hostname and URL.
- `runestone docs --ai-context state` lists `<name>@file` among the Traefik router IDs.
- With the app running, request `https://<domain>` and check that the response comes from the app. A hostname under {{RUNESTONE_HOST_DOMAIN}} with no route gets Runestone's own "Service not found!" page with HTTP status 404. With curl on Windows, add `--ssl-no-revoke`.
- A page saying "Blocked request" or "Invalid Host header" comes from the dev server, which refuses hostnames it does not know: Vite allows only localhost and IP addresses by default, webpack-dev-server only localhost and its own host. Add the hostname to the dev server's allowed hosts: Vite `server.allowedHosts`, webpack-dev-server `devServer.allowedHosts`.
- A 502 means Runestone cannot reach the app. On a Linux Docker Engine, as opposed to Docker Desktop, `host.docker.internal` is the Docker bridge address, which a server listening only on 127.0.0.1 or localhost does not answer: make the dev server listen on 0.0.0.0 (for Vite, `vite --host`).

Report:
- The command you ran.
- Route name, hostname, target URL.
- Whether a certificate already covered the domain.
- Any change the dev server needed, such as its allowed hosts.
- Anything you had to assume, including the hostname you chose.

Hostnames available on this machine:
{{BLOCK:DOMAINS}}

Names already taken:
{{BLOCK:USED_NAMES}}

{{BLOCK:FOOTER}}
