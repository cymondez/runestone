# M6b 證據——Linux 原生 Docker Engine

*English: [m6b-linux-native.md](m6b-linux-native.md)*

**日期。** 2026-08-29 · **平台。** Hyper-V 上的 Ubuntu 26.04 LTS（kernel 7.0.0-22-generic、x86_64），Docker Engine — Community 29.5.3，context `default`（`unix:///var/run/docker.sock`），systemd-resolved 執行中，`docker0` 為 `172.17.0.1`。使用者屬於 `docker` 與 `sudo` 群組，sudo 為 NOPASSWD。

這是 M6b 的另一半。Windows 那一半在 [m6b-windows-docker-desktop.zh-TW.md](m6b-windows-docker-desktop.zh-TW.md)，它涵蓋 Docker Desktop 的定址與重啟機制，並留下兩件只有原生 engine 才能定案的事。兩件都在這裡定案了。

**整個循環都是對著真實的 `/etc/docker/daemon.json` 跑的，也真的 `systemctl restart docker` 了兩次。** 機器最後回到原樣：沒有 `/etc/docker/daemon.json`、同樣一個容器在跑、新容器的 `resolv.conf` 回到 VM 自己的 resolver。安全網的 `status` 在最後確認了這件事。

## 這個環境能回答、而 Docker Desktop 回答不了的事

| 問題 | 答案 |
| --- | --- |
| `restart: unless-stopped` 撐得過 daemon 重啟嗎？ | **撐得過**——實測兩次。Windows 那一半判斷不了，因為 `docker desktop restart` 重啟的是**應用程式** |
| 真實重啟之後 `dns disable` 能把機器還原嗎？ | **能**——Runestone 建立的檔案被移除，新容器回到主機自己的 resolver |
| 規格 9.3 的提權寫入能運作嗎？被拒絕時會乾淨中止嗎？ | **兩者皆是**——而且在這次之前，它根本還不存在 |

## 動手之前：安全網守錯了檔案

```
$ bash docker/dns/test/m6b-safety-net.sh capture
Snapshot taken in /home/cymondez/.runestone-m6b-safety
  daemon    /home/cymondez/.docker/daemon.json (<absent>)
```

`~/.docker/daemon.json` 是 Docker Desktop 的檔案。在這台機器上 Docker 從不讀它，它也不存在。安全網會一路回報「機器與快照相符」，而它存在的目的所要守護的那個檔案——`/etc/docker/daemon.json`——根本不在監看範圍內。

問題出在預設值：所有平台一律 `${HOME}/.docker/daemon.json`；真正知道正確答案的 `platform_daemon_path()`，只在「要不要重啟 Docker」時才被問到。已修正，並連帶修掉第二個 Linux 缺口：還原一個 root 擁有的檔案需要提權，因此還原改為逐項操作、以目錄可寫與否決定是否 `sudo`。

```
$ bash docker/dns/test/m6b-safety-net.sh capture
  daemon    /etc/docker/daemon.json (<absent>)
```

## 測試套件從來沒有在 Linux 上跑過

```
$ npx jest
Test Suites: 4 failed, 38 passed, 42 total
Tests:       28 failed, 540 passed, 568 total
```

四個套件、28 個測試。沒有一個是 Linux 上的產品錯誤；全部都是**繼承了主機平台的測試 fixture**。它們描述的是一台 Docker Desktop 機器，在 Windows 上 CLI 同意這個前提；在 Linux 上，「Linux userland 指著 Docker Desktop daemon」正是 `docker-desktop-elsewhere` 那條拒絕——產品是對的，只是 fixture 從來沒說清楚它講的是哪一台機器。

四個之中有一個是值得修而不是遮掉的產品毛病。`sameDaemonPath` 用 `path.resolve` 正規化，而那follows **主機**的分隔符規則，但它要比較的是「daemon 所在平台」的路徑。現在它依 `osDetector.platform()` 選擇路徑風味（`path.win32` / `path.posix`），在正式環境的行為與今天完全相同，而且不再取決於這段比較在哪裡執行。

```
$ npx jest
Test Suites: 42 passed, 42 total
Tests:       568 passed, 568 total
```

