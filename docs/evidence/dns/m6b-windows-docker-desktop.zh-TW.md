# M6b 證據 —— Windows、Docker Desktop

*English: [m6b-windows-docker-desktop.md](m6b-windows-docker-desktop.md)*

**日期。** 2026-08-28 · **平台。** Windows 11 Pro 26200、Docker Desktop、Docker Engine 29.6.2、Compose 5.3.1，context 為 `desktop-linux`（`npipe:////./pipe/dockerDesktopLinuxEngine`），`docker info` 回報 `linux|Docker Desktop`。

這份檔案記錄的是**量到什麼**，而不是**預期是什麼**——因為 [DNS-MILESTONES.zh-TW.md](../../DNS-MILESTONES.zh-TW.md) 要求下一位貢獻者不必為了相信這件事而重跑一次 T4 驗證。

**這次過程中沒有寫過真實的 daemon 設定，也沒有重啟過 Docker。** 機器的 `~/.docker/daemon.json` 前後 SHA-256 相同（`27369c83…`），`docker ps -a` 列出的仍是同樣 17 個 container。所有 daemon 寫入都透過 `RUNESTONE_DNS_DAEMON_PATH` 導向暫存檔。

## 裁決 1 —— `docker desktop restart` 存在

```
$ docker desktop version
Docker Desktop CLI plugin version: v0.4.3

$ docker desktop restart --help
Usage:  docker desktop restart
Options:
  -d, --detach            Do not synchronously wait for the requested operation to complete.
      --timeout seconds   Terminate the running command after the specified timeout ...
```

它存在，而且**預設是同步的**——這正是 `restartDocker` 先執行指令、再輪詢 `docker info` 時所假設的。

**偵測與手動備援兩者都保留。** 這個 plugin 有自己的版本號（`v0.4.3`），與 Docker Desktop 本身分開，所以不能因為「這是 Docker Desktop」就推論它一定在；較舊的安裝不會有。一台機器有，不構成每台機器都有的證據。

## Target IP

```
$ docker run --rm --add-host host.docker.internal:host-gateway --entrypoint sh cymondez/runestone:5.2 \
    -c 'getent ahostsv4 host.docker.internal | head -1 | cut -d" " -f1'
192.168.65.254
```

與規格 6.1 為 Docker Desktop 列出的值一致。

## 53 埠 —— 一個真的衝突，以及它背後一個真的 bug

這台機器本來就有衝突，不是我們安排的。`0.0.0.0:53/udp` 被 PID 5388 佔著：

```
$ netstat -ano | grep ":53 "
  UDP    0.0.0.0:53             *:*                                    5388

$ Get-WmiObject Win32_Service -Filter "ProcessId=5388"
SharedAccess    Internet Connection Sharing (ICS)    Running
```

**Internet Connection Sharing 是 WSL2 拿來做 NAT 網路的服務，所以這是「跑著 Docker Desktop 的 Windows 機器」的預設狀態，不是什麼特例。**

### 兩種寫法並不等價

```
$ docker run --rm -p 53:53/udp alpine:3.22 true
                                                          # 啟動成功

$ docker run --rm -p 0.0.0.0:53:53/udp alpine:3.22 true
Error response from daemon: ports are not available: exposing port UDP 0.0.0.0:53
  -> 127.0.0.1:0: listen udp4 0.0.0.0:53: bind: Only one usage of each socket address
  (protocol/network address/port) is normally permitted.
```

在真正會執行的那一層 —— Compose —— 也重現了：

```
$ docker compose ... up -d          # ports: ["0.0.0.0:53:53/udp"]
Error response from daemon: ports are not available: ... listen udp4 0.0.0.0:53: bind: ...

$ docker compose ... up -d          # ports: ["53:53/udp"]
 Container m6bbare-probe-1 Started
```

**compose 模板寫的正是會失敗的那種。** 它發佈的是 `${DNS_BIND_IP:-0.0.0.0}:53:53/udp`，把位址明寫出來。於是 `dns enable` 在任何裝了 WSL2 的 Windows 機器上——也就是大多數——都會在啟動服務那一步失敗，而使用者看到的會是 Docker 丟出來的原始 `bind:` 錯誤。

規格 6.1 其實已經記錄了「ICS 佔著這個埠，但發佈仍然成功」。那個觀察是對的；它是用不帶位址的寫法量的，而實作用的是明寫位址的寫法。**兩者被當成可以互換，事實上不能。**

修法是從 `DNS_BIND_IP` 推導出 `DNS_BIND_PREFIX`：全介面綁定時為空字串，指名單一介面時為 `<位址>:`。使用者面向的 `DNS_BIND_IP` 意義不變，在揭露第 4 項裡的位置也不變；改變的只有 Compose 的寫法。

### 用那種寫法發佈之後，這個埠確實可用

兩個 socket 之後並存 —— ICS 在 5388，Docker Desktop 的後端在 25920：

