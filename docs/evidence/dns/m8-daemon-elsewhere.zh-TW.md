# M8 證據——daemon 不在這台機器上的兩列（14.3 第 2、5 列）

*English: [m8-daemon-elsewhere.md](m8-daemon-elsewhere.md)*

**日期。** 2026-08-30 · **CLI 版本。** 1.2.0（`feat/dns-support`，含 `d2dbaac` 之後的 SAN 改動）

規格 6.2 判斷表有兩列會分類成 `elsewhere`：第 2 列（WSL 發行版透過 Docker Desktop 整合）與第 5 列（CLI 在 Windows／macOS，daemon 是別處的純 Engine）。兩列都必須**拒絕**並指向 7.4 的覆寫變數。這份文件記錄兩列的實際行為。

M6b 已經涵蓋第 1 列（Windows＋Docker Desktop）與第 4 列（Linux 原生 engine）。第 1 列的 macOS 半與第 3 列（Docker Desktop for Linux）仍未涵蓋，理由見最後一節。

## 先分清楚兩個環境——它們都叫 Ubuntu 26.04

這是這次最容易搞混、也最容易產生假證據的地方。

| | 環境 A | 環境 B |
| --- | --- | --- |
| 是什麼 | WSL2 發行版 | Hyper-V 虛擬機 |
| 怎麼進去 | `wsl -d Ubuntu-26.04` | `ssh local-hyperv-ubuntu26.04` |
| 自己的 docker daemon | **沒有**，用 Docker Desktop 的 WSL 整合 | **有**，原生 docker-ce 29.5.3 |
| `docker info` OperatingSystem | **`Docker Desktop`** | **`Ubuntu 26.04 LTS`** |
| `/etc/docker/daemon.json` | 不適用 | 不存在 |
| 對應 14.3 | **第 2 列** | 第 4 列（M6b 已用它）／**第 5 列**（從 Windows 指過去） |

**一句話分辨：`docker info --format '{{.OperatingSystem}}'`。** 這也正是 CLI 用來判斷 `isDockerDesktop` 的那個字串。

環境 B 用的是 Hyper-V NAT，位址（當時是 `192.168.152.77`）**重開機後會變**，不要把它當成穩定識別。

---

## 第 2 列——WSL 發行版＋Docker Desktop 整合

### 三個偵測輸入都在真機量到

```
$ wsl -d Ubuntu-26.04
WSL_DISTRO_NAME                  Ubuntu-26.04
/run/WSL                         存在
/proc/version 含 microsoft       是
docker info OperatingSystem      Docker Desktop
docker context endpoint          unix:///var/run/docker.sock
```

`isWsl()` 有三個判斷（`WSL_DISTRO_NAME`、`/run/WSL`、`/proc/version`），**三個各自獨立都為真**。偵測不依賴任何單一訊號，這點值得記下來——之後若有哪一個訊號在新版 WSL 消失，另外兩個仍然成立。

代入 `classifyDaemonEnvironment()`：`daemonIsDockerDesktop=true`、`platform=linux`、`isWsl=true` → `elsewhere`。符合判斷表第 2 列。

### 陷阱：Windows 的 node 與 npm 會透過 interop 漏進發行版

**這是這一列最重要的一段。** 發行版原本沒有 Node，但在裡面執行 `npm -v` 會成功：

```
$ wsl -d Ubuntu-26.04 -- command -v npm
/mnt/c/nvm4w/nodejs/npm

$ wsl -d Ubuntu-26.04 -- dpkg-query -W nodejs
dpkg-query: no packages found matching nodejs
```

WSL 預設把 Windows 的 PATH 接在後面，所以 `npm`（一個 bash script）與 `node.exe` 都叫得到。用它們跑出來的東西**看起來完全正常，但測的是第 1 列**：

```
$ wsl -d Ubuntu-26.04 -- /mnt/c/nvm4w/nodejs/node.exe -e "console.log(process.platform, process.env.WSL_DISTRO_NAME, os.homedir())"
win32  (unset)  C:\Users\cymondez
```

`platform` 是 `win32`，所以 `isWsl()` 在第一個判斷就短路回 false，分類變成 `docker-desktop`——第 1 列。它甚至會去寫 `C:\Users\cymondez\.docker\daemon.json`，對那個 Windows 行程來說還是**正確的檔案**，不會有任何錯誤提示你測錯了。

附帶佐證：讓那個 node.exe 讀發行版的 `/tmp/p.js`，它去找的是 `D:\tmp\p.js`——它連發行版的檔案系統都看不到。

**所以這一列的證據必須同時記錄執行檔身分。** 安裝發行版自己的 Node 之後：

```
$ wsl -d Ubuntu-26.04 -- command -v node
/usr/bin/node
$ wsl -d Ubuntu-26.04 -- /usr/bin/node -p "process.platform + ' ' + process.env.WSL_DISTRO_NAME"
linux Ubuntu-26.04
```

`linux` 且 `WSL_DISTRO_NAME` 有值——這才是第 2 列的輸入條件。

### 安裝方式：不從掛載的 dist 跑

CLI 是用 `npm pack` 打包後裝進發行版的，不是直接執行 `/mnt/d/.../dist/cli.js`：

```
$ npm pack                      # 在 Windows 側
$ wsl -d Ubuntu-26.04 -- /usr/bin/npm install -g --prefix ~/.local <tgz>
added 12 packages in 3s
```

