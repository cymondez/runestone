# Runestone 的 domain 是怎麼解析的

*English: [DOMAINS.md](DOMAINS.md)*

Runestone 會碰到三種不同性質的 domain，它們的行為差異很容易搞錯。這份文件記錄每一種**實際上**在做什麼——量測來的，不是推測來的——以及 DNS 功能（[DNS.zh-TW.md](DNS.zh-TW.md)）對它們做了什麼。

**在你改動任何「會把 domain 對應到某個位址」的程式之前，請先讀這份。** 最後一節列出各種陷阱，其中一個已經真的害人犯過錯。

本文所有數據都是 2026-08-29 對公開 resolver 與一台真實的 Docker Engine 29.5.3 主機量測的結果。

## 三種 domain

### 1. Runestone domain——`HOST_DOMAIN`，預設 `local.developers-homelab.net`

| 名稱 | 公開 A | 公開 AAAA |
| --- | --- | --- |
| `local.developers-homelab.net` | *（沒有）* | *（沒有）* |
| `app.local.developers-homelab.net` | `127.0.0.1` | *（沒有）* |

一個真實註冊的 domain，它的萬用記錄指向 loopback。它就只做這件事：後面沒有任何服務，apex 甚至完全沒有記錄。

它之所以能用，是因為你的瀏覽器跑在主機上，而在主機上 `127.0.0.1` 就是主機——所以 `app.local.developers-homelab.net` 會打到 Traefik，再由本地簽發的憑證讓它是 HTTPS。除了那條萬用記錄之外，它沒有任何特別之處。

### 2. `traefik.me`——一個會自己算出答案的 domain