568 個，沒有任何 skip——其中五個是 Windows 會跳過的提權測試，因為它們需要真實的權限位元才有意義。

## 前置檢查，在一台還沒有 daemon 檔的機器上

```
$ node bin/runestone dns enable --dry-run
[info] Preflight
  Target IP: 172.17.0.1 (host.docker.internal, resolved from inside Docker)
  Bind IP: 172.17.0.1
  Docker context: default
  Daemon configuration: /etc/docker/daemon.json
  That file does not exist yet and will be created.
```

一次確認三條規格規則：Target IP 是 `docker0` gateway（6.1）、Bind IP 是同一個位址而不是 `0.0.0.0`（6.1 的 Linux 那列）、daemon 路徑是原生的那個（6.2）。

上游被推算成 `1.1.1.1`，理由是「偵測不到任何來源」——這正是規格 8.4 照著寫的樣子在運作。這台主機唯一的 resolver 是 systemd-resolved 的 `127.0.0.53`，那是一個 loopback stub，container 轉發到它等於在問自己，因此被排除；沒有其他候選時，「永不為空」那條規則補上出廠預設值。

## 規格 9.3 的提權寫入根本還不存在

規格寫著：*「Linux 的 `/etc/docker/daemon.json` 需要 sudo，提權失敗即中止，不做部分寫入。」* 而實際的寫入是一個普通的 `fs` 寫入，整段程式碼裡沒有任何提權。在這台機器上，以一般使用者身分執行的 `dns enable` 根本寫不進去。

現在實作了，而且順序保住了直接寫入原本就有的兩個性質：內容在**要求提權之前**就已驗證，目標檔案永遠只透過「在自己目錄內 rename」被取代。

```
$ node bin/runestone dns enable --yes --no-restart
  The dns service answered traefik.local.developers-homelab.net with 172.17.0.1.
[ok] Written and waiting. Nothing has taken effect yet: restart Docker for containers to start using it.

$ ls -l /etc/docker/daemon.json
-rw-r--r-- 1 root root 27 Aug 29 14:15 /etc/docker/daemon.json
{
  "dns": ["172.17.0.1"]
}
```

root 擁有、0644、合法 JSON、一筆項目。

### `phase: prepared` 在另一個平台上再次被證明

```
$ docker run --rm alpine:3.20 cat /etc/resolv.conf | grep nameserver
nameserver 192.168.144.1
```

項目已經在真實檔案裡，而效果是零。這是整套計畫倚賴的槓桿，現在它在兩個平台上都成立。

### 提權被拒：中止，且什麼都沒寫

把一個「一律拒絕」的 `sudo` 放在 `PATH` 前面：

```
$ PATH=/tmp/fakebin:$PATH node bin/runestone dns enable --yes --no-restart
[error] Could not write /etc/docker/daemon.json: elevation was refused while trying to
        stage the new file beside it; nothing was written. Everything done before it was undone.

$ ls -a /etc/docker/
.  ..
```

沒有檔案，旁邊也沒有殘骸。**這就是 M6b Linux 的通過條件，已量測。**

## 重啟循環

```
14:15:47  dns enable --yes
14:15:59  ActiveEnterTimestamp=Sat 2026-08-29 14:15:59 CST   （dockerd）
14:16:00  [ok] DNS is active. A new container is given 172.17.0.1 as its first nameserver.
```

十三秒，含 `sudo systemctl restart docker`。

```
$ docker ps -a --format '{{.Names}} {{.Status}}'
runestone-dns Up 12 seconds
runestone Up 12 seconds

$ docker run --rm alpine:3.20 cat /etc/resolv.conf | grep nameserver
nameserver 172.17.0.1
```

**`restart: unless-stopped` 自己回來了**，兩個容器都是，完全不需要 CLI 介入。規格 8.3 假設的正是這件事，而 Windows 那一半無法確認：`docker desktop restart` 重啟的是應用程式，而應用程式關閉會**停止**容器，那正是 `unless-stopped` 不會自己回來的情況。daemon 重啟不是那回事。在字面意義成立的那個平台上，這個假設是站得住腳的。

### 憑證網域，透過 daemon 設定解析

