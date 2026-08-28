#!/bin/sh
# The safety net for M6b, the one milestone that deliberately interrupts a
# working machine (spec 16.5).
#
# M6b writes the real Docker daemon configuration and restarts Docker, which
# terminates every container on the machine. Everything Runestone itself does is
# already reversible — `dns disable` removes exactly what it recorded, and
# `completeEnable` inverts its own write when the restart or the verification
# fails. This script is the layer *below* that: what to run when the reversal
# itself did not work, or when the machine was left in a state nobody planned.
#
# It restores whole files. That is precisely what spec 9.3 forbids **Runestone**
# from doing, and the difference is not a loophole:
#
#   - Runestone must never restore the whole daemon file, because a user's
#     unrelated edits may have arrived between the write and the revocation, and
#     discarding them would be a worse failure than the one being fixed.
#   - This is a human's snapshot, taken minutes earlier, for an interruption that
#     was deliberately scheduled. Nothing else was supposed to be editing that
#     file in between, and if something was, `status` says so before `restore`
#     touches anything.
#
# **Nothing in the CLI ever invokes this.** It is run by hand, by the person who
# scheduled the window, and it lives beside the other DNS test scripts because
# M6b has to be repeatable on machines that are not this one.
#
# Usage:
#   m6b-safety-net.sh capture    take the snapshot; run before anything else
#   m6b-safety-net.sh status     compare the machine with the snapshot
#   m6b-safety-net.sh restore    put the daemon file back, restart Docker, start
#                                whatever was running before and is not now
#   m6b-safety-net.sh clean      delete the snapshot, once M6b is finished
set -u

STORE=${RUNESTONE_M6B_STORE:-"${HOME}/.runestone-m6b-safety"}
DAEMON=${RUNESTONE_DNS_DAEMON_PATH:-"${HOME}/.docker/daemon.json"}
TOOL_STATE=${RUNESTONE_TOOL_STATE_PATH:-"${HOME}/.runestone/runestone.config.json"}
RESTART_TIMEOUT=${RUNESTONE_M6B_RESTART_TIMEOUT:-180}

say() { echo "$*"; }
warn() { echo "  !! $*" >&2; }
fail() {
    echo "$*" >&2
    exit 1
}

hash_of() {
    if [ -f "$1" ]; then
        sha256sum "$1" | cut -d' ' -f1
    else
        echo "<absent>"
    fi
}

require_capture() {
    [ -f "${STORE}/manifest" ] || fail "No snapshot in ${STORE}. Run: $0 capture"
    # A snapshot that is missing one of its parts is worse than no snapshot,
    # because it invites a restore that only half works.
    for part in manifest containers daemon.hash; do
        [ -f "${STORE}/${part}" ] || fail "Snapshot in ${STORE} is incomplete (${part} missing). Take a new one."
    done
}

docker_answers() {
    docker info >/dev/null 2>&1
}

# The daemon file this machine's Docker actually reads, ignoring any override.
# Mirrors platformDaemonPath() in services/dns/daemon-target.ts (spec 6.2).
platform_daemon_path() {
    case "$(uname -s)" in
        Linux)
            # A Linux userland whose docker is Docker Desktop's reads the Windows
            # or macOS side's file, which is not ours to restore either.
            if docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -qi 'docker desktop'; then
                echo "<docker-desktop-elsewhere>"
            else
                echo "/etc/docker/daemon.json"
            fi
            ;;
        *) echo "${HOME}/.docker/daemon.json" ;;
    esac
}

wait_for_docker() {
    waited=0
    while [ "$waited" -lt "$RESTART_TIMEOUT" ]; do
        if docker_answers; then
            say "  Docker answered again after ${waited}s."
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    warn "Docker did not answer within ${RESTART_TIMEOUT}s. Check Docker Desktop, then run: $0 status"
    return 1
}

