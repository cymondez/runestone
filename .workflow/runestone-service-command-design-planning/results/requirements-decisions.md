# Requirements Decisions

## Confirmed

- Command namespace is `runestone service`; `srevice` was a typo.
- Route domain accepts either a full domain or a short hostname. Short hostname is completed with the default Runestone host domain.
- Service URL currently supports only `http` and `https`.
- Service name conflicts must be checked against all Traefik API HTTP routers and services across providers.
- Existing service name is rejected. The user should be prompted to use `runestone service modify|m <service name>`.
- Route domain certificate coverage must follow X.509 wildcard rules.
- If no existing valid wildcard certificate covers the route domain, interactive add flow asks whether to create the required wildcard certificate.
- `service list` only reports dynamic config status; it does not repair or mutate state.
- Group deletion proceeds even if some service dynamic config files are already missing.
- Default group `none` means ungrouped; it is a display label, not a stored group value requirement.
- Add `runestone service modify|m <service name>` for interactive modification.
- Add `runestone service repair <service name>` to repair dynamic config.
- `runestone service modify|m <service name>` cannot modify the service name.
- `runestone service repair <service name>` only rebuilds the dynamic config from metadata.
- Route host conflict rejects only an exact same `Host(<domain>)`.
- If Traefik API cannot be reached, commands that require Traefik API validation reject immediately and tell the user to run `runestone up` or check Docker status.
- `service remove|rm <service name>` deletes both metadata and dynamic config.
- `service remove|rm <service name>` asks for confirmation by default; `--force` skips confirmation.
- Short route domain completion: `api` becomes `api.<HOST_DOMAIN>`; `api.test` is treated as a complete domain.
- Generated service dynamic config does not set explicit Traefik priority.
- Group names follow service name rules: lowercase and no spaces.
- `--from` is not needed for group move because the service metadata already stores the current group.
- `none` can be used as a real group name. Ungrouped services are represented separately and only displayed as none where needed.
- `service group clean <group name> --force --keep-services` is allowed. It skips confirmation and marks every service in the group as ungrouped.
- `service group move|mv` command shape is `runestone service group move <service name> <group name>`.

## Group Model Changes

- Group commands move under `runestone service group`.
- `runestone service list|ls` no longer has `--group-tree`.
- `runestone service remove-group|rmg` is removed.
- Group tree display moves to `runestone service group list|ls --tree --detail`.
- `runestone service group create|c <group name>` is cancelled.
- `runestone service group insert <service name>` is cancelled.
- `runestone service group extract <service name>` is cancelled.
- Group move uses current service metadata as the source group.
- Typo correction: use `--keep-services` and `<service name>`.

## Traefik Official Documentation Notes

- `Host()` matches requests whose host is set to the configured domain.
- Traefik v3 `Host()` supports a single-level wildcard prefix.
- `*.example.com` matches `foo.example.com`, but not `foo.bar.example.com` or `example.com`.
- When multiple routers can match a request, Traefik routes by priority. By default, priority is the rule length; providers precedence breaks ties across providers.
- Traefik API exposes HTTP routers and services through `/api/http/routers` and `/api/http/services`.
