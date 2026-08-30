#!/bin/sh
# Image verification for runestone-dns (spec 14.4).
#
# Two constraints shape this script:
#
#  * **It never uses port 53.** The image is published on 15353 instead, so
#    running these checks cannot fight the host for the real DNS port. That is
#    M2's gate: the milestone that builds the image must not be the milestone
#    that first contends for 53.
#  * **It uses no host paths.** The fixture /ssl directory is a Docker volume
#    populated by a helper container, so the script behaves the same from Git
#    Bash on Windows as from a Linux shell, with no bind-mount path translation.
#
# One Git Bash trap worth knowing: an absolute path passed as its own argument is
# rewritten by MSYS, so `docker exec c cat /etc/dnsmasq.conf` reads
# `C:/Program Files/Git/etc/dnsmasq.conf` instead. Every container-side path here
# therefore lives inside `sh -c '...'`, where no rewriting happens.
set -u

IMAGE=${RUNESTONE_DNS_IMAGE:-runestone-dns:verify}
BUILD=${RUNESTONE_DNS_BUILD:-1}
HOST_PORT=${RUNESTONE_DNS_HOST_PORT:-15353}
TARGET_IP=${RUNESTONE_DNS_TARGET_IP:-9.8.7.6}

PREFIX=runestone-dns-verify
NETWORK=${PREFIX}-net
VOLUME=${PREFIX}-ssl
SERVER=${PREFIX}-server
CLIENT_IMAGE=${PREFIX}-client:local

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image_dir=$(dirname -- "$script_dir")

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
expect_absent() {
    case "$2" in
        *"$3"*) bad "$1" "[$3] should not be present" ;;
        *) ok "$1" ;;
    esac
}

cleanup() {
    docker rm -f "$SERVER" >/dev/null 2>&1
    docker network rm "$NETWORK" >/dev/null 2>&1
    docker volume rm "$VOLUME" >/dev/null 2>&1
    return 0
}
trap cleanup EXIT INT TERM

# The zones the entrypoint must produce from the fixture certificates (spec 8.3).
# `a.test` and `b.test` come from wrong-name.crt, whose filename is not a domain
# at all: they are the case that proves the names are read from the certificate.
FIXTURE_MAPPED='local.test api.example.test a.test b.test'

# The fixture certificates, as `filename subjectAltName` pairs. Empty files would
# now test nothing — the entrypoint reads the names out of the certificate, so a
# file it cannot parse is skipped rather than falling back to its name.
FIXTURE_CERTS='
local.test.crt DNS:*.local.test
api.example.test.crt DNS:*.api.example.test
wrong-name.crt DNS:*.a.test,DNS:b.test
nodot.crt DNS:nodot
bad-.test.crt DNS:bad-.test
rootCA.crt DNS:*.rootca.test
'

# Files that are not certificates the entrypoint should look at.
FIXTURE_PLAIN='local.test.key notes.txt empty.crt'

server_dns_query() {
    # $1 domain, $2 extra dig flags
    docker run --rm --network "$NETWORK" "$CLIENT_IMAGE" \
        dig +short +time=3 +tries=1 ${2:-} "@${SERVER}" "$1" A 2>/dev/null
}

say "runestone-dns image verification"
say "  image      ${IMAGE}"
say "  host port  ${HOST_PORT} (never 53)"
say ""

if [ "$BUILD" = "1" ]; then
    say "building ${IMAGE} for the local architecture"
    if ! docker build -q -t "$IMAGE" "$image_dir" >/dev/null; then
        echo "build failed" >&2
        exit 1
    fi
fi

say "preparing the query client"
if ! docker image inspect "$CLIENT_IMAGE" >/dev/null 2>&1; then
    printf 'FROM alpine:3.22\nRUN apk add --no-cache bind-tools curl\n' |
        docker build -q -t "$CLIENT_IMAGE" - >/dev/null || {
        echo "could not build the query client" >&2
        exit 1
    }
fi

cleanup
docker network create "$NETWORK" >/dev/null || exit 1
docker volume create "$VOLUME" >/dev/null || exit 1

