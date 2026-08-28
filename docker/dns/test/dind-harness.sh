#!/bin/sh
# End-to-end verification of the DNS feature inside a Docker-in-Docker sandbox
# (spec 14.5, milestone M6a).
#
# Why this exists: the one step that cannot be rehearsed on a developer's machine
# is the Docker daemon restart, because it terminates every container they have.
# A privileged `docker:dind` container has its own daemon, its own
# `/etc/docker/daemon.json`, its own port 53 and its own set of containers — so
# restarting *that* daemon is semantically the same operation with a blast radius
# of exactly one container. What is level 3 on a real machine is level 2 here.
#
# The daemon inside the sandbox is run under a tiny supervisor loop rather than as
# the container's own entrypoint. That is the whole trick: killing it is a real
# daemon restart, and the container — with the CLI and the test running inside it
# — survives to observe the result.
#
# Nothing here bind-mounts a host path into the sandbox. A bind mount is resolved
# by the *daemon*, so a path that exists where this script runs need not exist
# where the daemon does — which is exactly the situation in CI, where the step is
# itself a container. Files go in with `docker cp`, which streams them over the
# API and therefore works against any daemon, local or not.
#
# Requires: docker, node and npm wherever this runs. No virtual machine, and no
# privileges beyond being allowed to start a privileged container.
set -u

DIND_NAME=${RUNESTONE_DIND_NAME:-runestone-dns-dind}
DIND_IMAGE=${RUNESTONE_DIND_IMAGE:-docker:dind}
KEEP=${KEEP:-0}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image_dir=$(dirname -- "$script_dir")
repo_root=$(dirname -- "$(dirname -- "$image_dir")")
cli_dir="${repo_root}/runestone-cli"

passed=0
failures=0

say() { echo "$*"; }
ok() {
    passed=$((passed + 1))
    echo "  ok    $1"
}
bad() {
    failures=$((failures + 1))
    echo "  FAIL  $1"
    [ -n "${2:-}" ] && echo "        $2"
    return 0
}
expect_equal() {
    if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$2] got [$3]"; fi
}
expect_contains() {
    case "$2" in
        *"$3"*) ok "$1" ;;
        *) bad "$1" "[$3] not found in: $(printf '%s' "$2" | tr '\n' '|')" ;;
    esac
}

work=""
cleanup() {
    if [ "$KEEP" = "1" ]; then
        say "KEEP=1: leaving ${DIND_NAME} running for inspection"
    else
        docker rm -f "$DIND_NAME" >/dev/null 2>&1
    fi
    [ -n "$work" ] && rm -rf "$work"
    return 0
}
trap cleanup EXIT INT TERM

# Anything run inside the sandbox goes through here, so no host-side shell ever
# has to quote a container-side path (Git Bash rewrites those).
inside() {
    docker exec "$DIND_NAME" sh -c "$1"
}

say "runestone-dns end-to-end harness"
say "  sandbox   ${DIND_NAME} (${DIND_IMAGE})"
say ""

# ---------------------------------------------------------------- host preparation
work=$(mktemp -d 2>/dev/null || mktemp -d -t runestone-dind)
host_daemon="${HOME}/.docker/daemon.json"
host_daemon_before="(absent)"
[ -f "$host_daemon" ] && host_daemon_before=$(cat "$host_daemon")
host_containers_before=$(docker ps -aq | sort | tr '\n' ' ')

say "building the images the sandbox needs"
docker build -q -t runestone-dns:harness "$image_dir" >/dev/null || {
    echo "could not build the dns image" >&2
    exit 1
}
printf 'FROM alpine:3.22\nRUN apk add --no-cache bind-tools\n' |
    docker build -q -t runestone-dns-probe:harness - >/dev/null || {
    echo "could not build the probe image" >&2
    exit 1
}