cmd_capture() {
    docker_answers || fail "Docker is not answering. Take the snapshot while the machine is healthy."

    mkdir -p "$STORE" || fail "Could not create ${STORE}"

    if [ -f "$DAEMON" ]; then
        cp "$DAEMON" "${STORE}/daemon.json" || fail "Could not copy ${DAEMON}"
        echo "present" > "${STORE}/daemon.existed"
    else
        rm -f "${STORE}/daemon.json"
        # Absence is a state worth recording: `createdDaemonFile=true` is its own
        # revocation path (spec 9.2), and restoring it means deleting the file.
        echo "absent" > "${STORE}/daemon.existed"
    fi
    hash_of "$DAEMON" > "${STORE}/daemon.hash"

    if [ -f "$TOOL_STATE" ]; then
        cp "$TOOL_STATE" "${STORE}/runestone.config.json"
        echo "present" > "${STORE}/tool_state.existed"
    else
        rm -f "${STORE}/runestone.config.json"
        echo "absent" > "${STORE}/tool_state.existed"
    fi

    # Name and restart policy per running container. The policy is what decides
    # whether a container comes back by itself after the daemon restarts, so it
    # is the difference between "wait" and "go and start it".
    docker ps --format '{{.Names}}' | while read -r name; do
        policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null)
        printf '%s\t%s\n' "$name" "${policy:-no}"
    done | sort > "${STORE}/containers"

    docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' | sort > "${STORE}/containers.all"

    {
        echo "daemon_path=${DAEMON}"
        echo "tool_state_path=${TOOL_STATE}"
        echo "store=${STORE}"
    } > "${STORE}/manifest"

    running=$(wc -l < "${STORE}/containers" | tr -d ' ')
    no_policy=$(awk -F'\t' '$2 == "no" || $2 == "" { count++ } END { print count + 0 }' "${STORE}/containers")

    say "Snapshot taken in ${STORE}"
    say "  daemon    ${DAEMON} ($(cat "${STORE}/daemon.hash"))"
    say "  state     ${TOOL_STATE} ($(cat "${STORE}/tool_state.existed"))"
    say "  running   ${running} container(s), ${no_policy} of which will NOT come back on their own"
    if [ "$no_policy" -gt 0 ]; then
        say ""
        say "  These have no restart policy, so a Docker restart stops them for good until"
        say "  something starts them again. \`$0 restore\` will:"
        awk -F'\t' '$2 == "no" || $2 == "" { print "    - " $1 }' "${STORE}/containers"
    fi
}

cmd_status() {
    require_capture

    drift=0
    current=$(hash_of "$DAEMON")
    captured=$(cat "${STORE}/daemon.hash")

    say "Daemon configuration"
    say "  path      ${DAEMON}"
    say "  captured  ${captured}"
    say "  now       ${current}"
    if [ "$current" = "$captured" ]; then
        say "  -> unchanged"
    else
        drift=1
        say "  -> CHANGED"
        if [ -f "${STORE}/daemon.json" ] && [ -f "$DAEMON" ]; then
            diff -u "${STORE}/daemon.json" "$DAEMON" | sed 's/^/     /'
        fi
    fi

    say ""
    say "Containers"
    if ! docker_answers; then
        warn "Docker is not answering, so the container state cannot be compared."
        return 1
    fi

    docker ps --format '{{.Names}}' | sort > "${STORE}/.now"
    missing=$(cut -f1 "${STORE}/containers" | sort | comm -23 - "${STORE}/.now")
    extra=$(cut -f1 "${STORE}/containers" | sort | comm -13 - "${STORE}/.now")
    rm -f "${STORE}/.now"

    if [ -z "$missing" ]; then
        say "  every container that was running is running"
    else
        drift=1
        say "  NOT running, but was when the snapshot was taken:"
        echo "$missing" | sed 's/^/    - /'
    fi

    if [ -n "$extra" ]; then
        say "  running now, but was not in the snapshot (left alone by restore):"
        echo "$extra" | sed 's/^/    + /'
    fi

    say ""
    if [ "$drift" -eq 0 ]; then
        say "The machine matches the snapshot."
    else
        say "The machine has drifted. \`$0 restore\` puts it back."
    fi
    return 0
}