say "populating the fixture /ssl volume"
# Generated with the image's own openssl, so the fixture needs no host tooling
# and stays inside the volume, like everything else here.
docker run --rm -v "${VOLUME}:/ssl" --entrypoint sh "$IMAGE" -c "
set -eu
cd /ssl
touch ${FIXTURE_PLAIN}
printf '%s\n' '${FIXTURE_CERTS}' | while read -r file sans; do
    [ -n \"\$file\" ] || continue
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
        -subj '/CN=fixture' -addext \"subjectAltName=\$sans\" \
        -keyout /tmp/fixture.key -out \"\$file\" >/dev/null 2>&1
done
rm -f /tmp/fixture.key
" >/dev/null || exit 1

say ""
say "webproc flags pinned by the entrypoint (spec 8.1)"
webproc_help=$(docker run --rm --entrypoint webproc "$IMAGE" --help 2>&1)
for flag in --configuration-file --port --user --pass --restart-watch; do
    expect_contains "webproc 0.4.0 accepts ${flag}" "$webproc_help" "$flag"
done
expect_contains "webproc is the pinned version" "$webproc_help" "0.4.0"

say ""
say "generated configuration"
generated=$(docker run --rm -v "${VOLUME}:/ssl:ro" \
    -e DNS_HOST_IP="$TARGET_IP" -e DNS_UPSTREAM="1.1.1.1, 8.8.8.8" \
    "$IMAGE" sh -c 'cat /etc/dnsmasq.d/managed.conf; echo "--8<--"; cat /etc/dnsmasq.conf' 2>/dev/null)
managed=$(printf '%s' "$generated" | sed -n '1,/^--8<--$/p')
dnsmasq_conf=$(printf '%s' "$generated" | sed -n '/^--8<--$/,$p')

# The entrypoint reports skipped filenames on stdout, which is captured here as
# well, so the exclusion checks look at the emitted rules only.
rules=$(printf '%s' "$managed" | grep '^address=/')

for domain in $FIXTURE_MAPPED; do
    expect_contains "maps ${domain}" "$rules" "address=/${domain}/${TARGET_IP}"
done
expect_absent "excludes rootCA.crt by filename even though it carries names" "$rules" "rootca"
expect_absent "excludes a single-label name" "$rules" "nodot"
expect_absent "excludes a name with an invalid label" "$rules" "bad-"
expect_absent "ignores .key and other files" "$rules" "notes"
# The names are the certificate's, so the file this pair came from must appear
# nowhere in the output: `wrong-name` is not a domain and never becomes one.
expect_absent "never maps the filename itself" "$rules" "wrong-name"
expect_absent "skips a file it cannot parse rather than using its name" "$rules" "empty"
expect_equal "one address= line per mapped name" "4" \
    "$(printf '%s' "$rules" | grep -c '^address=/' | tr -d ' ')"
expect_contains "says which names it skipped" "$managed" "not a valid domain name"
expect_contains "says which files carried no names" "$managed" "no DNS names could be read"
expect_contains "lists each mapping it wrote" "$managed" "mapping local.test -> ${TARGET_IP}"

expect_contains "forwards only to the given upstreams" "$dnsmasq_conf" "no-resolv"
expect_contains "first upstream" "$dnsmasq_conf" "server=1.1.1.1"
expect_contains "second upstream, whitespace trimmed" "$dnsmasq_conf" "server=8.8.8.8"
expect_contains "includes the managed rules" "$dnsmasq_conf" "conf-file=/etc/dnsmasq.d/managed.conf"
expect_contains "includes the user rules" "$dnsmasq_conf" "conf-file=/etc/dnsmasq.d/custom.conf"

say ""
say "refuses to start without the address it is meant to answer with"
if docker run --rm "$IMAGE" true >/dev/null 2>&1; then
    bad "no DNS_HOST_IP is refused" "the container started anyway"
else
    ok "no DNS_HOST_IP is refused"
fi

say ""
say "starts cleanly with an empty /ssl"
empty_volume=${PREFIX}-empty
docker volume rm "$empty_volume" >/dev/null 2>&1
docker volume create "$empty_volume" >/dev/null
if docker run --rm -v "${empty_volume}:/ssl:ro" -e DNS_HOST_IP="$TARGET_IP" \
    "$IMAGE" sh -c 'grep -c "^address=/" /etc/dnsmasq.d/managed.conf || true' >/dev/null 2>&1; then
    ok "an empty /ssl still produces a startable configuration"
else
    bad "an empty /ssl still produces a startable configuration"
fi
docker volume rm "$empty_volume" >/dev/null 2>&1

say ""
say "running service"
docker run -d --name "$SERVER" --network "$NETWORK" \
    -v "${VOLUME}:/ssl:ro" \
    -p "127.0.0.1:${HOST_PORT}:53/udp" \
    -p "127.0.0.1:${HOST_PORT}:53/tcp" \
    -e DNS_HOST_IP="$TARGET_IP" \
    -e DNS_UPSTREAM=1.1.1.1 \
    -e HTTP_USER=runestone \
    -e HTTP_PASS=verify \
    "$IMAGE" >/dev/null || exit 1

# dnsmasq answers as soon as it has read its configuration; poll rather than sleep.
attempt=0
while [ "$attempt" -lt 20 ]; do
    [ -n "$(server_dns_query local.test)" ] && break
    attempt=$((attempt + 1))
done

expect_equal "answers a managed domain over udp" "$TARGET_IP" "$(server_dns_query local.test)"
expect_equal "answers over tcp as well" "$TARGET_IP" "$(server_dns_query local.test '+tcp')"
expect_equal "answers a wildcard subdomain" "$TARGET_IP" "$(server_dns_query deep.sub.api.example.test)"
expect_equal "does not answer an unmapped domain with the target IP" "" \
    "$(server_dns_query unmapped.invalid)"

published=$(docker port "$SERVER" 2>/dev/null)
expect_contains "publishes 53/udp on the test port" "$published" "53/udp"
expect_absent "never publishes on port 53 itself" "$published" ":53"

say ""
say "web UI authentication (spec 8.5)"
ui_status() {
    docker run --rm --network "$NETWORK" "$CLIENT_IMAGE" \
        curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" "http://${SERVER}:8080/" 2>/dev/null
}
expect_equal "requires authentication when HTTP_USER and HTTP_PASS are set" "401" "$(ui_status)"
expect_equal "accepts the configured credentials" "200" "$(ui_status -u runestone:verify)"

say ""
say "tamper resistance (spec 14.4)"
docker exec "$SERVER" sh -c 'echo "# tampered" >> /etc/dnsmasq.conf' >/dev/null 2>&1
docker exec "$SERVER" sh -c 'echo "address=/tampered.test/1.2.3.4" >> /etc/dnsmasq.d/managed.conf' >/dev/null 2>&1
docker exec "$SERVER" sh -c 'echo "# mine, keep me" >> /etc/dnsmasq.d/custom.conf' >/dev/null 2>&1
docker restart "$SERVER" >/dev/null 2>&1

attempt=0
while [ "$attempt" -lt 20 ]; do
    [ -n "$(server_dns_query local.test)" ] && break
    attempt=$((attempt + 1))
done

after_restart=$(docker exec "$SERVER" sh -c 'cat /etc/dnsmasq.conf /etc/dnsmasq.d/managed.conf' 2>/dev/null)
custom_after=$(docker exec "$SERVER" sh -c 'cat /etc/dnsmasq.d/custom.conf' 2>/dev/null)
expect_absent "restarting restores the two files Runestone owns" "$after_restart" "tampered"
expect_contains "and leaves custom.conf completely alone" "$custom_after" "# mine, keep me"
expect_equal "the service answers again after the restart" "$TARGET_IP" "$(server_dns_query local.test)"

say ""
say "----------------------------------------"
say "passed ${passed}, failed ${failures}"
[ "$failures" -eq 0 ] || exit 1