理由有二：Windows 上安裝的 `node_modules` 含平台專屬產物，在 Linux 下未必載入得起來；而在同一個目錄裡跑 Linux 的 `npm install` 會破壞 Windows 側的開發環境。用 `--prefix ~/.local` 則避開了 `sudo`。副作用是這份證據測到的是**使用者實際會裝到的東西**。

### 實際輸出

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

**通過。** 訊息是 WSL 專屬的那一條，明確說了設定檔在 Windows 側、寫這個檔案系統上的 `~/.docker/daemon.json` 不會有作用，並給出兩條出路。

`setup-incomplete` 也同時出現（發行版裡沒有 `~/.runestone`），而它**沒有短路掉**後面的分類檢查——前置檢查是把失敗蒐集起來一次列出，不是遇到第一個就停。

---

## 第 5 列——CLI 在 Windows，daemon 是別處的純 Engine

### 探測值

從 Windows 側，`DOCKER_HOST=ssh://local-hyperv-ubuntu26.04`：

```
docker info OSType               linux
docker info OperatingSystem      Ubuntu 26.04 LTS
docker context Name              default
docker context Endpoint          ssh://local-hyperv-ubuntu26.04
```

`isDockerDesktop=false`、`platform=win32` → `onLinux=false` → `elsewhere`。符合判斷表第 5 列。

### 我的第一次量測是錯的，因為安全覆寫把要測的東西關掉了

第一次執行時我設了 `RUNESTONE_DNS_DAEMON_PATH` 當安全網，結果只看到遠端 endpoint 的拒絕，於是我判斷「遠端守衛先觸發，第 5 列沒被走到」。**那個結論是錯的。** `preflight` 的條件是：

```ts
} else if (target.host === 'elsewhere' && target.source !== 'override') {
```

設了覆寫，`source` 就是 `override`，這個分支整條不會被評估。**量測儀器遮住了要量的現象。** 覆寫的這個行為本身是對的——使用者既然指名了要寫哪個檔案，就不該再以分類為由拒絕——但它讓那次執行對第 5 列毫無意義。

### 實際輸出（不設覆寫）

```
$ DOCKER_HOST=ssh://local-hyperv-ubuntu26.04 runestone dns enable --dry-run
[info] 前置檢查
[error] daemon（Ubuntu 26.04 LTS）連得到，但它的設定檔在一個這台機器叫不出名字的
        檔案系統上——某個 VM 或另一個發行版裡的 engine。這裡沒有可寫的檔案，而猜
        一個只會回報成功卻什麼都沒改。請把 RUNESTONE_DNS_DAEMON_PATH 設成那個
        daemon 讀的檔案，並把 RUNESTONE_DNS_RESTART_CMD 設成重啟它的指令。
[error] 目前的 Docker context default 指向 ssh://local-hyperv-ubuntu26.04，
        那不是這台機器。Runestone 不會修改遠端的 daemon。
[error] 無法讀取 ：No daemon configuration path is known for this Docker daemon.
        Set RUNESTONE_DNS_DAEMON_PATH to the file it reads.
```

**通過。** 第一條就是 `docker-desktop-elsewhere`，訊息帶了實際的 OperatingSystem，並指向 7.4 的兩個覆寫變數。它與第 2 列那條**確實是不同的訊息**——第 2 列說「在 Windows 側」，第 5 列說「某個 VM 或另一個發行版」。

### 這份證據涵蓋的範圍比第 5 列窄，必須標註

這個組合**同時**觸發遠端 endpoint 的守衛。而規格第 5 列舉的例子（Colima／Lima、WSL 內的 docker-ce）是**本地 socket 配非 Desktop daemon**，沒有遠端這一維。

在 Windows 上，非 Desktop 的 daemon 只能用 `tcp://` 或 `ssh://` 連，而 `isRemoteEndpoint()` 對兩者都回 true（它只放行 `unix://` 與 `npipe://`）。**所以「本地 socket 配非 Desktop daemon」在 Windows 上實際到不了**，那是 macOS＋Colima 的形狀。

結論：第 5 列的 `elsewhere` 拒絕已驗證為會觸發且訊息正確，但**是以遠端 daemon 的變體驗證的**。本地 socket 那個變體仍未涵蓋，需要一台 Mac。

---

## 仍未涵蓋的兩列

| 6.2 | 組合 | 為什麼沒做 |
| --- | --- | --- |
| 1 | macOS Intel 與 Apple Silicon＋Docker Desktop | 沒有 Mac。這台機器與那台 VM 都不是 |
| 3 | Docker Desktop for Linux，CLI 在同一台 Linux | 沒有裝了 Docker Desktop for Linux 的機器。環境 B 是原生 docker-ce，裝上 Docker Desktop 會破壞它作為第 4／5 列證據來源的角色 |

兩列都是缺硬體，不是缺工作。規格 14.3 的通過條件允許「明確記錄理由後延後」，這一節就是那個記錄。

## 順帶發現：拒絕訊息裡有個空的路徑欄位

兩列都出現同一行：

```
Could not read : No daemon configuration path is known ...
無法讀取 ：No daemon configuration path is known ...
```

冒號前是空的，因為 `platformDaemonPath()` 對 `elsewhere` 刻意回傳空字串（那是對的，沒有誠實的預設值可給）。但訊息模板仍然留了一個路徑欄位，而且後半段是英文，與中文語系下的其他兩行不一致。

使用者看得到，屬於這兩條剛驗完的拒絕路徑上的粗糙處。不影響行為，未修。
