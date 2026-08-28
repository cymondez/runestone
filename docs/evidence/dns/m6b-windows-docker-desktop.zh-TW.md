# M6b 證據 —— Windows、Docker Desktop

*English: [m6b-windows-docker-desktop.md](m6b-windows-docker-desktop.md)*

**日期。** 2026-08-28 · **平台。** Windows 11 Pro 26200、Docker Desktop、Docker Engine 29.6.2、Compose 5.3.1，context 為 `desktop-linux`（`npipe:////./pipe/dockerDesktopLinuxEngine`），`docker info` 回報 `linux|Docker Desktop`。

這份檔案記錄的是**量到什麼**，而不是**預期是什麼**——因為 [DNS-MILESTONES.zh-TW.md](../../DNS-MILESTONES.zh-TW.md) 要求下一位貢獻者不必為了相信這件事而重跑一次 T4 驗證。

以下大部分內容是透過 `RUNESTONE_DNS_DAEMON_PATH` 對著暫存檔量的。最後兩節是刻意的例外：寫的是真實的 `~/.docker/daemon.json`、Docker 真的重啟過，而且 **DNS 在這台機器上是啟用並已套用的狀態**，沒有被還原。

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

## 中斷本身——試了，被 Docker Desktop 擋下

2026-08-28 對著真實的 `~/.docker/daemon.json` 執行，Runestone 專案刻意用沙箱：daemon 檔才是 M6b 要驗的那個全域物件，把使用者自己的安裝也拉進爆炸半徑並不會多驗到任何東西。它自始至終沒被動過——前後 `.env` 裡都沒有 DNS 鍵，狀態檔裡也沒有所有權紀錄。

### 寫入這一步證明了什麼

`dns enable --yes --no-restart` 寫了真實檔案。原本就在裡面的鍵原封不動：

```json
{
  "builder": { "gc": { "defaultKeepStorage": "20GB", "enabled": true } },
  "experimental": false,
  "dns": ["192.168.65.254"]
}
```

在 daemon 被碰到之前，服務就已經回答過一次真實查詢——`traefik.m6b.test` → `192.168.65.254`。這正是規格 10.1 要強制的順序：所有可能失敗的事，都在機器的全域 DNS 改變之前失敗。

**`phase: prepared` 現在在真機上得到證明，不再只有沙箱裡的證據。** 在那筆項目已經躺在真實 daemon 檔裡的狀態下，新建立容器的 `resolv.conf` 仍然是：

```
nameserver 192.168.65.7
```

Docker 自己的解析器。寫入是真的，效果是零。這個「分離」正是整套風險計畫所倚賴的槓桿，而在此之前它只在 dind 裡被示範過。`dns status` 用的正是這個說法：*「已寫入，等待 Docker 重啟。目前尚未生效。」*

### Docker Desktop 會自己改寫 `daemon.json`

在我們寫入與下一次讀取同一個檔案之間，它變成了：

```json
{
  "builder": { ... },
  "dns": [
    "192.168.65.254"
  ],
  "experimental": false
}
```

鍵被按字母重排，陣列被展開成多行。這不是我方做的——Runestone 精準地 splice 位元組，正是為了不做這件事。**是 Docker Desktop 在啟動時把檔案正規化了。**

這在正確性上不花任何代價：`dns` 陣列**內部**的元素順序有被保留，所以用記錄下來的 index 做識別依然成立。它真正的意思是：M1 測試的那個「位元組保真」不變式，是 Runestone 自身操作的性質，而不是對「檔案能撐過一次 Docker Desktop 重啟」的承諾。任何人把規格 9.5 讀成「你的排版會活下來」，都應該改讀成「Runestone 不會是動它的那個」。

### `docker desktop restart` 讓 Docker Desktop 當掉

重啟從未完成。Docker Desktop 以這段訊息終止：

```
starting services: initializing Inference manager: listening on
unix://C:/Users/cymondez/AppData/Local/Docker/run/dockerInference:
remove C:/Users/cymondez/AppData/Local/Docker/run/dockerInference:
The file cannot be accessed by the system.
```

它的 Inference manager 無法重建自己的 socket。那條路徑上沒有任何東西牽涉 DNS、`dns` 陣列或 53 埠，而當下 daemon 檔裡多的只是一個字串。這台機器今天執行過兩次 `docker desktop restart`：第一次完成了，第二次變成這樣。

**這是關於「裁決 1 所選定的那個機制」的事實。** `docker desktop restart` 存在、而且是同步的——同時它並不可靠。`completeEnable` 依賴它兩次：一次用來套用，另一次用來在套用失敗、反向還原之後再重啟。一個會讓 daemon 當掉的重啟，也可能在復原過程中當掉。

設計撐得住這件事，而這次意外剛好示範了原因：**反向還原是先寫檔案、後重啟。** Docker 當著，而我方的項目還在檔案裡；在它停著的時候把檔案還原就已經足夠，Docker 回來時讀到的就是修正後的檔案。如果順序是「先重啟、再寫」，就不存在任何可以安全介入的時刻。