沒有 `@server`、沒有指定 resolver——這就是一個普通 container 拿到的東西。

```
traefik.local.developers-homelab.net       172.17.0.1
dns.local.developers-homelab.net           172.17.0.1
anything.local.developers-homelab.net      172.17.0.1
deep.nested.local.developers-homelab.net   172.17.0.1
example.com                                2606:4700:10::ac42:93f3   （轉發給上游）
```

每一張憑證的網域、它底下任意深度的子網域，其他一律不動。

## 我搞錯的一個發現，以及真正的事實

我在這裡回報過一個 AAAA 外洩：`address=/domain/<ipv4>` 只回答 A、同名的 AAAA 被轉發上游、因此 container 查 `traefik.me` 會被送去公開位址。我還為此在 image 裡加了一行 `local=/domain/`。

**它重現不出來，那個修改已經還原。** 我對著真實服務重新量測：把執行中 resolver 的 `local=` 行拿掉——正是「據說會外洩」的那個設定——並加上一個「轉發確實有效」的對照組：

```
對照組：dig AAAA google.com   →  2404:6800:4008:c1b::66 ...   （轉發正常）

只有 address=、沒有 local=：
  A      traefik.me            →  172.17.0.1
  AAAA   traefik.me            →  （沒有回答）
  TXT    traefik.me            →  （沒有回答）
  MX     traefik.me            →  （沒有回答）
  HTTPS  traefik.me            →  （沒有回答）

$ docker run --rm alpine:3.20 getent hosts traefik.me
172.17.0.1        traefik.me
```

`address=/domain/<ipv4>` 本身就已經讓 dnsmasq 對整個名稱具權威性：A 由它回答，其他型別一律 NODATA，什麼都不會送上游。加上 `local=/domain/` **沒有改變任何一種** record 型別——逐一量測、有無皆同。

**我是怎麼弄錯的**值得記下來，因為那是方法上的失誤，不是筆誤。最初那次讀數來自一個「前後對照」，而我在兩次量測之間同時改了兩件事：重建了 image**並且**重建了 container，所以「之前」與「之後」根本不是同一個 resolver。我沒有任何對照組證明轉發是通的，而「之後」的結果和「這個修改什麼都沒做」完全相容。上面那種單一變因的 A/B，給出的是相反的答案。

## `traefik.me` 真正的運作方式，而且它更重要

