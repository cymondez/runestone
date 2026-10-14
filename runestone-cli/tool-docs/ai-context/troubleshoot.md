# Runestone: Troubleshooting An Integration

Match the symptom before changing anything. Most of these look like a broken
config and are in fact a different layer failing.

Host domain suffix: {{RUNESTONE_HOST_DOMAIN}}
External Docker network: {{RUNESTONE_NETWORK_NAME}}

Read-only commands, safe to run without asking:
- runestone status          whether Runestone can be used right now, and what needs fixing
- runestone service list    routes added with `service add`, and nothing else
- runestone certs list      certificates and the domains they cover
- runestone dns status      whether container DNS is in effect

`runestone doctor` checks the host environment, but in a terminal it offers to
install what is missing. Ask the user to run it.

Symptom: a "Service not found!" page, or a 404.
There is no route for that hostname. Either the router was never registered, or
its rule does not match the hostname you opened. Runestone answers every
hostname under {{RUNESTONE_HOST_DOMAIN}} that has no route with its own "Service
not found!" page and HTTP status 200, so look at the page, not the status code.
A hostname outside {{RUNESTONE_HOST_DOMAIN}} gets Traefik's plain 404 instead.
- Compose path: is the container running, is it attached to {{RUNESTONE_NETWORK_NAME}}, and does it carry `traefik.enable=true`? A container that is not on that network is invisible to Traefik even with correct labels.
- `service add` path: does `runestone service list` show the route?
- Check the hostname for a typo against the rule. `runestone docs --ai-context state` lists every hostname that has a route.

Symptom: 502 from Traefik.
The route matched and the target did not answer. The routing is correct; the
port or the host is wrong.
- Compose path: the port in `loadbalancer.server.port` must be the **container's internal** port, not the host-published one. In `"8080:3000"` the correct value is 3000. This is the single most common mistake on this path.
- `service add` path: the --url host must be reachable from inside the Runestone container. If the app listens on the host, `localhost` will not do — use `host.docker.internal`. On a Linux Docker Engine, as opposed to Docker Desktop, that is the Docker bridge address, so the app must listen on 0.0.0.0, not only on 127.0.0.1 or localhost.
- Confirm the app is actually listening: on the host, or inside the container with the container's own port.

Symptom: "Blocked request", "Invalid Host header", or a 403 from a dev server.
The route works. The dev server refuses a hostname it does not know: Vite allows
only localhost and IP addresses by default, webpack-dev-server only localhost and
its own host.
- Add the Runestone hostname to the dev server's allowed hosts: Vite `server.allowedHosts`, webpack-dev-server `devServer.allowedHosts`.

Symptom: the browser warns about the certificate.
Nothing is broken in the routing. No certificate covers that hostname.
- `runestone certs list` shows the covered domains. Coverage is by wildcard, so a certificate for `example.test` covers `api.example.test` but not `a.b.example.test`.
- The fix is `runestone certs create <base-domain>`, which is a project-integration step and is fine to propose.
- If every domain warns rather than just this one, the root CA is not trusted on this machine. That needs `runestone certs install`, which requires elevation — **ask the user to run it**, do not run it yourself.
- On Windows, curl (Git Bash's and `curl.exe` alike) checks certificate revocation through Schannel and fails on every local certificate with `CRYPT_E_NO_REVOCATION_CHECK`. That is not an untrusted CA and no reason for `runestone certs install`: add `--ssl-no-revoke`.

Symptom: it works in the browser but not from another container.
This is the loopback problem and it is the one failure that is not a
misconfiguration.
A Runestone domain resolves to 127.0.0.1. In a browser on the host that is
exactly where Traefik is listening. Inside a container, 127.0.0.1 is that
container's own loopback, so the same hostname means two different things
depending on where it is resolved.
- Do not "fix" this by rewriting the URL to a container service name. That bypasses Traefik, and with it TLS termination, the routing rules and the certificate — the same URL would then behave differently on the two sides, which defeats the reason for using a domain at all.
- Check `runestone dns status`. If container DNS is off, that is the cause.
- Turning it on is `runestone dns enable`, which **restarts the Docker daemon and therefore stops every container on the machine**. Never run it. Tell the user it exists, tell them what it costs, and let them decide.
- As a narrow workaround for one container, `extra_hosts` with `host-gateway` reaches the host without touching the daemon. It does not scale, because every project must then enumerate every domain it talks to.

Symptom: the route worked and then stopped.
- `runestone status` — its first line says whether Runestone is running and usable.
- Did another project register the same router name or the same hostname? Names are global to Traefik, not scoped per project. `runestone docs --ai-context state` lists every router ID, service ID and hostname registered with Traefik, by any project.

Symptom: a change to a route added with `service add` made no difference.
Traefik reloads its file provider on change, but a syntactically invalid file is
ignored rather than reported. If a service stopped resolving right after an
edit, prefer `runestone service repair <name>` over editing the generated file
again.

Report:
- The symptom and which layer it pointed at.
- What you checked and what the read-only commands showed.
- The change, or the command you are asking the user to run and why it needs them.

Container DNS on this machine:
{{BLOCK:DNS_STATE}}

Is Runestone running:
{{BLOCK:RUNTIME}}

{{BLOCK:FOOTER}}
