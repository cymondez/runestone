# Runestone Service Command Design Planning

## Goal

Add a Runestone CLI service management design that allows users to register external HTTP/HTTPS services into Runestone's Traefik routing, persist service metadata, manage groups, repair generated configuration, and inspect current state.

## Scope

This planning covers product behavior and command design only. It does not define implementation details.

## Data Model

Runestone service metadata is stored in `~/.runestone/runestone.config.json`.

```json
{
  "services": [
    {
      "group": "",
      "name": "",
      "route": "",
      "url": ""
    }
  ]
}
```

Field meanings:

- `group`: service group. Empty value means ungrouped. Display may show ungrouped services as `none`.
- `name`: service name.
- `route`: route domain used by Traefik `Host(...)`.
- `url`: upstream service URL.

Generated dynamic configuration is stored under:

```text
configuration/services/<service-name>.service.yml
```

## Validation Rules

Service name:

- Required.
- Lowercase only.
- No spaces.
- Must not already exist in Runestone service metadata.
- Must not conflict with any existing Traefik HTTP router or HTTP service name from any provider.

Route domain:

- Required.
- Must follow HTTP domain rules.
- Must not contain a path.
- If the value has no dot, append the configured Runestone host domain.
- If the value contains a dot, treat it as a complete domain.
- Reject only when Traefik already has an exact same `Host(<domain>)`.

URL:

- Required.
- Supports only `http` and `https`.
- Format is `<protocol>://<host>:<port>`.
- Host may be an IP address or domain.
- Port may be omitted.
- No existence check is required.

Group:

- Optional.
- Defaults to ungrouped.
- Display label for ungrouped services is `none`.
- Group names follow service name rules: lowercase and no spaces.
- `none` is allowed as a real group name.

Traefik API:

- Commands requiring router/service conflict checks must access Traefik API.
- If Traefik API is unavailable, reject the operation and tell the user to run `runestone up` or check Docker status.

Certificate coverage:

- Before creating or modifying a route, check whether an existing valid wildcard certificate covers the route domain.
- Coverage follows X.509 wildcard rules.
- Example: `*.docker.so` covers `netzeropro.docker.so`.
- Example: `*.docker.so` does not cover `app.netzeropro.docker.so`; this requires `*.netzeropro.docker.so`.
- If no suitable certificate exists, interactive flow asks whether to create the required wildcard certificate.

## Commands

### Add

```text
runestone service add <service name> --route <domain> --url <url> [--group <group name>]
```

Behavior:

- If all required values are present and valid, create the service directly.
- If required values are missing or invalid, enter interactive mode to complete or correct them.
- If service name already exists, reject and tell the user to use `runestone service modify|m <service name>`.
- Create metadata in `runestone.config.json`.
- Create `configuration/services/<service-name>.service.yml`.

### Modify

```text
runestone service modify <service name>
runestone service m <service name>
```

Behavior:

- Interactive only.
- Allows changing route, url, and group.
- Does not allow changing service name.
- Requires Traefik API validation for conflicts.
- Updates metadata and regenerates dynamic config.

### Repair

```text
runestone service repair <service name>
```

Behavior:

- Uses existing metadata to recreate `configuration/services/<service-name>.service.yml`.
- Does not modify metadata.
- Does not perform broader repair actions.

### List

```text
runestone service list [--no-header]
runestone service ls [--no-header]
```

Behavior:

- Lists services from metadata.
- Shows whether the corresponding dynamic config exists.
- Does not repair or mutate state.
- `--group-tree` is not supported; group tree view belongs to `service group list`.

### Remove

```text
runestone service remove <service name> [--force]
runestone service rm <service name> [--force]
```

Behavior:

- Deletes metadata and dynamic config.
- Requires confirmation by default.
- `--force` skips confirmation.

## Group Commands

### List Groups

```text
runestone service group list [--tree] [--detail]
runestone service group ls [--tree] [--detail]
```

Behavior:

- Default output shows group names only.
- `--tree` shows service names under each group.
- `--detail` is effective only with `--tree`, and shows full service information.

### Clean Group

```text
runestone service group clean <group name> [--force] [--keep-services]
```

Behavior:

- Without `--keep-services`, deletes all services in the group.
- With `--keep-services`, keeps services and marks them as ungrouped.
- `--force` skips confirmation.
- `--force --keep-services` is allowed and means no confirmation plus keep services as ungrouped.
- Missing dynamic config files do not block metadata cleanup.

### Move Service

```text
runestone service group move <service name> <group name>
runestone service group mv <service name> <group name>
```

Behavior:

- Moves the service to the target group.
- Source group is read from service metadata; no `--from` option is needed.

## Cancelled Commands

The following commands are not part of the design:

```text
runestone service group create|c <group name>
runestone service group insert <service name>
runestone service group extract <service name>
runestone service remove-group|rmg
```

## Traefik Notes

The design relies on Traefik HTTP routers and services API endpoints for conflict checks. Traefik `Host()` supports domain matching and single-level wildcard matching. Router priority is not explicitly set by Runestone service dynamic config.

## Verification Checklist

- All requested commands are covered.
- Removed group commands are explicitly marked cancelled.
- Metadata and dynamic config responsibilities are defined.
- Missing Traefik API behavior is defined.
- Certificate coverage behavior is defined.
- No remaining open product questions for the current scope.

## Implementation Result

Implemented in `runestone-cli` and verified with TypeScript compile plus the full Jest test suite.

Follow-up implementation notes:

- Windows service dynamic config changes restart the Runestone container, matching the existing certificate sync workaround.
- Upstream URLs that target `localhost`, `127.0.0.1`, or `::1` now warn that those addresses point inside the Runestone container and ask whether to use `host.docker.internal`.
