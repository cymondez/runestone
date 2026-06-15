# Implementation Inspection

## Accepted

- `package.json` exposes `runestone` as a global bin and requires Node 18+.
- `src/cli.ts` wires all required commands through Commander.
- `src/commands/setup.ts` imports `@clack/prompts` and writes project env/compose files.
- `src/commands/certs.ts` imports `@mkcert/node` and uses the JavaScript API.
- Docker lifecycle behavior is isolated in `src/services/*` and guarded by `src/utils/docker-checker.ts`.
- Tests include service/unit coverage, CLI shape coverage, DESIGNE contract coverage, and actual CLI process execution coverage.

## Fixed During Acceptance

- `ssh-manager.addKey` used shell redirection (`>`) inside the `docker run ... sh -c` payload. On Windows, the outer shell consumed it before Docker received the argument. Replaced it with `install -m ... /dev/stdin target`.
- `sshManager.listKeys` used `2>/dev/null || true`, which had the same Windows outer-shell interception risk. Replaced it with a clean `find ... -not -name '*.pub' -printf ...` command.
- Live Docker acceptance showed `cymondez/runestone:latest` and `cymondez/runestone:5.2` are not resolvable. After the image was pushed as `cymondez/runstone:5.2`, updated CLI defaults and setup-generated env values to `RUNESTONE_IMAGE=cymondez/runstone` and `RUNESTONE_TAG=5.2`.

## Not Live-Tested

- Real Docker daemon startup/teardown was not run.
- Real `mkcert.install()` / local CA installation was not run.
- `npm link` / global npm installation was not run because npm is not available on PATH in this shell and global linking is an external machine mutation.

## Acceptance Test Additions

- `tests/integration/design-acceptance.test.ts`: static and Commander-level DESIGNE contract checks.
- `tests/integration/execution.test.ts`: actual `node bin/runestone ...` process execution against a fake Docker executable in a temporary PATH.
