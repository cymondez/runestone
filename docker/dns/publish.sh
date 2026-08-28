#!/bin/sh
# Builds and publishes the runestone-dns image.
#
# This is the interim publish path of spec 15.2: a maintainer runs it by hand.
# CI is the intended destination and is deferred, not abandoned — so this script
# does the one thing a hand-run publish otherwise loses, and stamps the commit it
# was built from into the image. Without that, a published tag has no traceable
# origin at all.
set -eu

IMAGE=${RUNESTONE_DNS_IMAGE:-cymondez/runestone-dns}
PLATFORMS=${RUNESTONE_DNS_PLATFORMS:-linux/amd64,linux/arm64}
SOURCE_URL=${RUNESTONE_DNS_SOURCE:-https://github.com/cymondez/runestone}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
assume_yes=0

usage() {
    cat >&2 <<EOF
Usage: $0 <tag> [--yes]

Builds ${IMAGE} for ${PLATFORMS} and pushes it.

A tag is required and is never defaulted: 'latest' as a default is how an
unfinished image reaches everyone's next docker pull.

Environment:
  RUNESTONE_DNS_IMAGE      image name (default ${IMAGE})
  RUNESTONE_DNS_PLATFORMS  platforms (default ${PLATFORMS})
  RUNESTONE_DNS_ALLOW_DIRTY=1
                           publish from a dirty working tree; the recorded
                           revision is then marked -dirty
EOF
}

fail() {
    echo "runestone-dns publish: $*" >&2
    exit 1
}

tag=""
for argument in "$@"; do
    case "$argument" in
        --yes|-y) assume_yes=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) fail "unknown option '$argument'" ;;
        *)
            [ -z "$tag" ] || fail "give exactly one tag"
            tag=$argument
            ;;
    esac
done

[ -n "$tag" ] || { usage; exit 2; }

case "$tag" in
    latest) fail "refusing to publish 'latest' explicitly; publish a version tag and move 'latest' deliberately if you want one" ;;
    *[!A-Za-z0-9._-]*) fail "invalid tag '$tag'" ;;
esac

command -v docker >/dev/null 2>&1 || fail "docker is not on PATH"
docker buildx version >/dev/null 2>&1 || fail "docker buildx is not available"

revision=$(git -C "$script_dir" rev-parse HEAD 2>/dev/null || echo unknown)
if [ -n "$(git -C "$script_dir" status --porcelain 2>/dev/null || true)" ]; then
    if [ "${RUNESTONE_DNS_ALLOW_DIRTY:-0}" = "1" ]; then
        revision="${revision}-dirty"
        echo "runestone-dns publish: working tree is dirty; recording revision as ${revision}" >&2
    else
        fail "working tree is dirty. A published image whose source cannot be checked out is untraceable. Commit first, or set RUNESTONE_DNS_ALLOW_DIRTY=1 to accept a -dirty revision."
    fi
fi

# The docker driver can only emit a platform the builder actually supports. Say
# which one is missing and how to get it, rather than letting buildx fail deep
# inside the build.
available=$(docker buildx inspect 2>/dev/null | sed -n 's/^Platforms:[[:space:]]*//p' | tr -d ' ' || true)
missing=""
old_ifs=$IFS
IFS=','
for platform in $PLATFORMS; do
    case ",${available}," in
        *",${platform},"*) ;;
        *) missing="${missing} ${platform}" ;;
    esac
done
IFS=$old_ifs

if [ -n "$missing" ]; then
    cat >&2 <<EOF
runestone-dns publish: this builder cannot produce:${missing}

  builder: $(docker buildx inspect 2>/dev/null | sed -n 's/^Name:[[:space:]]*//p' | head -1)
  supports: ${available:-unknown}

Register QEMU emulation for the missing platforms:

  docker run --privileged --rm tonistiigi/binfmt --install arm64

That changes state outside this repository, so it is not done for you. It
registers the emulators in the kernel your Docker daemon runs on, and
\`--uninstall\` reverses it.

A \`docker-container\` builder is **not** an alternative on its own: measured on
Docker Desktop for Windows, a freshly bootstrapped one reported only
linux/amd64 and linux/386 until binfmt was registered. It helps when the
limitation is the docker driver, not when the emulators are missing.
EOF
    exit 1
fi

cat <<EOF
runestone-dns publish
  image      ${IMAGE}:${tag}
  platforms  ${PLATFORMS}
  revision   ${revision}
  context    ${script_dir}

This pushes to a public registry. A published tag is not something you can
quietly take back.
EOF

if [ "$assume_yes" -ne 1 ]; then
    if [ -t 0 ]; then
        printf 'Publish? [y/N] '
        read -r answer
        case "$answer" in
            y|Y|yes|YES) ;;
            *) echo "aborted"; exit 1 ;;
        esac
    else
        fail "not a terminal: pass --yes to publish non-interactively"
    fi
fi

exec docker buildx build \
    --platform "$PLATFORMS" \
    --tag "${IMAGE}:${tag}" \
    --label "org.opencontainers.image.source=${SOURCE_URL}" \
    --label "org.opencontainers.image.revision=${revision}" \
    --label "org.opencontainers.image.version=${tag}" \
    --push \
    "$script_dir"