這一個是真的不尋常，所以它值得自己一節。[traefik.me](https://traefik.me/) 跑著一台 DNS 伺服器，它會**從名稱裡把位址取出來**：

| 名稱 | 公開 A | 公開 AAAA |
| --- | --- | --- |
| `traefik.me` | `185.199.108.153` … | `2606:50c0:8000::153` … |
| `mysite.traefik.me` | `127.0.0.1` | *（沒有）* |
| `10-0-0-5.traefik.me` | `10.0.0.5` | *（沒有）* |
| `10.0.0.5.traefik.me` | `10.0.0.5` | *（沒有）* |
| `www.10.0.0.5.traefik.me` | `10.0.0.5` | *（沒有）* |

由此推出三件事，而且每一件都絆倒過人：

- **apex 不屬於這個機制。** `traefik.me` 本身是該專案的說明網站，架在 GitHub Pages 上，有一般的公開 A 與 AAAA 記錄。它不是 `127.0.0.1`，從來都不是。
- **位址可以出現在名稱的任何位置**，用點或用連字號都行，前面還可以再掛標籤。`www.10.0.0.5.traefik.me` 是「`10.0.0.5`」的一種合法寫法。
- **名稱裡沒有位址時，答案是 `127.0.0.1`。** 這正是 Runestone 使用者實際會用到的情況，也是 `runestone setup` 會為 `*.traefik.me` 產生萬用憑證的理由。

### 3. 任何你自己簽了憑證的 domain

`runestone certs create <domain>` 完全願意為一個在公開網際網路上真實存在的名稱簽憑證。Runestone 不會去檢查，也不該檢查：開發者把 `app.mycompany.com` 指向自己的機器，是完全正當的做法。

## DNS 功能對每一種做了什麼

`dns` 容器會為**憑證裡帶的每一個 DNS 名稱**寫一條 mapping，名稱是從憑證本身讀出來的，形式是 `address=/<domain>/<target-ip>`，而它涵蓋該 domain **以及它底下任意深度的每一個子網域**。萬用名稱與它的基底對應到同一個 zone：`*.example.test` 與 `example.test` 都是 `address=/example.test/<target-ip>`。

| 種類 | 效果 | 評價 |
| --- | --- | --- |
| 1. Runestone domain | container 會解析到主機，而不是解析到自己 | 這正是它存在的目的 |
| 2. `traefik.me` | `mysite.traefik.me` 從 container 變成可用——**同時 `<ip>.traefik.me` 不再代表那個位址** | 一半是功能，一半是代價 |
| 3. 你自己的 domain | 那個 domain 對這台機器上每一個 container 都會在本機被回答 | 是預期行為，但要講清楚 |

第 1 種和第 2 種需要這條 mapping 的理由是同一個：它們的公開答案是 `127.0.0.1`，而在 container 內部，`127.0.0.1` 指的是 container 自己。沒有 mapping，這個名稱從 container 裡毫無用處；有了 mapping，它才會打到 Traefik。

代價只集中在第 2 種，而且是實實在在的：container 再也不能用 `10-0-0-5.traefik.me` 去連 `10.0.0.5`，因為整個 zone 現在都答成 Runestone 主機。要保留位址解碼的用法，就把 `traefik.me.crt` 與 `traefik.me.key` 從 certs 目錄移掉，或在 `dns/custom.conf` 裡寫自己的規則——那個檔案 Runestone 永遠不會覆寫。

## 只支援 IPv4，以及為什麼

**這是一開始就下的範圍決策，不是實作剛好長成這樣。**

IPv4 是最大公約數：Runestone 面向的每一種環境都有它，而且行為都一樣。IPv6 不是這樣——它到底存不存在，取決於主機、取決於網路，也取決於 Docker 自己啟動時有沒有開啟；而這幾項在每個開發者的機器上都可能不同。要支援它，就等於要支援那整個矩陣。**所以這個套件只針對 IPv4 場景**，這是刻意的，為的是不讓一個本機開發工具去繼承一整類它沒有理由承擔的複雜度。DNS 功能只是這個決策最看得出來的地方。

它是一條邊界，不是等著被補上的缺口。想移動這條邊界的人，該從「我現在要承諾支援哪些環境」開始問，而不是從「我來加一筆 AAAA 回答」開始。

### 這個決策在實作裡長什麼樣

1. **Target IP 在設計上就是 IPv4**——`getent ahostsv4 host.docker.internal`，在 container 內執行（規格 10.1）。
2. **daemon 項目、綁定位址、發佈的埠，全都是 IPv4**——daemon `dns` 陣列裡的位址、綁定用的 `172.17.0.1` 或 `0.0.0.0`、`53/tcp` 與 `53/udp`。
3. **`address=/domain/<ipv4>` 只回答 A，其他一律不回答。** 其餘每一種 record 型別都是 NODATA，而且都不會被轉發上游。逐一型別量測：

   ```
   A      traefik.me  →  172.17.0.1
   AAAA   traefik.me  →  （沒有回答）
   TXT    traefik.me  →  （沒有回答）
   MX     traefik.me  →  （沒有回答）
   HTTPS  traefik.me  →  （沒有回答）
   ```

   同時查兩種的 client 會採用那筆 A。**這是正確行為，不是外洩。**
4. **在預設安裝下，container 根本就沒有 IPv6**：

   ```
   $ docker network inspect bridge --format '{{.EnableIPv6}}'
   false
   $ docker run --rm alpine:3.20 ip -6 addr show eth0 | grep -c inet6
   0
   ```

   所以就算回答了 AAAA，那個答案也沒有任何路可以走。

### 這對之後要擴充的人代表什麼

Docker 的 IPv6 是**要自己開、而且與主機環境高度相關**的功能，這正是它被列為「不在範圍內」而不是「半支援」的原因。如果你把它打開（daemon 設定裡的 `"ipv6": true`，或一個啟用 IPv6 的網路），以下每一件事都**從來沒有被量測過**，一件都不該假設：

- daemon 會不會在我方之外，另外再給 container 一個 IPv6 resolver，以及順序是什麼；
- 我方發佈在 docker0 gateway 上的 `53`，透過 IPv6 到底連不連得到；
- 當 container 真的有 IPv6 之後，被 mapping 的 domain 對 AAAA 應該回答什麼——到那個時候，`NODATA` 就不再是顯然正確的答案了；
- `DNS_UPSTREAM` 填 IPv6 位址：**CLI 的驗證目前會接受這種文字**，而這個功能從來沒有走過那條路。dnsmasq 連不連得到那個上游，取決於 container 有沒有 IPv6，而預設是沒有。

以上一律視為未定。要主張任何一條，先去量。

## 陷阱

會寫下來，是因為每一條都已經被踩到、或差一點被踩到。

- **`certs/` 裡有一張憑證，不代表那個 domain 在公開網路上是惰性的。** `traefik.me` 的 apex 有真實的公開記錄，底下還會算出答案。以為「這是本地開發用的 domain，外面應該什麼都沒有」，就會整段推理都在講錯的東西。
- **`address=/domain/ip` 本身就已經對整個名稱具權威性。** 在它旁邊再加 `local=/domain/` 不會改變任何事——已逐一型別驗證，並附有「轉發確實有效」的對照組。會有人想加它；那是個 no-op。（這條不是假設：2026-08-29 有人為了修一個並不存在的 AAAA「外洩」而加了它，當天又還原。完整的撤回記錄在 [`evidence/dns/m6b-linux-native.zh-TW.md`](evidence/dns/m6b-linux-native.zh-TW.md)。）
- **mapping 涵蓋任意深度的子網域。** 一張 `example.test` 的憑證會連 `a.b.c.example.test` 一起帶走。碰上萬用 DNS 服務時，那代表整個服務。
- **要主張 DNS 行為時，`getent` 與 busybox `nslookup` 是錯的工具。** 它們會把 A 與 AAAA 混在一起，也看不出是哪一台 resolver 回答的。請用 `dig`，明講 record 型別，也明講伺服器。
- **名稱來自憑證內容，不是來自檔名。** `rootCA.crt` 依檔名排除，其餘每個 `*.crt` 都會被打開、讀出它的 `DNS:` 名稱，不是合法 domain 的名稱會被跳過並回報，無法解析的檔案直接跳過而不回退到檔名。所以一張憑證可能產生好幾條 mapping，而一個以某 domain 命名、實際上卻沒有帶那個名稱的檔案，不會為它產生任何 mapping。