cmd_restore() {
    require_capture

    restarted=0
    current=$(hash_of "$DAEMON")
    captured=$(cat "${STORE}/daemon.hash")

    if [ "$current" = "$captured" ]; then
        say "Daemon configuration already matches the snapshot; leaving it alone."
    else
        say "Restoring ${DAEMON}"
        say "  from ${current}"
        say "  to   ${captured}"

        # Show what is being discarded before discarding it. If someone edited
        # this file for an unrelated reason during the window, this is the last
        # moment anyone can notice.
        if [ -f "${STORE}/daemon.json" ] && [ -f "$DAEMON" ]; then
            say "  the change being reverted:"
            diff -u "${STORE}/daemon.json" "$DAEMON" | sed 's/^/    /'
        fi

        if [ "$(cat "${STORE}/daemon.existed")" = "absent" ]; then
            rm -f "$DAEMON" || fail "Could not remove ${DAEMON}"
            say "  removed it, because it did not exist when the snapshot was taken"
        else
            mkdir -p "$(dirname "$DAEMON")"
            cp "${STORE}/daemon.json" "$DAEMON" || fail "Could not write ${DAEMON}"
        fi

        after=$(hash_of "$DAEMON")
        [ "$after" = "$captured" ] || fail "Restore did not take: ${DAEMON} is now ${after}, expected ${captured}"
        say "  restored and verified"

        # A daemon file only means something once Docker has read it again — but
        # only when it is the file Docker actually reads. Pointed at a test file
        # through RUNESTONE_DNS_DAEMON_PATH, restoring it has nothing to do with
        # the running daemon, and restarting would terminate every container on
        # the machine for no reason at all. This guard is here because the script
        # did exactly that once, while being tested against a temporary file.
        if [ "$DAEMON" != "$(platform_daemon_path)" ]; then
            say "Not restarting Docker: ${DAEMON} is not the file this daemon reads."
        elif [ "${RUNESTONE_M6B_NO_RESTART:-0}" = "1" ]; then
            say "Not restarting Docker: RUNESTONE_M6B_NO_RESTART=1. The file is correct; it takes effect at the next restart."
        else
            say "Restarting Docker so it reads the restored file"
            if docker desktop restart >/dev/null 2>&1; then
                restarted=1
            elif sudo systemctl restart docker >/dev/null 2>&1; then
                restarted=1
            else
                warn "Could not restart Docker automatically. Restart it by hand; the file is already correct."
            fi

            [ "$restarted" -eq 1 ] && wait_for_docker
        fi
    fi

    if [ -f "${STORE}/runestone.config.json" ]; then
        if ! cmp -s "${STORE}/runestone.config.json" "$TOOL_STATE" 2>/dev/null; then
            mkdir -p "$(dirname "$TOOL_STATE")"
            cp "${STORE}/runestone.config.json" "$TOOL_STATE"
            say "Restored ${TOOL_STATE}"
        fi
    elif [ "$(cat "${STORE}/tool_state.existed")" = "absent" ] && [ -f "$TOOL_STATE" ]; then
        rm -f "$TOOL_STATE"
        say "Removed ${TOOL_STATE}, which did not exist when the snapshot was taken"
    fi

    if ! docker_answers; then
        warn "Docker is not answering, so containers cannot be started. Fix Docker, then run: $0 restore"
        return 1
    fi

    docker ps --format '{{.Names}}' | sort > "${STORE}/.now"
    missing=$(cut -f1 "${STORE}/containers" | sort | comm -23 - "${STORE}/.now")
    rm -f "${STORE}/.now"

    if [ -z "$missing" ]; then
        say "Every container that was running is running."
    else
        say "Starting containers that have not come back:"
        echo "$missing" | while read -r name; do
            [ -n "$name" ] || continue
            if docker start "$name" >/dev/null 2>&1; then
                say "  started ${name}"
            else
                warn "could not start ${name} — it may have been removed rather than stopped"
            fi
        done
    fi

    say ""
    say "Restore finished. Confirm with: $0 status"
}

cmd_clean() {
    [ -d "$STORE" ] || fail "Nothing to clean: ${STORE} does not exist"
    rm -rf "$STORE"
    say "Removed ${STORE}"
}

case "${1:-}" in
    capture) cmd_capture ;;
    status) cmd_status ;;
    restore) cmd_restore ;;
    clean) cmd_clean ;;
    *)
        cat >&2 <<USAGE
Usage: $0 {capture|status|restore|clean}

  capture   snapshot the daemon configuration, the Runestone tool state and the
            running containers. Run this before M6b touches anything.
  status    compare the machine with the snapshot and print what drifted.
  restore   put the daemon file back, restart Docker so it is read, and start
            whatever was running before and is not now.
  clean     delete the snapshot once M6b is finished.

Environment:
  RUNESTONE_M6B_STORE             where the snapshot lives (default ~/.runestone-m6b-safety)
  RUNESTONE_DNS_DAEMON_PATH       the daemon file to protect (default ~/.docker/daemon.json)
  RUNESTONE_TOOL_STATE_PATH       the Runestone state file (default ~/.runestone/runestone.config.json)
  RUNESTONE_M6B_RESTART_TIMEOUT   seconds to wait for Docker after a restart (default 180)
USAGE
        exit 2
        ;;
esac
