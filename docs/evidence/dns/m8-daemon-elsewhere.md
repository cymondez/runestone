# M8 evidence — the two rows whose daemon is not on this machine (14.3 rows 2 and 5)

*正體中文：[m8-daemon-elsewhere.zh-TW.md](m8-daemon-elsewhere.zh-TW.md)*

**Date.** 2026-08-30 · **CLI version.** 1.2.0 (`feat/dns-support`, including the SAN change from `d2dbaac`)

Two rows of the spec 6.2 decision table classify as `elsewhere`: row 2 (a WSL distribution using Docker Desktop's integration) and row 5 (the CLI on Windows/macOS with a plain Engine somewhere else). Both must **refuse** and point at the 7.4 overrides. This file records what they actually do.

M6b already covered row 1 (Windows + Docker Desktop) and row 4 (native Linux engine). The macOS half of row 1 and row 3 (Docker Desktop for Linux) remain uncovered; the reason is in the last section.

## First, tell the two environments apart — both are called Ubuntu 26.04

This is the easiest thing to confuse here, and the easiest way to produce evidence that is quietly about the wrong row.

| | Environment A | Environment B |
| --- | --- | --- |
| What it is | WSL2 distribution | Hyper-V virtual machine |
| How to enter | `wsl -d Ubuntu-26.04` | `ssh local-hyperv-ubuntu26.04` |
| Its own docker daemon | **none**, uses Docker Desktop's WSL integration | **yes**, native docker-ce 29.5.3 |
| `docker info` OperatingSystem | **`Docker Desktop`** | **`Ubuntu 26.04 LTS`** |
| `/etc/docker/daemon.json` | not applicable | absent |
| 14.3 row | **row 2** | row 4 (M6b used it) / **row 5** (pointed at from Windows) |

**One command tells them apart: `docker info --format '{{.OperatingSystem}}'`.** That is the same string the CLI reads to decide `isDockerDesktop`.

Environment B is behind Hyper-V NAT, so its address (`192.168.152.77` at the time) **changes across reboots**. Do not treat it as a stable identifier.

---

## Row 2 — WSL distribution with Docker Desktop integration

### All three detection inputs measured on the real machine

```
$ wsl -d Ubuntu-26.04
WSL_DISTRO_NAME                  Ubuntu-26.04
/run/WSL                         present
/proc/version contains microsoft yes
docker info OperatingSystem      Docker Desktop
docker context endpoint          unix:///var/run/docker.sock
```

`isWsl()` has three checks (`WSL_DISTRO_NAME`, `/run/WSL`, `/proc/version`), and **each one independently returns true**. The detection depends on no single signal — worth recording, because if a future WSL release drops one of them the other two still hold.

Into `classifyDaemonEnvironment()`: `daemonIsDockerDesktop=true`, `platform=linux`, `isWsl=true` → `elsewhere`. Row 2 of the table.

### The trap: Windows node and npm leak into the distribution through interop

**This is the most important part of this row.** The distribution had no Node, yet running `npm -v` inside it succeeds:

```
$ wsl -d Ubuntu-26.04 -- command -v npm
/mnt/c/nvm4w/nodejs/npm

$ wsl -d Ubuntu-26.04 -- dpkg-query -W nodejs
dpkg-query: no packages found matching nodejs
```

WSL appends the Windows PATH by default, so both `npm` (a bash script) and `node.exe` resolve. Anything run through them **looks completely normal and tests row 1**:

```
$ wsl -d Ubuntu-26.04 -- /mnt/c/nvm4w/nodejs/node.exe -e "console.log(process.platform, process.env.WSL_DISTRO_NAME, os.homedir())"
win32  (unset)  C:\Users\cymondez
```

`platform` is `win32`, so `isWsl()` short-circuits to false on its first check and the classification becomes `docker-desktop` — row 1. It would even write `C:\Users\cymondez\.docker\daemon.json`, which for that Windows process is the **correct** file. Nothing in the output tells you the test was wrong.

A second symptom: point that `node.exe` at the distribution's `/tmp/p.js` and it looks for `D:\tmp\p.js`. It cannot see the distribution's filesystem at all.

**So this row's evidence has to record which binary ran.** After installing the distribution's own Node:

```
$ wsl -d Ubuntu-26.04 -- command -v node
/usr/bin/node
$ wsl -d Ubuntu-26.04 -- /usr/bin/node -p "process.platform + ' ' + process.env.WSL_DISTRO_NAME"
linux Ubuntu-26.04
```

`linux` with `WSL_DISTRO_NAME` set — that is row 2's input condition.

### How it was installed: not from the mounted dist

The CLI was packed and installed into the distribution rather than run from `/mnt/d/.../dist/cli.js`:

```
$ npm pack                      # on the Windows side
$ wsl -d Ubuntu-26.04 -- /usr/bin/npm install -g --prefix ~/.local <tgz>
added 12 packages in 3s
```

Two reasons: `node_modules` installed on Windows carries platform-specific artifacts that need not load on Linux, and running a Linux `npm install` in that same directory would break the Windows-side development environment. `--prefix ~/.local` avoids `sudo`. The side effect is that this evidence exercises **what a user actually installs**.

### Actual output

```
$ /home/cymondez/.local/bin/runestone --version
1.2.0

$ /home/cymondez/.local/bin/runestone dns enable --dry-run
[info] Preflight
[error] Runestone is not set up yet. Run runestone setup first.
[error] This is a WSL distribution using Docker Desktop through the integration,
        and that daemon (Docker Desktop) keeps its configuration on the Windows
        side. Writing the ~/.docker/daemon.json on this filesystem would change a
        file Docker never reads. Run runestone on Windows instead, or set
        RUNESTONE_DNS_DAEMON_PATH to the file Docker Desktop actually uses.
[error] Could not read : No daemon configuration path is known for this Docker
        daemon. Set RUNESTONE_DNS_DAEMON_PATH to the file it reads.
```

**Pass.** The message is the WSL-specific one: it says the configuration lives on the Windows side, that writing this filesystem's `~/.docker/daemon.json` would do nothing, and gives two ways forward.

`setup-incomplete` appears alongside it (the distribution has no `~/.runestone`) and **does not short-circuit** the classification check — preflight collects failures and reports them together rather than stopping at the first.

---

## Row 5 — CLI on Windows, plain Engine somewhere else

### Probe values

From the Windows side with `DOCKER_HOST=ssh://local-hyperv-ubuntu26.04`:

```
docker info OSType               linux
docker info OperatingSystem      Ubuntu 26.04 LTS
docker context Name              default
docker context Endpoint          ssh://local-hyperv-ubuntu26.04
```

`isDockerDesktop=false`, `platform=win32` → `onLinux=false` → `elsewhere`. Row 5 of the table.

### The first measurement was wrong, because the safety override disabled the thing being measured

The first run set `RUNESTONE_DNS_DAEMON_PATH` as a safety net, showed only the remote-endpoint refusal, and led to the conclusion "the remote guard fires first, row 5 is never reached". **That conclusion was wrong.** The condition in `preflight` is:

```ts
} else if (target.host === 'elsewhere' && target.source !== 'override') {
```

With the override set, `source` is `override` and the branch is never evaluated. **The instrument hid the effect.** The override's behaviour is right in itself — once the user names the file to write, refusing on classification grounds would be wrong — but it made that run say nothing about row 5.

### Actual output (no override)

```
$ DOCKER_HOST=ssh://local-hyperv-ubuntu26.04 runestone dns enable --dry-run
[info] Preflight
[error] The daemon (Ubuntu 26.04 LTS) answers, but its configuration file lives on a filesystem this
        machine cannot name — an engine inside a VM or another distribution. There is no file here to
        write, and guessing one would report success while changing nothing. Set RUNESTONE_DNS_DAEMON_PATH
        to the file that daemon reads and RUNESTONE_DNS_RESTART_CMD to the command that restarts it.
[error] The current Docker context default points at ssh://local-hyperv-ubuntu26.04,
        which is not this machine. Runestone does not modify a remote daemon.
[error] Could not read : No daemon configuration path is known for this Docker
        daemon. Set RUNESTONE_DNS_DAEMON_PATH to the file it reads.
```

**Pass.** The first line is `docker-desktop-elsewhere`; it names the actual OperatingSystem and points at both 7.4 overrides. It is genuinely a **different message** from row 2's — row 2 says "on the Windows side", row 5 says "a VM or another distribution".

### This evidence is narrower than row 5, and must be labelled that way

This configuration **also** trips the remote-endpoint guard. The examples the spec gives for row 5 (Colima/Lima, docker-ce inside WSL) are **a local socket with a non-Desktop daemon**, with no remote dimension at all.

On Windows a non-Desktop daemon can only be reached over `tcp://` or `ssh://`, and `isRemoteEndpoint()` returns true for both (it admits only `unix://` and `npipe://`). **So "local socket with a non-Desktop daemon" is unreachable on Windows** — that shape belongs to macOS with Colima.

Conclusion: row 5's `elsewhere` refusal is verified to fire with the right message, but **through the remote-daemon variant**. The local-socket variant remains uncovered and needs a Mac.

---

## The two rows still uncovered

| 6.2 | Combination | Why not done |
| --- | --- | --- |
| 1 | macOS Intel and Apple Silicon + Docker Desktop | No Mac. Neither this machine nor that VM is one |
| 3 | Docker Desktop for Linux, CLI on the same Linux | No machine with Docker Desktop for Linux. Environment B runs native docker-ce, and installing Docker Desktop on it would destroy its role as the source for rows 4 and 5 |

Both are missing hardware, not missing work. Spec 14.3's pass condition allows a row to be "deferred with the reason recorded", and this section is that record.

## Noticed in passing: an empty path field in the refusal message

Both rows print the same line:

```
Could not read : No daemon configuration path is known ...
無法讀取 ：No daemon configuration path is known ...
```

The slot before the colon is empty because `platformDaemonPath()` deliberately returns an empty string for `elsewhere` — which is correct, there is no honest default to give. But the message template still has a path field, and its second half stays English even under a Chinese locale, unlike the two lines above it.

Users see this. It is a rough edge on two refusal paths that are now verified. Behaviour is unaffected; not fixed.
