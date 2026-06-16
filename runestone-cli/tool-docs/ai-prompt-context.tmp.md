# Runestone AI Compose Context

Goal:
Integrate the current project with Runestone by creating or updating Docker Compose configuration.

Runestone provides:
- Traefik Docker-label routing.
- External Docker network: ${RUNESTONE_NETWORK_NAME}
- Host domain suffix: ${RUNESTONE_HOST_DOMAIN}
- HTTPS entrypoint name: ${RUNESTONE_HTTPS_ENTRYPOINT_NAME}
- Optional HTTP entrypoint name: ${RUNESTONE_HTTP_ENTRYPOINT_NAME}

Do not:
- Add a Traefik service.
- Edit Runestone's own compose file.
- Assume service name, app port, router ID, service ID, hostname, or COMPOSE_PROJECT_NAME.

You must inspect this project to determine:
- Compose file strategy: compose.yml vs compose.override.yml vs devcontainer override.
- Service to expose.
- Internal container port.
- Hostname prefix.
- Stable Traefik router/service IDs.
- Whether COMPOSE_PROJECT_NAME is explicitly configured.

Required Traefik labels:
- traefik.enable=true
- traefik.http.routers.<router-id>.entrypoints=${RUNESTONE_HTTPS_ENTRYPOINT_NAME}
- traefik.http.routers.<router-id>.rule=Host(`<host-prefix>.${RUNESTONE_HOST_DOMAIN}`)
- traefik.http.routers.<router-id>.tls=true
- traefik.http.routers.<router-id>.service=<traefik-service-id>
- traefik.http.services.<traefik-service-id>.loadbalancer.server.port=<detected-internal-port>
- traefik.docker.network=${RUNESTONE_NETWORK_NAME}

Required network:
networks:
  runestone:
    external: true
    name: ${RUNESTONE_NETWORK_NAME}

Attach the exposed service to the runestone network.

Port rule:
Use the internal container port, not the host-published port.
Example: "8080:3000" means Traefik port is 3000.

Preferred strategy:
- Existing compose file: create/update compose.override.yml.
- Devcontainer project: create/update .devcontainer/compose.override.yml and include it in devcontainer.json.
- No compose file: create compose.yml.
- If app port or service is unclear, ask the user.

Final answer should report:
- File changed.
- Service exposed.
- Internal port.
- Hostname.
- Expected URL.
- Assumptions.