### 安全網有做到它該做的事

`m6b-safety-net.sh restore` 把 daemon 檔逐位元組放了回去（前後都是 `27369c83…`），在丟棄之前先印出即將丟棄的 diff，對一個沒在跑的 daemon 拒絕執行重啟，並把五個沒有自己回來的容器叫了起來。接著 `status` 回報機器與快照完全一致。從當掉到機器回到快照狀態，總共幾分鐘，沒有任何手動編輯。

### 仍未驗證的部分，以及原因

通過條件裡需要「重啟真的完成」的那一半：

- 新容器的 `resolv.conf` 把 Target IP 列在**第一位**
- 憑證涵蓋的子網域透過 daemon 設定解析，而不是靠明確指定 `@server`
- `disable` 以第二次重啟把陣列還原
- `restart: unless-stopped` 能不能撐過**優雅的** `docker desktop restart`——規格 8.3 倚賴這件事，而 M6a 只針對「被砍掉的 daemon」示範過

在這台機器上的 `docker desktop restart` 能夠完成之前，這些都到不了。那是要先解決的 Docker Desktop 問題，不是 Runestone 的問題。

## 中斷，完成了

過程中 Docker Desktop 更新到 4.88.1，而它自己的重啟把那份停在 `phase: prepared` 的設定套用了。那正是這個里程碑需要的重啟，通過條件也隨之達成。

### 通過條件

一個全新建立、沒有為它做任何安排的容器：

```
$ docker run --rm ... cat /etc/resolv.conf
nameserver 192.168.65.254      # Target IP，第一筆
nameserver 1.1.1.1             # 9.7 備援，第二筆
```

每一個憑證涵蓋的網域，都是透過 daemon 設定解析的，而不是明確指定 `@server`——以下是走容器自己 `resolv.conf` 的一般 `getent hosts` 查詢：

```
traefik.local.developers-homelab.net     192.168.65.254
anything.local.developers-homelab.net    192.168.65.254     # 萬用子網域
sub.traefik.me                           192.168.65.254     # 第二張憑證
tunnel.local.developers-homelab.net      192.168.65.254
github.com                               20.27.177.113      # 對外仍然正常
```

### 9.7 備援表，在真實環境中量到

有一段時間 dns 服務停著，而 daemon 仍然指向它——正是備援存在的那個情境。9.7 表格的兩列都如實出現：

```
$ getent hosts github.com                              # 一般網際網路名稱
20.27.177.113 github.com                               # 仍可解析，經由 1.1.1.1

$ getent hosts traefik.local.developers-homelab.net    # Runestone 網域
127.0.0.1     traefik.local.developers-homelab.net     # 正是文件寫明的代價
```

那就是規格 9.7 描述的取捨，不再只是預測。

### 完成過程中抓到的兩個缺陷

**Docker Desktop 的版本決定了自動重啟安不安全。** 低於 4.86.0 時它的重啟會把容器停掉，而 `unless-stopped` 會讓它們一直躺著——這裡量過兩次，也正是先前那幾次嘗試「看起來像 DNS 失敗、其實設定是對的」的原因。版本讀自 `docker version --format '{{.Server.Platform.Name}}'`，自動重啟以它為閘門；低於門檻時 Runestone 什麼都不嘗試，改為給出三條路。

**`dns enable` 會對一台「設定已經生效」的機器再重啟一次。** 寫入與重啟是刻意可分開的，所以那次重啟可能來自手動重啟、機器重開或更新——而在這些情況下再重啟一次，是把每一個容器都終止掉卻換來零。現在它會先問一個拋棄式容器的 `resolv.conf`，答案已經是我方位址就跳過重啟。在這台機器上，那讓最後一步變成了 no-op。

### 仍未驗證

`disable` 在**真實重啟之後**把陣列還原。它的檔案操作已經證明過——逃生口那一輪從真實檔案裡精準移除了記錄的項目，無關項目與無關鍵都沒被動到——但為了看重啟那一半而把一份正在運作的設定再拆掉，不值得再中斷整台機器一次。

## 這份檔案沒有涵蓋的部分

- **對真實 daemon 執行 enable → 重啟 → disable 的完整循環。** 它會重啟 Docker，終止這台機器上全部 12 個執行中的 container，其中好幾個是有狀態的。這需要一個約好的時間窗（見 M6b 檢查清單），不是可以在工作日中間順手插進去的事。
- **原生 Linux engine。** 這台機器沒有：WSL 發行版只帶 Docker Desktop 整合，所以 `/etc/docker/daemon.json`、`sudo`、`systemctl restart docker` 與 systemd-resolved 的 `127.0.0.53` 都還沒驗證過。那需要一台 VM，或是在某個 Linux 發行版裡裝一份 Docker Engine。
- **macOS**，兩種架構都沒有 —— 那是 M8 平台矩陣的一列。
