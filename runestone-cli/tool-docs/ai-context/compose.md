# Runestone AI Compose Context

Goal:
Integrate the current project with Runestone by creating or updating Docker Compose configuration.

Use this topic only when the thing to expose runs in a container. If it runs on
the host (`npm run dev`, `vite`, `next dev`), or nothing in this project runs in
a container, this is the wrong topic: use `runestone docs --ai-context service`.

Runestone provides:
- Traefik Docker-label routing.
- External Docker network: {{RUNESTONE_NETWORK_NAME}}
- Host domain suffix: {{RUNESTONE_HOST_DOMAIN}}
- HTTPS entrypoint name: {{RUNESTONE_HTTPS_ENTRYPOINT_NAME}}
- HTTP entrypoint `{{RUNESTONE_HTTP_ENTRYPOINT_NAME}}` already redirects every request to HTTPS. Do not add an HTTP router.

Do not:
- Add a Traefik, nginx-proxy, Caddy or other reverse-proxy service, or publish ports 80 or 443. Runestone's Traefik already serves every project.
- Add a Mailpit, MailHog, smtp4dev or other mail-catcher service. Point the app's SMTP settings at Runestone's Mailpit instead: `{{RUNESTONE_SMTP_FROM_NETWORK}}` from a container on the `{{RUNESTONE_NETWORK_NAME}}` network, as listed in the overview topic.
- Edit Runestone's own compose file.
- Assume which Compose service to expose, or its internal port. Read them from this project.

You must inspect this project to determine:
- Compose file strategy: compose.yml vs compose.override.yml vs devcontainer override.
- Compose service to expose.
- Internal container port.

Choose these yourself and state them in your report; do not stop to ask:
- Hostname prefix: the Compose project name, which is the project's directory name unless the Compose file's top-level `name:` or `COMPOSE_PROJECT_NAME` sets another.
- Traefik router ID and Traefik service ID: the hostname prefix, for both. Check the ID and the hostname first with `runestone service check <router-id> --route <host-prefix>.{{RUNESTONE_HOST_DOMAIN}}`; Traefik shares these names across every project on the machine. It changes nothing.

The override to write. Replace every <placeholder>:

```yaml
services:
  <compose-service>:
    networks:
      # Listing networks replaces the implicit default network, so list it
      # too. Without it this service can no longer reach the project's other
      # services, such as its database, by name.
      - default
      - runestone
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.<router-id>.entrypoints={{RUNESTONE_HTTPS_ENTRYPOINT_NAME}}"
      - "traefik.http.routers.<router-id>.rule=Host(`<host-prefix>.{{RUNESTONE_HOST_DOMAIN}}`)"
      - "traefik.http.routers.<router-id>.tls=true"
      - "traefik.http.routers.<router-id>.service=<traefik-service-id>"
      - "traefik.http.services.<traefik-service-id>.loadbalancer.server.port=<internal-port>"
      - "traefik.docker.network={{RUNESTONE_NETWORK_NAME}}"

networks:
  runestone:
    external: true
    name: {{RUNESTONE_NETWORK_NAME}}
```

Names on the shared network:
Joining `{{RUNESTONE_NETWORK_NAME}}` lets this service resolve every other container on
it by name, including the Compose service names other projects expose, such as
`api`, `web` or `app`. When a name exists both there and on this project's own
network, Docker may answer with the other project's container: in a measurement
it depended on how the two network names sort, not on anything in this file.
`runestone docs --ai-context state` lists the names already on
`{{RUNESTONE_NETWORK_NAME}}`. If the service you expose calls a sibling by one of
those names, have it call the sibling by a name only this project has: its
container name (`<project>-<service>-1`), or an alias you give the sibling on the
project's own network.

Port rule:
Use the internal container port, not the host-published port.
Example: "8080:3000" means Traefik port is 3000.

Where to put it:
- Existing compose file: create or update compose.override.yml beside it. Compose loads it automatically.
- Devcontainer project: create or update .devcontainer/compose.override.yml and include it in devcontainer.json.
- No compose file: nothing runs in a container, so use the service topic instead. Create a compose.yml only if the user asked for the project to run in Docker.
- If the Compose service or its port is unclear, ask the user.

Before committing it:
Write the file without asking, but ask before committing it. compose.override.yml
is loaded by every `docker compose up` in this directory, on every machine. Where
Runestone is not installed the external network does not exist and
`docker compose up` fails, and the labels carry this machine's host domain. Ask
the user whether everyone on the project uses Runestone; if not, keep the file
out of git.

Recreating the containers restarts the user's running stack. Ask the user to run
`docker compose up -d`, or ask before running it yourself.

Verify afterwards:
- `docker compose config` shows the Compose service on both `default` and `runestone`, with every label above.
- Once the project's containers are recreated (`docker compose up -d`), `runestone docs --ai-context state` lists `<router-id>@docker` among the Traefik router IDs.
- Request `https://<host-prefix>.{{RUNESTONE_HOST_DOMAIN}}` and check that the response comes from the app. A hostname under {{RUNESTONE_HOST_DOMAIN}} with no route gets Runestone's own "Service not found!" page with HTTP status 200, so the status code alone proves nothing. With curl on Windows, add `--ssl-no-revoke`.

Final answer should report:
- File changed.
- Compose service exposed.
- Internal port.
- Hostname, and that you chose it.
- Expected URL.
- Assumptions.

Hostnames available on this machine:
{{BLOCK:DOMAINS}}

Names already taken — a router or service ID collision is global to Traefik, not scoped per project:
{{BLOCK:USED_NAMES}}

{{BLOCK:FOOTER}}