say "packing the CLI"
(cd "$cli_dir" && npm run build >/dev/null 2>&1 && npm pack --pack-destination "$work" >/dev/null) || {
    echo "could not pack the CLI" >&2
    exit 1
}
cli_tarball=$(cd "$work" && ls ./*.tgz | head -1 | sed 's|^\./||')

say "exporting the images"
docker save runestone-dns:harness runestone-dns-probe:harness -o "${work}/images.tar" || exit 1

# The supervisor: a daemon that comes back when killed, and a pause file so the
# harness can also make it *not* come back.
cat > "${work}/supervise.sh" <<'SUPERVISOR'
#!/bin/sh
while true; do
    while [ -f /work/pause ]; do sleep 1; done
    dockerd --host=unix:///var/run/docker.sock >>/var/log/dockerd.log 2>&1
    echo "--- dockerd exited, supervisor restarting it ---" >>/var/log/dockerd.log
    sleep 1
done
SUPERVISOR

# What `RUNESTONE_DNS_RESTART_CMD` points at for the ordinary case: a real daemon
# restart, observed by the CLI exactly as it would observe a real one.
cat > "${work}/restart.sh" <<'RESTART'
#!/bin/sh
pkill dockerd
RESTART

# And for the injected failure: kill the daemon and hold the supervisor back, so
# the CLI's poll genuinely times out.
cat > "${work}/restart-that-fails.sh" <<'FAILRESTART'
#!/bin/sh
touch /work/pause
pkill dockerd
FAILRESTART

chmod +x "${work}/supervise.sh" "${work}/restart.sh" "${work}/restart-that-fails.sh"

# ---------------------------------------------------------------- sandbox
say "starting the sandbox"
docker rm -f "$DIND_NAME" >/dev/null 2>&1
# The container waits for its own supervisor to arrive. That is what lets the
# files be copied in rather than mounted.
docker run -d --privileged --name "$DIND_NAME" \
    -e DOCKER_TLS_CERTDIR= \
    --entrypoint sh \
    "$DIND_IMAGE" -c 'while [ ! -f /staging/supervise.sh ]; do sleep 1; done; mkdir -p /work; cp -a /staging/. /work/; exec sh /work/supervise.sh' >/dev/null || {
    echo "could not start the sandbox" >&2
    exit 1
}

# The directory itself, not its contents: the `src/.` idiom is normalised away
# by Git Bash before docker ever sees it, which quietly nests everything one
# level deeper. The container copies the staged files into place instead.
docker cp "$work" "${DIND_NAME}:/staging" || {
    echo "could not copy the harness files into the sandbox" >&2
    exit 1
}

attempt=0
while [ "$attempt" -lt 40 ]; do
    inside 'docker info --format "{{.ServerVersion}}"' >/dev/null 2>&1 && break
    attempt=$((attempt + 1))
    sleep 1
done
inside 'docker info --format "{{.ServerVersion}}"' >/dev/null 2>&1 || {
    echo "the sandbox daemon never started" >&2
    docker logs "$DIND_NAME" 2>&1 | tail -20 >&2
    exit 1
}

say "installing the CLI and loading the images into the sandbox"
inside 'apk add --no-cache nodejs npm >/dev/null 2>&1' || exit 1
inside "npm install -g --silent /work/${cli_tarball} >/dev/null 2>&1" || {
    echo "could not install the CLI inside the sandbox" >&2
    exit 1
}
inside 'docker load -i /work/images.tar >/dev/null' || exit 1
# The Compose template pins the published name deliberately, so the locally built
# image is tagged as that rather than the template being made configurable.
inside 'docker tag runestone-dns:harness cymondez/runestone-dns:1.0' || exit 1

say "preparing a project inside the sandbox"
inside 'docker network create rs-network >/dev/null 2>&1; docker volume create rs-ssh >/dev/null 2>&1; true'
inside 'mkdir -p /root/.runestone/certs && touch /root/.runestone/certs/dind.test.crt'
gateway=$(inside "ip -4 addr show docker0 | sed -n 's/.*inet \\([0-9.]*\\).*/\\1/p' | head -1" | tr -d '\r')
say "  sandbox docker0 gateway: ${gateway}"

inside "cat > /root/.runestone/.env <<EOF
HOST_DOMAIN=dind.test
PREFIX=rs
RUNESTONE_IMAGE=runestone-dns-probe
RUNESTONE_TAG=harness
DNS_BIND_IP=${gateway}
EOF"

say ""
say "the full cycle"

runestone() {
    inside "cd /root/.runestone && RUNESTONE_LANG=en RUNESTONE_DNS_RESTART_CMD=$1 ${2:-} runestone $3 2>&1"
}

before=$(inside 'cat /etc/docker/daemon.json 2>/dev/null || echo "(absent)"')
expect_equal "the sandbox starts with no daemon configuration" "(absent)" "$(printf '%s' "$before" | tr -d '\r')"

enable_output=$(runestone /work/restart.sh '' 'dns enable --yes')
expect_contains "enable resolves the Target IP from inside the sandbox" "$enable_output" "Target IP: ${gateway}"
expect_contains "enable reports DNS as active" "$enable_output" "DNS is active"

resolv=$(inside 'docker run --rm runestone-dns-probe:harness cat /etc/resolv.conf')
expect_contains "a new container is given our address first" "$(printf '%s' "$resolv" | grep nameserver | head -1)" "$gateway"

wildcard=$(inside "docker run --rm runestone-dns-probe:harness dig +short deep.sub.dind.test A" | tr -d '\r' | head -1)
expect_equal "a wildcard subdomain resolves to the Target IP" "$gateway" "$wildcard"

status=$(inside 'cd /root/.runestone && RUNESTONE_LANG=en runestone dns status 2>&1')
expect_contains "status reports the record as applied" "$status" "Written and applied"

say ""
say "restart: unless-stopped brings dnsmasq back with no CLI involvement (spec 8.2)"
inside '/work/restart.sh' >/dev/null 2>&1
attempt=0
while [ "$attempt" -lt 40 ]; do
    inside 'docker info --format "{{.ServerVersion}}"' >/dev/null 2>&1 && break
    attempt=$((attempt + 1))
    sleep 1
done
sleep 3
dns_state=$(inside 'docker inspect -f "{{.State.Status}}" rs-dns 2>/dev/null' | tr -d '\r')
expect_equal "the dns container is running again after a bare daemon restart" "running" "$dns_state"
after_restart=$(inside "docker run --rm runestone-dns-probe:harness dig +short api.dind.test A" | tr -d '\r' | head -1)
expect_equal "and it answers, with no CLI command having run" "$gateway" "$after_restart"

say ""
say "the injected restart failure rolls back (M6a gate)"
inside 'cd /root/.runestone && RUNESTONE_LANG=en runestone dns disable --yes >/dev/null 2>&1'
before_failed=$(inside 'cat /etc/docker/daemon.json 2>/dev/null || echo "(absent)"')
failed_output=$(runestone /work/restart-that-fails.sh 'RUNESTONE_DNS_RESTART_TIMEOUT_MS=6000' 'dns enable --yes')
inside 'rm -f /work/pause'
attempt=0
while [ "$attempt" -lt 40 ]; do
    inside 'docker info --format "{{.ServerVersion}}"' >/dev/null 2>&1 && break
    attempt=$((attempt + 1))
    sleep 1
done

expect_contains "a restart that never comes back is reported, not assumed away" "$failed_output" "Docker did not come back"
after_failed=$(inside 'cat /etc/docker/daemon.json 2>/dev/null || echo "(absent)"')
expect_equal "the daemon file is restored rather than half-applied" \
    "$(printf '%s' "$before_failed" | tr -d '\r')" "$(printf '%s' "$after_failed" | tr -d '\r')"

say ""
say "disable restores the file"
inside 'cd /root/.runestone && RUNESTONE_LANG=en runestone dns enable --yes --no-restart >/dev/null 2>&1'
inside 'cd /root/.runestone && RUNESTONE_LANG=en runestone dns disable --yes >/dev/null 2>&1'
final=$(inside 'cat /etc/docker/daemon.json 2>/dev/null || echo "(absent)"')
expect_equal "back to where the sandbox started" "(absent)" "$(printf '%s' "$final" | tr -d '\r')"

say ""
say "the host"
host_daemon_after="(absent)"
[ -f "$host_daemon" ] && host_daemon_after=$(cat "$host_daemon")
expect_equal "the host daemon configuration is untouched" "$host_daemon_before" "$host_daemon_after"

host_containers_after=$(docker ps -aq | sort | tr '\n' ' ')
expect_equal "no host container appeared or disappeared, apart from the sandbox" \
    "$(printf '%s %s' "$host_containers_before" "$(docker inspect -f '{{.Id}}' "$DIND_NAME" 2>/dev/null | cut -c1-12)" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ')" \
    "$host_containers_after"

say ""
say "----------------------------------------"
say "passed ${passed}, failed ${failures}"
[ "$failures" -eq 0 ] || exit 1