```
$ netstat -ano | grep "UDP.*0.0.0.0:53"
  UDP    0.0.0.0:53             *:*                                    5388
  UDP    0.0.0.0:53             *:*                                   25920
```

而且服務會在 Target IP 上回應，走的是真正產生出來的 Compose 檔：

```
$ docker compose --profile dns up -d dns
 Container rs6b-dns Started

$ docker exec rs6b-dns sh -c 'cat /etc/dnsmasq.d/managed.conf'
address=/example.test/192.168.65.254

$ docker run --rm --add-host host.docker.internal:host-gateway ... \
    -c 'dig +short @192.168.65.254 anything.example.test A'
192.168.65.254                       # 憑證涵蓋網域的萬用子網域

$ ... -c 'dig +short @192.168.65.254 example.com A'
104.20.23.154                        # 轉發到上游
```

**這正是規格 6.1 所謂「用啟動服務來判定 53 埠可不可用」的意思。** 讀 netstat 會說這個埠被佔了；只看 TCP 會說它是空的；只有真的啟動才給得出答案，而且答案還會因協定與寫法而不同。

### 在 Docker Desktop 上，綁定單一位址也可行

修好之後用不到了，但值得記錄，因為它與規格 6.1 給出的「為什麼是 `0.0.0.0`」的理由相牴觸：

```
$ docker run --rm -p 127.0.0.1:53:53/udp alpine:3.22 true        # 啟動成功
$ docker run --rm -p 192.168.0.182:53:53/udp alpine:3.22 true    # 啟動成功
```

在服務**只**發佈到 `127.0.0.1:53` 的情況下，container 仍然能從 Target IP 打到它：

```
$ ... -c 'dig +short @192.168.65.254 sub.example.test A'
192.168.65.254
```

反向對照 —— 同一個查詢，但服務已停止：

```
;; communications error to 192.168.65.254#53: timed out
;; no servers could be reached
```

所以 `DNS_BIND_IP=127.0.0.1` 在 Docker Desktop 上是可行的設定，而且更緊：53 埠完全不會到 LAN 上。這裡**沒有**把它設成預設，因為 macOS 上沒有量過，而一個只在兩個 Docker Desktop 平台其中之一被證實可行的預設值，不算預設值。那是 M8 平台矩陣的問題。

## 撤銷用的逃生口（規格 16.5 安全網）

對著一個暫存 daemon 檔，裡面放了一筆 Runestone 從未記錄過的項目：

```
$ runestone dns disable --dry-run
[error] Runestone has no record of owning any entry in ...daemon.json. It will not
guess which entry to remove. If you know which entry belongs to Runestone, state it:
runestone dns disable --assume-entry <ip>

$ runestone dns disable --yes --assume-entry 192.168.65.254
  Removing 1 entry that Runestone added.
  - 192.168.65.254
    10.0.0.53
[ok] DNS is disabled.
```

之前：`{"dns": ["192.168.65.254", "10.0.0.53"], "experimental": false}`
之後：`{"dns": ["10.0.0.53"], "experimental": false}`

無關的項目與無關的鍵都活了下來。逃生口可用——這正是安全網要在任何真實 daemon 檔寫入之前先確立的事。

## WSL，以及取代 WSL 偵測的那個拒絕

```
$ wsl -l -v
  Ubuntu-26.04      Running         2

$ wsl -d Ubuntu-26.04 -- bash -lc '...'
systemd-pid1: systemd
docker bin: /usr/bin/docker
dockerd bin: none
resolved: active

$ wsl -d Ubuntu-26.04 -- docker info --format '{{.OSType}}|{{.OperatingSystem}}'
linux|Docker Desktop
```

這個發行版正是 M6a 那個拒絕所針對的形狀：一個 Linux 使用者空間，它的 `docker` 是 Docker Desktop 的、透過 WSL 整合連過去，自己沒有 daemon。**從它裡面執行 `docker info` 會回報 `Docker Desktop`**，而那正是 `preflight` 的 `docker-desktop-elsewhere` 失敗所依據的訊號——這在真實環境中確認了：舊的核心字串偵測分辨不出任何東西，而替代訊號確實存在且正確。

CLI 本身沒有在 WSL 裡跑過：那個發行版沒有 Linux 端的 `node`。

## 這份檔案沒有涵蓋的部分

- **對真實 daemon 執行 enable → 重啟 → disable 的完整循環。** 它會重啟 Docker，終止這台機器上全部 12 個執行中的 container，其中好幾個是有狀態的。這需要一個約好的時間窗（見 M6b 檢查清單），不是可以在工作日中間順手插進去的事。
- **原生 Linux engine。** 這台機器沒有：WSL 發行版只帶 Docker Desktop 整合，所以 `/etc/docker/daemon.json`、`sudo`、`systemctl restart docker` 與 systemd-resolved 的 `127.0.0.53` 都還沒驗證過。那需要一台 VM，或是在某個 Linux 發行版裡裝一份 Docker Engine。
- **macOS**，兩種架構都沒有 —— 那是 M8 平台矩陣的一列。