[traefik.me](https://traefik.me/) 是一個公開 DNS 服務，它**從名稱裡解出位址**：

| 名稱 | 公開回答 |
| --- | --- |
| `10.0.0.1.traefik.me`、`10-0-0-1.traefik.me` | `10.0.0.1` |
| `www.10.0.0.1.traefik.me` | `10.0.0.1` |
| `mysite.traefik.me` | `127.0.0.1` |
| `traefik.me` 本身 | GitHub Pages——該專案的說明網站 |

Runestone 附帶一張 `*.traefik.me` 憑證（由這台機器的 mkcert CA 本地簽發，不是該專案發的），因此在「每一張憑證的網域都變成一條 mapping」這條規則下，**整個 `traefik.me` zone 對這台機器上的每一個 container 都會被答成 Runestone 主機**：

```
$ docker run --rm alpine:3.20 getent hosts 10-0-0-5.traefik.me
172.17.0.1        10-0-0-5.traefik.me
```

那個位址應該要是 `10.0.0.5`。位址解碼正是這個服務存在的全部意義，而 Runestone 蓋掉了它——不是在開發者自己的機器上（主機的 resolver 完全沒被動到），而是在這台機器上的每一個 container 裡。

**其中一半其實是功能正常。** `mysite.traefik.me` 公開回答的是 `127.0.0.1`，那在 container 內部指的是 container 自己，所以沒有 mapping 的話，`traefik.me` 名稱從 container 裡根本沒用；有了 mapping，它才會打到 Traefik。這大概正是那張憑證存在的理由。

另一半則是沒有人選擇過的實際代價：container 再也不能用 `<ip>.traefik.me` 去連那個 IP。這不是 mapping 程式碼的 bug——這就是「每一張憑證的網域都變成一條 mapping」在憑證涵蓋一個萬用 DNS 服務時的必然結果。它該寫進使用者文件，而它[現在在那裡了](../../DNS.zh-TW.md)。

## `disable`，在真實重啟之後——Windows 留下沒驗的那一半

```
$ node bin/runestone dns disable --yes
  The dns key itself is removed, because Runestone created it and nothing else is left in it.
  The file is removed, because Runestone created it and nothing else is left in it.
  Docker restarted and answered again after 0s.
[ok] DNS is disabled. Runestone owns nothing in the Docker daemon configuration.

$ ls -l /etc/docker/daemon.json
ls: cannot access '/etc/docker/daemon.json': No such file or directory

$ docker run --rm alpine:3.20 cat /etc/resolv.conf | grep nameserver
nameserver 192.168.144.1
```

規格 9.2 第 4 步完整成立：檔案是 Runestone 建的，移除項目後剩下 `{}`，所以檔案也移除。`dns/custom.conf` 被保留，因為它是使用者的。兩個容器又一次自己回來了。

## `.env` 的回滾並不是它宣稱的那樣

失敗的執行會說「先前做過的都已還原」。但它其實是從「已合併旗標的 config」裡挑六個鍵寫回去——所以要還原一次失敗的 `--upstream 9.9.9.9`，寫回去的是 `9.9.9.9` 而不是使用者原本的值；而 `DNS_DAEMON_FALLBACK` 根本不在那份清單裡。在一台從未用過 DNS 的機器上，它也無法移除那些鍵，於是留下七行新內容，同時回報「什麼都沒變」。

現在它把檔案當文字快照、再當文字放回去——和 daemon 檔一樣的性質。

```
$ sha256sum ~/.runestone/.env | cut -c1-16
11255983189e409c
$ PATH=/tmp/fakebin:$PATH node bin/runestone dns enable --yes --no-restart --upstream 9.9.9.9
[error] ... nothing was written. Everything done before it was undone.
$ sha256sum ~/.runestone/.env | cut -c1-16
11255983189e409c
```

一模一樣，而且是在有旗標設定、舊回滾必定會留下痕跡的情況下。

## 這一輪順手修掉的小東西

- 提權寫入會叫 `sudo` 去 `mkdir -p` 一個已經存在的目錄，把提權花在一個 no-op 上；而當 sudo 拒絕時，還會把錯誤指向錯的步驟。
- DNS 路徑上有一句訊息寫著「正在 restart runestone container，讓 Docker Desktop 同步 dynamic config 變更」。讀取它的是 Traefik，不是 Docker Desktop；而且在這台機器上根本沒有 Docker Desktop 可以提。

## 還剩什麼

Linux 這邊沒有了。M6b 剩下的是 Windows 那項「真實 Docker Desktop 重啟之後的 `disable`」，它在[那份文件](m6b-windows-docker-desktop.zh-TW.md)裡被明確記為「刻意未驗證」，而不是宣稱已驗證。

有兩件關於這個環境的事，應該帶進 M8 而不是從這裡推廣：這是一台只有單一 Runestone 容器的 VM，所以重啟從來不必救回一大堆、或有狀態的容器；而「偵測到的上游是 `1.1.1.1`」是「原封不動的 systemd-resolved 主機」的性質，不是 Linux 的性質。

## 如何重現

為了跑這一輪，套件完全沒有發佈。原始碼被複製到 VM 上、在那裡建置、直接從 checkout 執行；DNS image 也是在本地建的，因為它還沒有進 registry：

```
git archive --format=tar -o rs.tar HEAD && scp rs.tar vm:/tmp/
ssh vm 'mkdir -p ~/rs && tar -xf /tmp/rs.tar -C ~/rs && cd ~/rs/runestone-cli && npm install && npx tsc'
ssh vm 'cd ~/rs && docker build -t cymondez/runestone-dns:1.0 docker/dns'
ssh vm 'cd ~/rs/runestone-cli && node bin/runestone dns status'
```

全域安裝的 `@developers-homelab/runestone-cli@1.0.1-beta.4` 原封不動、全程未使用；`node bin/runestone` 執行的是分支上的程式碼，不會動到它。
