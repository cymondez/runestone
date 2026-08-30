# Runestone DNS

[English](DNS.md) | 繁體中文 | [日本語](DNS.ja-JP.md)

這份文件說明 Runestone 的 DNS 功能做什麼、會改動你機器上的什麼，以及怎麼把它復原。**它比一般功能說明長，因為這個功能會改動全域狀態**：它會編輯 Docker daemon 的設定並重啟 Docker。在你開啟它之前，應該清楚知道那代表什麼。

如果你只想看結論：它讓你專案的網域在**容器內部**也能正確解析，代價是這台機器上每一個容器都要向一個 Runestone 容器問 DNS。它預設關閉，而 `runestone dns disable` 會把它移除。

## 目錄

- [它解決的問題](#它解決的問題)
- [啟用它會對你的機器做什麼](#啟用它會對你的機器做什麼)
- [開啟它](#開啟它)
- [檢查目前生效的設定](#檢查目前生效的設定)
- [關掉它](#關掉它)
- [手動移除那筆項目](#手動移除那筆項目)
- [出問題的時候](#出問題的時候)
- [設定](#設定)

## 它解決的問題

Runestone 讓你的專案擁有真實的網域與真實的憑證——`app.local.example.net`，而不是 `localhost:3000`。從瀏覽器看這是可行的，因為 Runestone 的憑證與 Traefik 路由已經把它處理好了。

但從**容器內部**看就不行。Runestone 網域在公開 DNS 上解析到 `127.0.0.1`，而在容器裡，`127.0.0.1` 就是容器自己。於是一個想連 `https://api.local.example.net` 的後端容器，連到的是自己的 loopback，拿到連線錯誤——或者更糟，連到某個剛好在那個埠上聽著的無關服務。

而這種失敗是安靜的。沒有任何東西會回報「這個網域解析到了錯的地方」；你得到的是一個連線錯誤，或是來自錯誤服務的錯誤答案，然後你會跑去找自己應用程式的 bug。

DNS 功能解決它的方式，是給容器一個「認得你的 Runestone 網域」的解析器。啟用之後，容器查 `api.local.example.net` 會拿到你主機的位址、連到 Traefik，然後就像你的瀏覽器一樣被正確路由。

## 啟用它會對你的機器做什麼

以下每一項，CLI 在真的改動任何東西之前都會再揭露一次，並帶入你實際的數值。這裡重述一遍，讓你可以在開始之前先讀。

### 1. 它會編輯 Docker daemon 的設定

Runestone 會在下列檔案的 `dns` 陣列裡加入一筆項目：

| 你的環境 | 檔案 |
| --- | --- |
| Docker Desktop（Windows、macOS） | `~/.docker/daemon.json` |
| 原生 Linux Docker Engine | `/etc/docker/daemon.json`（需要 `sudo`） |

那筆項目是容器用來連到你主機的位址——在 Docker Desktop 上通常是 `192.168.65.254`。它會被加在陣列的**最前面**，因為 daemon 是按順序詢問這些位址的，而 Runestone 必須被第一個問到。

Runestone 只編輯屬於自己的那些位元組。你原有的設定、它們的順序、你的縮排風格，都會保持原樣。

### 2. 必須重啟 Docker，而那會停掉每一個容器

Docker daemon 只在啟動時讀那個檔案。在 Docker 重啟之前，**那個變更完全不會生效**——這是刻意的，也正是 Runestone 把「寫入檔案」與「重啟」分開的原因。

重啟會終止**這台機器上的每一個容器**，包含與 Runestone 完全無關的容器：資料庫、訊息佇列，任何你正在跑的東西。restart policy 是 `always` 或 `unless-stopped` 的容器會自己回來；沒有 policy 的不會。

開始之前先看看你有什麼在跑：

```bash
docker ps
```

**在低於 4.86.0 的 Docker Desktop 上，它們不會全部回來。** 那些版本重啟的是整個應用程式，而應用程式關閉會把容器**停掉**——`unless-stopped` 的意思是「除非被停止，否則重啟」，於是它們就一直躺著，等再久也沒用。Runestone 會檢查版本，**低於 4.86.0 一律不自動重啟**，改為給出三條路：更新 Docker Desktop、透過它自己的 設定 → Docker Engine → Apply & restart 重啟、或執行 `runestone dns enable --restore-containers`，讓 Runestone 記下當時在跑的容器，並把重啟後沒回來的啟動回去。最後那條是選用的，永遠不是預設。

**如果 Docker 已經在發那個位址，就完全不會重啟。** Runestone 動手前會先確認，所以套用一個已經生效的設定——在你自己重啟、機器重開、或 Docker Desktop 更新之後——不會付出任何代價。

### 3. 之後每個容器的 DNS 都會經過一個 Runestone 容器

這是最容易被低估的代價。啟用之後，**這台機器上每一個容器的每一次 DNS 查詢**——不只是 Runestone 專案——都會送到 Runestone 的 `dns` 容器。

如果那個容器停了、正在被重建、或還在等 image 拉取，整台機器的容器都可能什麼都解析不到。唯一能緩解這件事的選項見 [備援設定](#11-備援項目)。

### 3a. 每一張憑證的網域都會在本機被回答，連同它的子網域

`dns` 容器會為你 Runestone `certs` 目錄裡的**每一張憑證**產生一條 mapping：該網域，以及它底下任意深度的每一個子網域。所以一張 `example.test` 的憑證，會讓 `example.test`、`app.example.test`、`a.b.c.example.test` 全部答成你主機的位址——對這台機器上的每一個 container 都是，不管那個名稱在公開網際網路上解析成什麼。

這正是這個功能本身。但當憑證涵蓋的是一個在公開網際網路上真實存在的網域時，這件事值得知道：在 container 內，公開的答案已經不再適用。

**`traefik.me` 就是會踩到的那個例子。** Runestone 附帶一張 `*.traefik.me` 憑證，而 [traefik.me](https://traefik.me/) 是一個「從名稱解出位址」的公開 DNS 服務——`10.0.0.1.traefik.me` 與 `10-0-0-1.traefik.me` 都解析到 `10.0.0.1`，其餘名稱則解析到 `127.0.0.1`。

| 從哪裡查 | `mysite.traefik.me` | `10-0-0-5.traefik.me` |
| --- | --- | --- |
| 你的主機（Runestone 完全沒動） | `127.0.0.1` | `10.0.0.5` |
| container 內、DNS 已啟用 | 你主機的位址 | **你主機的位址**，不是 `10.0.0.5` |

[DOMAINS.zh-TW.md](DOMAINS.zh-TW.md) 有完整說明：Runestone 會碰到的三種 domain 各自的機制，以及為什麼這一種是異類。

第一欄正是我們要這條 mapping 的理由：`127.0.0.1` 在 container 內指的是 container 自己，所以沒有它的話，`traefik.me` 名稱從 container 裡根本沒用。第二欄則是代價：container 再也不能用 `<ip>.traefik.me` 去連那個位址。如果你需要那個用法，就把 `traefik.me.crt` 從 certs 目錄移掉，或在 `dns/custom.conf` 裡加上你自己的規則——那個檔案 Runestone 永遠不會覆寫。

### 4. 主機的 53 埠會被佔用

`dns` 容器會發佈 53 埠，**TCP 與 UDP 都要**。如果你機器上已經有別的東西佔著它，服務就起不來——而 Runestone 會在碰到 daemon 設定之前就告訴你。

### 5. `runestone stop` 刻意保留 DNS 服務執行

`runestone stop` 會停止 Runestone 環境，但**讓 `dns` 容器繼續跑**。這不是漏掉了：Docker daemon 正指著它，停掉它會讓這台機器上每一個容器的名稱解析壞掉。

要連它一起停：

```bash
runestone stop --all
```

那會讓 DNS 在整台機器上失效，直到它重新啟動。Runestone 會在動手之前先警告你。

### 6. 移除 Runestone 之前先停用

如果你在 DNS 還啟用的狀態下把 Runestone 刪掉，Docker daemon 就會留著一個指向「已經不存在的容器」的設定。這台機器上每一個容器都會解析不到任何東西，而機器上沒有任何東西會解釋為什麼。

**移除 Runestone 之前，一定要先執行 `runestone dns disable`。** 如果已經來不及了，見[手動移除那筆項目](#手動移除那筆項目)。

### 7. 停用只會移除 Runestone 加進去的東西

Runestone 會精確記錄自己插入了哪些項目。`runestone dns disable` 只移除那些，其他一個都不動——所有其他項目的值與位置都保持原樣。

如果它無法確定哪一筆是自己的——因為檔案被手動改過，或因為同一個位址出現超過一次——**它什麼都不移除，並且說出來**，而不是靠猜然後刪掉一個你依賴的解析器。這時你可以明確告訴它：

```bash
runestone dns disable --assume-entry 192.168.65.254
```

### 8. DNS 網頁介面預設沒有驗證

Runestone 會在 `https://dns.<你的網域>` 提供一個小型網頁介面，用來編輯你自己的 dnsmasq 規則。**在 `DNS_UI_USER` 與 `DNS_UI_PASS` 都沒設定的情況下，它完全沒有驗證**——任何能從 HTTPS 連到這台機器的人都能改你的 DNS 規則。

兩個都設定，或是把介面關掉：

```dotenv
DNS_UI_ENABLE=false
```

### 10. 不是 Runestone 網域的查詢都會轉發到上游

`dns` 容器自己回答 Runestone 網域，其餘全部轉發給上游解析器。也就是說，**這台機器上每一個容器的每一次一般網際網路查詢，都會經過你在這裡設定的伺服器。**

這份清單永不為空——一個都沒有的話，容器會完全失去對外的名稱解析。Runestone 會先看你的 Docker daemon 設定、再看你主機自己的解析器，只有在什麼都推不出來的時候才退回公用的 `1.1.1.1`。它會告訴你發生的是哪一種，以及每個值是從哪裡來的。

多個值是一個**集合，不是優先順序**：dnsmasq 會偏好回應最快的那一個。如果你需要照順序嘗試，請在你自己的 `dns/custom.conf` 加上 `strict-order`，那個檔案 Runestone 永遠不會覆寫。

### 11. 備援項目

預設關閉。當你設定 `DNS_DAEMON_FALLBACK` 時，Runestone 會在自己那筆的緊接著後面加入**第二筆**項目，讓 daemon 還有別的地方可以問。

兩個方向都重要：

| | 備援關閉（預設） | 備援開啟 |
| --- | --- | --- |
| DNS 服務執行中 | 沒有差別 | 沒有差別 |
| DNS 服務停擺時 | 查詢立即而明顯地失敗，原因一目瞭然 | 一般網際網路名稱仍可解析，對這台機器上每一個容器都是 |
| 服務停擺時查 Runestone 網域 | 失敗 | **解析到 `127.0.0.1`**——最初那個問題又回來了 |

所以開啟它換到的是「無關專案的韌性」，付出的是「讓 DNS 停擺一眼就看得出來的那種大聲失敗」。Runestone 的建議：

- **這台機器同時跑著與 Runestone 無關的專案容器** → 通常應該開啟。那些專案不該因為一個 Runestone 容器停了就失去對外 DNS。
- **主要用於 Runestone 開發的機器，而且希望 DNS 一壞就立刻看得出來** → 通常應該關著。
- **不確定** → 先關著。之後要開啟，成本只是再一次 daemon 寫入與再一次 Docker 重啟，沒有別的。

`runestone dns enable` 在規劃任何事情之前，會先問你這一題，也會問上游清單那一題——就是 `runestone setup` 問的同兩題，所以改變主意不代表要再跑一次 setup。

若不想被問，可以在 `.env` 設定，也可以直接在指令上給：

```bash
runestone dns enable --fallback 1.1.1.1
```

```bash
runestone dns enable --no-fallback
```

給了旗標就等於回答了那一題，那一題便不再問；`--yes` 則是全部都不問，這正是它能用在腳本裡的原因。不論用哪一種方式回答，值都會被寫進 `DNS_DAEMON_FALLBACK`，所以「生效的值」永遠是你讀得回來的那個。

因為它會問，這個指令需要終端機。不在終端機裡時——例如在管線中、在 CI 裡——它會停下來叫你加 `--yes`，而不是在沒有你同意的情況下逕行動手。

## 開啟它

`runestone setup` 會問你要不要 DNS，並把你的答案記下來。**setup 不會啟用它**——它從不碰 Docker daemon 設定。啟用是它自己的指令，這樣它需要的那兩道確認，才會屬於一個你為了這件事而下的指令。

在什麼都不改的情況下，先看會變成什麼樣：

```bash
runestone dns enable --dry-run
```

那會印出帶有你實際數值的完整揭露，以及 `dns` 陣列精確的前後對照，然後在什麼都沒寫的狀態下結束。

啟用它：

```bash
runestone dns enable
```

它會問兩次，而這兩個問題是不同的。第一個是「同意編輯 daemon 設定」。第二個是「同意重啟 Docker」，也就是會停掉你容器的那一步。答應第一個並不等於承諾第二個。

在寫入任何全域內容之前，它會確認 Docker 連得上、算出容器該用的位址、啟動 DNS 服務，然後**向那個服務問一個真實的問題**來確認它答得正確。所有可能失敗的事，都在你機器的全域 DNS 被碰到之前失敗。

### 現在寫入，稍後再重啟

```bash
runestone dns enable --no-restart
```

這會寫入 daemon 設定然後停手。在你自己重啟 Docker 之前，什麼都不會生效——時間由你決定。`runestone dns status` 會一直告訴你變更已寫入、正在等待。

## 檢查目前生效的設定

```bash
runestone dns status
```

它只讀取——從不改動任何東西。它會回報 daemon 設定的路徑、Runestone 的每一筆項目實際坐在陣列的哪個位置、容器解析到的位址、上游清單以及每個值的來源、備援是否開啟，以及網頁介面有沒有驗證。

`runestone doctor` 在 DNS 啟用時也會回報 DNS：Runestone 的項目是否仍在最前面、服務是否在跑、位址是否仍然吻合、網域對應是否是最新的。**`doctor` 只回報**——它不會編輯你的 daemon 設定，因為「哪一筆項目屬於 Runestone」不是一個診斷指令該用猜的。

## 關掉它

```bash
runestone dns disable
```

它會移除 Runestone 記錄為自己所有的那些項目、重啟 Docker 讓移除生效，然後停止並移除 `dns` 容器。你自己的 `dns/custom.conf` 會保留——那是你的。

想先看它會做什麼：

```bash
runestone dns disable --dry-run
```

`runestone down` 也會在拆除環境之前自動停用 DNS，而且如果停用失敗，它會**中止並且什麼都不移除**——因為在 daemon 還指著它的時候移除 `dns` 容器，正是這個功能存在要防止的那種失敗。

## 手動移除那筆項目

如果 Runestone 已經不在了，或它的所有權記錄遺失了，你可以自己把那筆項目移除。這件事沒有任何魔法——它就是一個 JSON 陣列裡的一個字串。

1. 打開 daemon 設定檔：
   - Docker Desktop：`~/.docker/daemon.json`
   - 原生 Linux：`/etc/docker/daemon.json`（需要 `sudo`）

2. 找到 `dns` 陣列。它大概長這樣：

   ```json
   {
     "dns": ["192.168.65.254", "1.1.1.1"],
     "experimental": false
   }
   ```

3. 移除 Runestone 加進去的那個位址——在 Docker Desktop 上通常是 `192.168.65.254`，在原生 Linux 上是 docker0 gateway，例如 `172.17.0.1`。**其他每一筆都不要動。** 如果移除之後陣列變成空的，你可以把整個 `dns` 鍵刪掉。

4. 重啟 Docker 讓它重新讀取檔案：

   ```bash
   docker desktop restart
   ```

   在原生 Linux 上：

   ```bash
   sudo systemctl restart docker
   ```

   兩者都不管用的話，就用你平常的方式重啟 Docker。**這個編輯只有在重啟之後才生效**，所以在那之前什麼都沒有改變。

5. 確認新建立的容器已經不再被指向它：

   ```bash
   docker run --rm alpine cat /etc/resolv.conf
   ```

## 出問題的時候

### DNS 服務起不來：53 埠被佔用

你機器上有別的東西佔著 53 埠。Runestone 判定這件事的方式是「試著啟動服務」，而不是讀 `netstat`——一個埠可能看起來空著卻不能用，也可能看起來被佔了卻還是能用，而且 TCP 與 UDP 的答案還可能不一樣。

**在 Windows 上，這通常是 Internet Connection Sharing 服務**，而啟用它的是 WSL2。它佔著 `0.0.0.0:53/udp`。Runestone 發佈 53 埠的寫法是能與它並存的那一種，所以通常沒問題——但如果你自己設定過 `DNS_BIND_IP`，試著把它清空。

其他常見的佔用者：Linux 上的 `systemd-resolved`（它佔著 `127.0.0.53`）、Pi-hole、dnsmasq，或另一個本機 DNS 伺服器。

看看是誰佔著它：

```bash
netstat -ano | findstr :53
```

在 Linux 上：

```bash
sudo ss -ulpn 'sport = :53'
```

### 容器什麼都解析不到

先看 DNS 服務是否在跑：

```bash
runestone dns status
```

沒在跑就啟動它：

```bash
runestone up
```

如果你弄不起來，而現在就需要機器可以用，那就停用 DNS：

```bash
runestone dns disable
```

也可以考慮 [備援設定](#11-備援項目)，讓這件事不會再發生。

### Runestone 的項目不在最前面了

有別的東西把自己的項目插到了 Runestone 前面。daemon 是按順序詢問的，所以 Runestone 可能不再是第一個被問到的，你的網域也就可能停止解析。

`runestone dns status` 與 `runestone doctor` 都會回報實際位置。預設情況下 Runestone **只警告、不改動**，因為在沒有被要求的情況下重排別人的設定不是它該做的事。要讓它在每次 `runestone up` 時把自己的項目移回最前面：

```dotenv
DNS_AUTO_REORDER=true
```

它只移動自己的項目、絕不動別人的，而且從不為此重啟 Docker——那個變更會在你下次重啟 Docker 時生效。

### daemon 設定寫進去了，但什麼都沒生效

那正是 `--no-restart` 之後、以及任何「重啟沒有完成」的執行之後應有的狀態。`runestone dns status` 會這樣告訴你。重啟 Docker 它就會生效。

### 重啟失敗，機器處在奇怪的狀態

當重啟或驗證失敗時，Runestone 會反向還原自己的變更，而且**它是先寫好修正後的檔案、才再重啟一次**——所以即使第二次重啟也失敗了，磁碟上的檔案已經是正確的，Docker 下次啟動時就會讀到它。

如果你最後拿到的是一個你不信任的檔案，就[手動移除那筆項目](#手動移除那筆項目)。每一則失敗訊息都會印出精確的路徑。

## 設定

以下全部放在你的 Runestone `.env` 裡。

| 設定 | 預設 | 作用 |
| --- | --- | --- |
| `DNS_ENABLE` | `false` | DNS 是否開啟。**由 `dns enable` / `dns disable` 管理**——手動設定它不會啟用或停用任何東西，只會讓 Runestone 的回報與現實不一致 |
| `DNS_HOST_IP` | *(自動偵測)* | 容器把 Runestone 網域解析到的位址。由 Runestone 管理 |
| `DNS_BIND_IP` | *(自動偵測)* | 53 埠綁定到主機的哪個位址。空值或 `0.0.0.0` 代表全部介面 |
| `DNS_UPSTREAM` | *(自動偵測)* | 以逗號分隔的上游解析器。空值代表先偵測，再退回 `1.1.1.1` |
| `DNS_DAEMON_FALLBACK` | *(空)* | 第二筆 daemon 項目。空值代表關閉。見[第 11 項](#11-備援項目) |
| `DNS_AUTO_REORDER` | `false` | 是否在每次 `up` 時把 Runestone 自己的項目移回最前面 |
| `DNS_CONTAINER_RESOLVER` | *(自動偵測)* | DNS 容器自己使用的解析器 |
| `DNS_UI_ENABLE` | `true` | 是否把 `https://dns.<你的網域>` 路由到網頁介面 |
| `DNS_UI_USER` | *(空)* | 網頁介面使用者名稱。未設定代表**沒有驗證** |
| `DNS_UI_PASS` | *(空)* | 網頁介面密碼。未設定代表**沒有驗證** |

`.env` 裡還會出現 `DNS_BIND_PREFIX`。它是為了 Compose 檔而從 `DNS_BIND_IP` 推導出來的；要改請設 `DNS_BIND_IP`。

### 你自己的 dnsmasq 規則

你 Runestone 目錄下的 `dns/custom.conf` 是你的。Runestone 只會建立它一次，而且**永遠不會覆寫它**。可以在裡面放你自己的 `address=` 或 `server=` 設定，或是在需要讓上游照順序嘗試時加上 `strict-order`。

Runestone 產生的另外兩個檔案——`dnsmasq.conf` 與 `managed.conf`——只存在於容器內部，而且每次啟動都會重新產生。你碰不到它們，也不需要碰：每次啟動產生出來的就是正確的，完全不依賴 CLI 有沒有跑過。
