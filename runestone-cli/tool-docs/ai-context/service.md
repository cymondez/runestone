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

Runestone detects a loopback host in --url and offers to rewrite it, but do not rely on the prompt when you are constructing the command non-interactively.

Certificates:
A domain with no certificate covering it still routes, but the browser shows a TLS warning. `service add` checks coverage and offers to create the certificate for you. Coverage is by wildcard: a certificate for `example.test` covers `api.example.test` but not `a.b.example.test`, and the base domain must have at least two labels.

Do not:
- Add Traefik labels for this path. They do nothing without a container.
- Write into Runestone's `configuration/services/` directory by hand. `service add` generates those files and `service remove` deletes them; a hand-written file there will be overwritten or orphaned.
- Guess the service name, the hostname, or the port. Read them from this project, and if the port is not discoverable, ask the user.
- Run `runestone certs install`, `runestone dns enable` or `runestone dns disable` yourself. See the overview topic for why.

Inspect this project to determine:
- Whether the app runs in Docker at all. If it does, use the compose topic instead.
- The port it actually listens on, from its dev script, its config, or its `.env`.
- A hostname prefix that reflects the project, and a service name that matches it.

Verify afterwards:
- `runestone service list` shows the new entry with its route and URL.
- The expected URL is `https://<domain>`.

Report:
- The command you ran.
- Service name, route, target URL.
- Whether a certificate already covered the domain.
- Anything you had to assume.

Hostnames available on this machine:
{{BLOCK:DOMAINS}}

Names already taken:
{{BLOCK:USED_NAMES}}

{{BLOCK:FOOTER}}
