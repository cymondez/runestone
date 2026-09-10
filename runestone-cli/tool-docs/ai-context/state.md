# Runestone: Live State Of This Machine

Everything below was read at the moment this command ran. Do not copy it into a
file — it goes stale. Re-run the command instead.

Host domain suffix: {{RUNESTONE_HOST_DOMAIN}}
External Docker network: {{RUNESTONE_NETWORK_NAME}}
HTTPS entrypoint name: {{RUNESTONE_HTTPS_ENTRYPOINT_NAME}}
HTTP entrypoint name: {{RUNESTONE_HTTP_ENTRYPOINT_NAME}}

## Hostnames you may use

{{BLOCK:DOMAINS}}

## Names already taken

A Traefik router or service ID is global to Traefik, not scoped per project, so
a name that is free in this project may already be registered by another one.
Pick something that does not appear below.

{{BLOCK:USED_NAMES}}

## Is Runestone running

{{BLOCK:RUNTIME}}

## Container DNS

{{BLOCK:DNS_STATE}}

## Anything to flag

{{BLOCK:WARNINGS}}

{{BLOCK:FOOTER}}
