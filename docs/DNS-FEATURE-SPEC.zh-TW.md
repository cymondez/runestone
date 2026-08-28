# Runestone DNS 功能規格書

[English](DNS-FEATURE-SPEC.md) | 正體中文

## 1. 文件定位

- 狀態：草案，待 review。
- 本文件取代 commit `8dc30c8` 的舊版 `docs/DNS-FEATURE-SPEC.md`，舊版作廢。
- 本文件描述「要做什麼」與「為什麼這樣做」；函式切分等實作細節由實作階段決定。
- **本功能是必要之惡**：它修改的是不屬於 Runestone 的全域 Docker 設定。§2 先交代代價與由代價推導出的設計約束，後續章節都是那些約束的展開。實作時若要偏離某條約束，請回到 §2.4 確認該代價由什麼補償。
- 撰寫時已在 Windows 11 + Docker Desktop 29.6.2（context `desktop-linux`）實測，實測結論標記為「實測」，未驗證者標記為「待驗證」。
- **§16 是里程碑與風險管控計畫，不是附錄。** 由於啟用這個功能會改動機器的全域狀態，實作順序本身就是一種安全機制：實作依 16.3 進行，且不得提前拉高 16.1 的風險等級。

## 2. 要解決的問題

### 2.1 一個 URL，兩種語意

Runestone 用「公開 wildcard DNS 指向 `127.0.0.1`」換來「使用者不必改 hosts 檔」。實測 `api.local.developers-homelab.net` 解析結果為 `127.0.0.1`。

這個交換在瀏覽器端完全成立 — 127.0.0.1 正是 Traefik 綁 80/443 的位置。但在 container 內，127.0.0.1 是該 container 自己的 loopback。於是**同一個 hostname 在兩種情境下語意不同**：瀏覽器連得到，container 連到自己。

真正的痛點不是「container 連不到」，而是它打在 Runestone 存在的理由上。`DESIGN.md` 的目標使用者要測的正是 HTTPS、cookie、OAuth redirect、webhook 與跨子網域行為，而這些場景都要求**瀏覽器與伺服器端使用完全相同的 URL**：

- OAuth / OIDC 的 issuer 與 redirect URI 必須與瀏覽器看到的一致。
- cookie domain、SSR 前端的 base URL、專案之間的 webhook 呼叫。

要使用者改用 `http://backend:3000` 就等於要他放棄測這些行為。因此本功能要解決的是：**讓同一個 hostname 在瀏覽器與 container 內都成立。**

### 2.2 為什麼非得動 Docker daemon 設定

container 層的解法都存在也都可行，但有共同的致命傷：

| 做法 | 為什麼不夠 |
| --- | --- |
| 每個專案寫 `extra_hosts: <domain>:host-gateway` | 要每個專案逐一列舉每個會用到的 domain，新增 domain 就得回頭改所有專案；wildcard 子網域無法涵蓋。 |
| Docker network alias | 解析到 container IP，**繞過 Traefik** — TLS 終結、路由規則、憑證全部失效。URL 一樣但行為不一樣。 |
| 每個專案寫 `dns: [<gateway ip>]` | 同樣是逐專案設定，且 host-gateway IP 是機器特有值，不能 commit 進共享 repo。 |
| 改用 container 服務名（`http://backend:3000`） | 放棄 2.1 所列的所有測試場景。 |

共通點是**都要求每個專案自己配置**，這與 Runestone 的核心價值（專案只要接上網路、加 Traefik label）直接衝突。

`dns` daemon 設定是唯一「設定一次、對全機所有 container 生效、且不需要修改任何專案設定」的鉤子。沒有第二個位置能達成同一件事。

### 2.3 做法

在主機上跑 dnsmasq，把 Runestone 憑證涵蓋的 domain 一律回答為 `host.docker.internal` 的 IPv4 位址，並將該位址插入 Docker daemon `dns` 陣列最前面，讓所有 container 的查詢先經過它。

### 2.4 這是必要之惡：代價清單

本功能的實作方式帶有以下無法迴避的代價，設計上只能縮小、不能消除：

1. `daemon.json` **不是 Runestone 的檔案**。使用者與其他工具都會寫它，我們是在修改共享且不屬於自己的全域狀態。
2. 生效需要**重啟 Docker daemon**，這會終止全機所有 container，包含與 Runestone 無關的專案。
3. 生效後**全機每個 container 的名稱解析都依賴一個 Runestone 容器**。不知道這個功能存在的人，會遇到與 Runestone 看起來毫無關聯的故障。
4. 必須佔用 **53 port**，而 systemd-resolved、ICS、Pi-hole、VPN client 都可能已在使用。
5. 位置有意義（必須是 `dns[0]`），所以修改的是**共享陣列的順序** — 最難乾淨還原的一類修改。
6. daemon 路徑、重啟方式、可綁定位址**每個平台都不同**，故障半徑也不同。
7. 使用者若未先停用就移除 Runestone，會留下一台 Docker DNS 指向不存在容器的機器，**且難以追溯原因**。

### 2.5 因此不可妥協的設計約束

下表的每一條都是為了讓 2.4 的代價可控，不是風格偏好。後續章節是它們的展開。

| 代價 | 對應約束 | 章節 |
| --- | --- | --- |
| 修改不屬於自己的檔案 | 預設關閉；唯一動作是在最前面插入我方自己的項目——一筆，或啟用 9.7 的選用備援時兩筆；不搬移、不去重、不改寫任何既有項目 | 7.1、9.1、9.7 |
| 使用者會在啟用期間繼續改這個檔案 | 只認自己插入的那一筆；使用者的新增、排序與格式一律保留；要不要自動排序由使用者決定，預設不動 | 9.5、9.6 |
| 難以還原 | 先記錄自己做了什麼再動手；還原時只移除該筆、不做位置還原；記錄遺失即中止不猜；絕不用整檔備份覆蓋 | 7.3、9.2、9.3 |
| 重啟會終止全機 container | 重啟前必須取得確認；所有前置檢查在修改全域狀態之前完成 | 10.1、11 |
| 全機依賴單一容器 | `restart: unless-stopped`；`stop` 不停 dns；`down` 先撤銷再拆除；9.7 的選用備援讓使用者能在 dns 停止期間維持一般網際網路解析 | 8.2、9.7、10.2、10.4 |
| 症狀離原因很遠 | `dns status` 與 `doctor` 需顯示所有權狀態與 daemon 現況；文件提供手動解除步驟 | 10.3、10.4 |
| 使用者必須清楚自己同意了什麼 | 每次動全域狀態之前具體揭露（帶實際路徑與 IP）；`--yes` 不略過揭露 | 11.2、11.3 |
| 任何一步可能失敗 | 每個變更都配對回滾，失敗自動還原，不留半套狀態 | 10.1、12 |

明確**不支付**的代價：不修改主機 OS 的 resolver 設定、不改動使用者的 `dns` 項目內容與順序（既有的與啟用期間新增的都一樣）、不要求任何專案修改設定、不在操作失敗時保留 Runestone 的改動。

## 3. 範圍

### 3.1 包含

- 獨立的 `dns` compose 服務（dnsmasq + webproc UI），使用 Runestone 自建的 multi-arch runestone-dns image。
- `runestone dns enable | disable | status`。
- `runestone setup` 的 DNS 開關、上游 DNS、選用的 daemon 備援項目與自動排序設定，以及對應的風險揭露。
- Docker daemon `dns` 陣列的所有權記錄、精準撤銷、Target IP 變更調和。
- 由憑證清單產生 dnsmasq mapping，並整合 `up` / `stop` / `down` / `certs` / `doctor`。
- Windows（Docker Desktop）、WSL2（Docker Desktop endpoint）、macOS（Docker Desktop）、Linux（rootful Docker Engine）。

### 3.2 不包含

- 修改主機作業系統本身的 DNS 設定。
- Remote Docker context、Windows container 模式、無法綁定 53 port 的 rootless Docker。
- IPv6 host-gateway 解析（只處理 IPv4）。
- 讓使用者更換 DNS image。Runestone 固定使用自家 image，不開放覆寫，避免相容性處理失控。

## 4. 名詞

| 名詞 | 定義 |
| --- | --- |
| Runestone | 整個專案：CLI、image 與本機開發環境的總稱。 |
| runestone image | 主 image `cymondez/runestone`，內含 Traefik、Mailpit、nginx、mkcert。 |
| runestone-dns image | DNS 專用 image `cymondez/runestone-dns`，內含 dnsmasq 與 webproc。 |
| dns 服務 | compose 中的服務名 `dns`，容器名 `${PREFIX}-dns`，使用 runestone-dns image。 |
| Target IP | 從 Docker 環境解析 `host.docker.internal` 得到的 **IPv4** 位址。實測 Docker Desktop 為 `192.168.65.254`；Linux 原生為 docker0 gateway（通常 `172.17.0.1`）。 |
| Bind IP | dns 服務在主機發佈 53 port 所綁定的位址，與 Target IP 不一定相同，見 6.1。 |
| Owned entry | Runestone 寫入 daemon `dns` 陣列並記錄在所有權狀態中的項目。 |
| Managed mapping | Runestone 依憑證清單自動產生的 dnsmasq `address=` 規則。 |
| Custom rules | 使用者自行維護的 dnsmasq 規則，Runestone 永不覆寫。 |

## 5. 架構

```text
其他專案的 container
      │ DNS 查詢
      ▼
Docker daemon dns[0] = Target IP
      │
      ▼
主機 Bind IP:53 (tcp+udp)  ──►  dns container（runestone-dns）
                                  ├─ dnsmasq :53
                                  └─ webproc :8080（僅容器網路內）
                                          ▲
                          Traefik ────────┘  https://dns.<HOST_DOMAIN>
```

### 5.1 為什麼是獨立服務

Traefik、Mailpit、nginx 合併在 runestone image 是為了管理方便 — 它們是這個環境「一定會有」的核心。DNS 不同：

- 它是依使用者需求開關的**選用功能**，沒開的人不該被迫跑一個佔用 53 port 的行程。
- 它對 Docker daemon 有**侵入性改動**，出問題時必須能單獨停用、單獨排查、單獨回復，不能跟核心服務綁在一起。

更根本的差別是**故障半徑**：Traefik 掛掉只影響 Runestone 自己的路由；dns 一旦寫進 `daemon.json`，就成為全機每一個 container 的名稱解析依賴，包含與 Runestone 無關的專案。兩者差一個數量級，不該共用同一個重啟命令。

因此 dns 是獨立的 compose 服務、獨立容器、獨立生命週期、獨立 image。以下三條約束由此推導，而在合併架構下無法表達：

1. `runestone stop` 停主服務但保留 dns（見 10.4）— 同一個容器無法「只停一半」。
2. `runestone down` 先撤 daemon 設定、撤不掉就中止（見 10.2、10.4）— 需要 dns 存活與主服務拆除是可獨立排序的兩步。
3. 53 port 綁不上時只有 dns 起不來，Traefik 與 Mailpit 不受影響（見 6.1）。

另外，開關語意由 compose profile 這種宣告式機制表達，比 entrypoint 內的 shell 分支可靠（commit `3581211` 那段判斷寫反正是這類分支的典型風險）；dnsmasq 的版本演進節奏也不該被綁在 runestone image 的 tag 上。

### 5.2 runestone-dns image 決策

自建 **`cymondez/runestone-dns`**，放在 `docker/dns/`：

- 基底 Alpine，`apk add dnsmasq`，加上 pinned webproc（依 `TARGETARCH` 取對應的 release 檔）。
- **必須同時提供 `linux/amd64` 與 `linux/arm64`**，Apple Silicon 要能原生執行，不靠模擬。
- 不使用現成的 `jpillora/dnsmasq`：實測其只有 amd64 manifest，build 於 2018-12-22（dnsmasq 2.80、webproc 0.2.2），上游已停更，無法滿足 arm64 需求。
- **image 與 tag 由 Runestone 固定寫在產生的 `compose.yml` 中，不提供環境變數讓使用者覆寫。** 開放覆寫會讓設定檔格式、entrypoint 參數、webproc 行為都變成不可控的相容性負擔。
- tag 隨 CLI 釋出版本更新：dns image 有變更時發佈新 tag，並在 CLI 原始碼的 compose 樣板中同步更新。

### 5.3 對初始規劃（commit `3581211`）的修正

| 初始規劃 | 問題 | 本規格 |
| --- | --- | --- |
| dnsmasq 跑在 runestone container 內 | 與主服務生命週期綁死 | 獨立 `dns` 服務、獨立 image |
| webproc 監聽 8080 | 與 Traefik API 的 `runestone:8080` 衝突 | webproc 在獨立容器的 8080，不再衝突 |
| `if [ -z "$DNS_ENABLE" ]` 才啟動 dnsmasq | 判斷反了（值為空才啟動） | 改由 compose profile 決定，runestone image 不需要這段 |
| dns-ui router 寫在 image 內的 `traefik.dynamic.yml` 模板 | 該檔只在 `/configuration` 缺檔時才複製，既有使用者永遠拿不到新區塊 | 改由 CLI 產生 `configuration/dns/dns-ui.yml`，並移除模板內的 `{{ if env "DNS_ENABLE" }}` 區塊 |

## 6. 平台行為

### 6.1 Bind IP 與 53 port

| 平台 | Bind IP | 理由 |
| --- | --- | --- |
| Docker Desktop（Windows / macOS / WSL2） | `0.0.0.0` | Target IP（`192.168.65.254`）是 Docker VM 內的位址，主機上沒有這張介面，無法 publish 到該 IP。 |
| Linux 原生 Docker Engine | Target IP（docker0 gateway，例 `172.17.0.1`） | 該位址實際存在於主機，綁它可避開 systemd-resolved 佔用的 `127.0.0.53`，也不會把 53 對整個 LAN 開放。 |

- Bind IP 由 CLI 依平台與 Docker context 判定後寫入 `.env` 的 `DNS_BIND_IP`，使用者可覆寫。
- **53 port 是否可用必須以「實際啟動 dns 服務」驗證，不可只靠 netstat 判斷。** 實測：Windows 的 Internet Connection Sharing (ICS) 服務持有 `0.0.0.0:53/udp`，Docker 仍能成功發佈 `-p 53:53/udp -p 53:53/tcp`，且 container 從 `192.168.65.254:53` 查詢 managed domain 成功取得 Target IP。單看 netstat 會誤判為不可用。

### 6.2 daemon 設定檔與重啟方式

| 平台 | daemon 設定檔 | 重啟方式 |
| --- | --- | --- |
| Windows / macOS Docker Desktop | `~/.docker/daemon.json` | 優先嘗試 `docker desktop restart`（待驗證），不可用則提示使用者手動重啟 Docker Desktop |
| WSL2（endpoint 為 Docker Desktop） | Windows 端的 `/mnt/<drive>/Users/<user>/.docker/daemon.json` | 同上 |
| Linux rootful Docker Engine | `/etc/docker/daemon.json` | `sudo systemctl restart docker`，不可用則 `sudo service docker restart` |

- 兩種重啟路徑都必須輪詢 `docker info` 直到 Docker 恢復（上限 120 秒）才算成功。
- Remote context 與 Windows container 模式（`docker info` 的 OSType 非 linux）一律在修改 daemon 設定前中止。

## 7. 設定與檔案

### 7.1 `.env` 新增欄位

```dotenv
DNS_ENABLE=false
DNS_HOST_IP=            # Target IP，Runestone 管理
DNS_BIND_IP=            # 53 綁定位址，Runestone 管理，可覆寫
DNS_UPSTREAM=           # dnsmasq 上游，逗號分隔。留空＝先偵測，再退回 1.1.1.1（見 8.4）
DNS_DAEMON_FALLBACK=    # 選用：daemon dns 陣列中的第二筆自有項目（見 9.7）。留空＝不啟用
DNS_CONTAINER_RESOLVER= # dns 容器自己使用的 resolver。留空＝1.1.1.1（見 8.2）
DNS_AUTO_REORDER=false  # 我方項目不在最前面時，是否自動排回（見 9.6）
DNS_UI_ENABLE=true      # 是否產生 dns.<HOST_DOMAIN> 的 Traefik route
DNS_UI_USER=            # 選填，webproc 基本驗證帳號（HTTP_USER）
DNS_UI_PASS=            # 選填，webproc 基本驗證密碼（HTTP_PASS）
```

`DNS_ENABLE` 不存在時視為停用，既有安裝升級後行為不變。

### 7.2 專案檔案

```text
~/.runestone/
├── .env
├── compose.yml                       # 新增 dns 服務（profile: dns）
├── certs/                            # 既有
├── dns/
│   └── custom.conf                   # 使用者可編輯（webproc 的編輯對象），Runestone 永不覆寫
└── configuration/
    └── dns/
        └── dns-ui.yml                # Runestone 產生的 Traefik route
```

`dnsmasq.conf` 與 `managed.conf` 不出現在主機上 — 它們由容器每次啟動時產生（見 8.3）。

**持久化的 dnsmasq 設定檔一律放在 `dns/`，不可放進 `configuration/`。** Traefik 的 file provider 會遞迴讀取 `/configuration`（見 commit `69edef4`），把 `.conf` 放進去會產生解析錯誤與 log 噪音。

### 7.3 所有權狀態

存於既有的 `~/.runestone/runestone.config.json`，新增 `dns` 區塊：

```json
{
  "dns": {
    "schemaVersion": 1,
    "phase": "applied",
    "preparedReason": null,
    "contextName": "desktop-linux",
    "daemonPath": "C:\\Users\\me\\.docker\\daemon.json",
    "targetIp": "192.168.65.254",
    "insertedEntries": [
      { "role": "target", "value": "192.168.65.254", "index": 0 }
    ],
    "createdDnsKey": true,
    "createdDaemonFile": false,
    "upstreams": ["192.168.1.1"],
    "updatedAt": "2026-08-27T10:00:00.000Z"
  }
}
```

- `phase`：`prepared`（daemon 設定已寫入，但尚未重啟 Docker，因此變更還沒有任何效果）→ `applied`（已重啟並驗證）。`preparedReason` 記錄它**為什麼**停在 `prepared`——`no-restart` 或 `rollback-failed`——因為兩者需要相反的處置，而第 12 節要求 `status` 必須能分辨；`phase` 為 `applied` 時它不存在。**`prepared` 不只是失敗的中間態**：`dns enable --no-restart` 就是刻意停在這裡，`status` 必須把這種情況呈現為「已寫入，等待 Docker 重啟」而不是錯誤。正是這個切分，讓整條寫入／撤銷循環可以在真實 daemon 檔案上演練而不中斷任何一個容器（見 16.1）。
- `insertedEntries` 列出由 Runestone 擁有的**每一筆**項目，不在其中的一律不屬於我方。平常只有一筆（`role: "target"`），啟用 9.7 的選用備援時為兩筆（`role: "fallback"`，位於 `dns[1]`）。逐筆而言，`value` 用於比對，`index` 是最後一次已知位置，**只用於識別，不用於還原位置** — 撤銷時只把這些項目移除，不做任何位置還原動作。

### 7.4 開發用覆寫（非使用者功能）

兩個環境變數把「唯二會碰到全域狀態的操作」導向他處，讓所有權引擎能在沒有真實 daemon 檔案、也不需真的重啟 Docker 的情況下開發與測試：

| 變數 | 效果 |
| --- | --- |
| `RUNESTONE_DNS_DAEMON_PATH` | 改用這個路徑，取代平台預設的 daemon 設定檔 |
| `RUNESTONE_DNS_RESTART_CMD` | 改執行這個指令，取代平台預設的 Docker 重啟方式 |

- **刻意不寫進 `.env`、不出現在 `runestone setup`**，也不作為使用者設定對外說明。它們的存在是為了支撐 16.2 的參與層級。
- 它們本身就是風險——路徑填錯就是寫到不該寫的檔案——所以**只要其中任一項生效，`status` 與 `doctor` 都必須顯著提示**，且 11.3 第 1 項的揭露必須永遠印出實際生效的路徑，不論它從何而來。
- 沒有這兩項，無法在自己機器上重啟 Docker 的接手者根本無從參與這個功能。這是它們屬於規格要求、而非便利設施的原因。

## 8. DNS 服務

### 8.1 runestone-dns image（`docker/dns/`）

- Alpine + `dnsmasq` + pinned webproc（webproc v0.4.0 有 `linux_amd64` 與 `linux_arm64` release 檔，依 `TARGETARCH` 取用）。
- 建置目標平台：`linux/amd64`、`linux/arm64`。
- image 內的 entrypoint 每次啟動依序做兩件事：

  1. 依 8.3 的規則重新產生並覆蓋 `/etc/dnsmasq.conf` 與 `/etc/dnsmasq.d/managed.conf`。
  2. 啟動程序：

     ```sh
     webproc --configuration-file /etc/dnsmasq.d/custom.conf \
       --port 8080 --restart-watch \
       -- dnsmasq --no-daemon --conf-file=/etc/dnsmasq.conf --log-facility=-
     ```

  webproc 只監看 custom rules，Runestone 擁有的設定不在它的編輯範圍內。使用者從 UI 改壞 custom rules 時，managed mapping 與上游設定不會被波及。

  **已對 webproc 0.4.0 實測確認**（這是本節原本的待辦）：可寫設定檔的旗標是 `--configuration-file`（`-c`），而 **0.4.0 沒有 `--config`**。`--port`、`--user`、`--pass` 都存在，`--on-save` 本來就預設為 `restart`，所以從 UI 存檔會重啟 dnsmasq。另外也用了 `--restart-watch`，讓 `custom.conf` **在磁碟上**被改動時同樣重啟 dnsmasq——這覆蓋了使用者用編輯器而非 UI 修改自己檔案的情況。`HTTP_USER` 與 `HTTP_PASS` 以環境變數傳入而非旗標，因為在命令列上給定的密碼會出現在容器的行程清單裡。
- 支援以 `HTTP_USER` / `HTTP_PASS` 環境變數啟用 webproc 基本驗證。
- 建置與發佈方式見 15.2。

### 8.2 Compose 服務定義

- 服務名 `dns`，容器名 `${PREFIX}-dns`，加入既有的 `${PREFIX}-network`。
- image 與 tag 由 Runestone 的 compose 樣板固定寫入（例如 `cymondez/runestone-dns:1.0`），**不提供環境變數覆寫**。
- `restart: unless-stopped`。
- 使用 compose profile `dns`。**`DNS_ENABLE=true` 時，CLI 所有 compose 呼叫（`up` / `stop` / `restart` / `ps` / `down`）一律帶 `--profile dns`**，避免不同 Compose 版本對 profile 的處理差異造成行為漂移。
- 發佈 `${DNS_BIND_IP}:53:53/tcp` 與 `${DNS_BIND_IP}:53:53/udp`；webproc 的 8080 **不對主機發佈**。
- 掛載：`./certs:/ssl:ro`（entrypoint 掃描憑證檔名用）、`./dns/custom.conf:/etc/dnsmasq.d/custom.conf`（可寫，使用者與 webproc 的編輯對象）。Runestone 擁有的兩個設定檔只存在容器內、不掛載（見 8.3）。
- 環境變數：`DNS_HOST_IP`、`DNS_UPSTREAM` 供 entrypoint render 設定檔；`DNS_UI_USER` / `DNS_UI_PASS` 有值時以 `HTTP_USER` / `HTTP_PASS` 傳入。
- 服務層直接指定 `dns:` 為上游解析器，確保 dns 容器本身不會被 daemon 的 DNS 設定導回自己而形成迴圈。

### 8.3 dnsmasq 設定的產生與防篡改

Runestone 擁有的兩個設定檔 `/etc/dnsmasq.conf` 與 `/etc/dnsmasq.d/managed.conf`，**在容器每次啟動時由 entrypoint 重新產生並覆蓋，且只存在於容器內、不掛載到主機**。使用者不是「改了之後能復原」，而是根本改不到；每次啟動的產物就是權威版本。

這與 runestone image 的既有做法一致：`traefik.tmp.yml` 在啟動時 render 成 `/traefik.yml`（image 擁有、每次重生），`traefik.dynamic.yml` 只在缺檔時複製（使用者擁有、永不覆寫）。兩種所有權用兩種機制。

| 檔案 | 位置 | 所有權 | 每次啟動 |
| --- | --- | --- | --- |
| `dnsmasq.conf` | 僅容器內 | Runestone | 重新產生並覆蓋 |
| `managed.conf` | 僅容器內 | Runestone | 重新產生並覆蓋 |
| `custom.conf` | 主機 `~/.runestone/dns/custom.conf` | 使用者 | 缺檔才建立，**永不覆寫** |

產生規則：

- `managed.conf`：entrypoint 掃描唯讀掛載的 `/ssl`，取 `*.crt`，排除 `rootCA.crt` 與不是合法 domain 的檔名，每個 domain 產生一條 `address=/<domain>/<DNS_HOST_IP>`。dnsmasq 的 `address=/domain/ip` 會同時涵蓋該 domain 與其所有子網域（實測確認）。只需要讀檔名，不需要讀憑證內容。
- `dnsmasq.conf`：entrypoint 依環境變數 render，包含 `no-resolv`、依 `DNS_UPSTREAM` 展開的 `server=` 清單，並 include `managed.conf` 與 `custom.conf`。
- `custom.conf`：CLI 必須在啟動 dns 服務前確保該檔存在（**bind-mount 一個不存在的檔案會被 Docker 建成目錄**），內容為說明註解。

重新產生的時機：

- 憑證變更（`certs create` / `certs remove`）→ 憑證涵蓋的 domain 集合有變化時，CLI 執行 service-scoped 的 `docker compose restart dns`（見 10.5）。
- Target IP 或上游變更 → CLI 更新 `.env` 後 `docker compose up -d dns`（環境變數變更會重建容器）。
- 主機重開機、Docker 重啟、容器 crash 後被 `restart: unless-stopped` 拉起 → 同樣重新產生，**不需要 CLI 介入**。

取捨：產生邏輯落在 image 的 entrypoint（shell），因此 domain 篩選規則改由 image 驗證測試覆蓋（見 14.4），而不是 jest 單元測試，規則要改也得重新發佈 image。換到的是「只要容器起得來，Runestone 的 dnsmasq 設定就是正確的」，完全不依賴 CLI 是否被執行過。上游決定邏輯（8.4）仍留在 CLI，以環境變數傳入，維持可單元測試。

### 8.4 上游 DNS

**上游清單是必要的，且永不為空。** dnsmasq 以 `no-resolv` 執行，只會轉發給 Runestone 給它的伺服器；一筆都沒有的話，DNS 一啟用，全機 container 立刻失去對外名稱解析。因此 `dns enable` 絕不會因為「取不到上游」而中止。

清單的決定方式：

1. `.env` 的 `DNS_UPSTREAM` 非空時採用。這是 setup 會寫入的值，具權威性。
2. 否則進行偵測：daemon 設定檔中既有的 `dns` 項目，然後是主機解析器（Node `dns.getServers()`），兩者都排除 loopback 與 Target IP。
3. 偵測不到任何結果 → `1.1.1.1`。

**`DNS_UPSTREAM` 出廠是空的，而 `1.1.1.1` 是偵測路徑的最後手段，不是寫進 `.env` 的值。** 這兩者不能互換，而本節先前的版本兩種都說了：如果出廠的 `.env` 帶著 `DNS_UPSTREAM=1.1.1.1`，那個值就與「使用者做出的選擇」無法區分，第 1 步永遠會勝出，**偵測因此永遠不會執行**——而那在只允許內部解析器的企業或校園網路上正好是錯的。所以「空」代表「還沒有選擇，去找」。永不為空這個保證住在判定邏輯本身與 Compose 的預設值裡，不住在出廠檔案裡。偵測失敗也不是致命錯誤：改用公用預設，並在輸出中明白告知。

setup 會呈現算出來的清單，並提供三個動作（見 11.2）：沿用、更換、追加。使用者選了什麼就明確寫進 `DNS_UPSTREAM`，讓生效值永遠能在 `.env` 看見，而不是隱含在偵測邏輯裡。

多筆上游是**一個集合，不是優先順序**：dnsmasq 會偏好回應快的伺服器。需要嚴格順序的使用者可以在 `dns/custom.conf` 加上 `strict-order`，該檔案 Runestone 永不覆寫（8.3）。

`dns enable` 的 `--upstream <ip,...>` 會取代該次執行的清單，並寫入 `.env`。

daemon `dns` 陣列裡要不要**另外**放一筆備援，是獨立的選用問題——見 9.7。無論如何，**Runestone 都不會為了備援而改動使用者自己的項目**，只插入我方自己的。

### 8.5 Web UI

- `DNS_UI_ENABLE=true` 時，CLI 產生 `configuration/dns/dns-ui.yml`，把 `https://dns.<HOST_DOMAIN>` 導向 `http://${PREFIX}-dns:8080`。
- UI 只編輯 `custom.conf`，不會動到 `managed.conf` 與 `dnsmasq.conf`。
- 未設定 `DNS_UI_USER` / `DNS_UI_PASS` 時 **UI 無任何驗證**：setup 說明與 `dns status` 都必須明講「任何能連到這台主機 HTTPS 入口的人都能修改自訂 DNS 規則」。不需要 UI 時設 `DNS_UI_ENABLE=false`。

## 9. Docker daemon 所有權模型

這是「只撤銷 Runestone 自己做的設定」的核心。

### 9.1 啟用時的動作

本節只適用於**沒有既有所有權記錄**的首次啟用；已有記錄時走 9.5 的調和路徑。

Runestone 只做一類動作：**把我方自己的項目插入 `dns` 陣列最前面**——Target IP 在 index 0，啟用 9.7 時備援在 index 1。不搬移、不去重、不改寫任何既有項目。

| 現況 | 動作 | 記錄 |
| --- | --- | --- |
| 沒有 `dns` key | 建立 `dns: [TargetIP]`，啟用 9.7 時在其後接上備援 | `createdDnsKey=true`、`insertedEntries=[{role:"target",index:0}]`，啟用時再加 `{role:"fallback",index:1}` |
| 已有 `dns` 陣列 | 依上述順序把我方項目插入最前面；既有項目整體往後移，內容與相對順序不變 | `insertedEntries` 同上 |

**陣列中已存在相同的 Target IP 時，仍然照樣插入我方項目，不做去重。** 那筆既有項目屬於使用者或其他工具，搬移或移除它都算干涉；重複的 DNS 項目對 Docker 無害。此時 `status` 需提示「daemon dns 已有指向同一位址的項目，Runestone 不會移動或移除它，停用後它仍會留在設定中」。

其餘所有 key 與既有項目的相對順序一律保留。

### 9.2 停用時的反向操作

1. 重新讀取當下的 daemon JSON（不用任何備份檔整檔覆蓋，避免蓋掉使用者期間的其他修改）。
2. 依 9.5 的識別順序找出 `insertedEntries` 中的每一筆，**只移除這些項目**。其餘項目一律原位保留，不做任何位置還原或重排。若其中任何一筆處於所有權衝突，則一筆都不移除——見 9.7。
3. `createdDnsKey=true` 且移除後陣列為空 → 刪除 `dns` key。
4. `createdDaemonFile=true` 且移除後整個物件為 `{}` → 刪除該檔案。
5. 清除所有權狀態。

### 9.3 安全規則

- 原子寫入：寫暫存檔 → 重新 parse 驗證為合法 JSON → rename 覆蓋；盡可能保留原檔權限。
- Linux 的 `/etc/docker/daemon.json` 需要 sudo，提權失敗即中止，不做部分寫入。
- 所有權狀態遺失，或 context / daemon 路徑與記錄不符 → **中止並顯示 daemon 路徑與手動修復步驟，絕不猜測該刪哪一筆**；同時提供 `runestone dns disable --assume-entry <ip>` 與 `--assume-index <n>` 讓使用者明確指定要移除哪一筆。
- 使用者在啟用期間手動改過 `dns` 陣列 → 依 9.5 逐案處理；任何情況下都只動我方那一筆，並在輸出說明偵測到外部變更。
- 同一時間只允許一個 DNS 操作：以 `~/.runestone/dns.lock` 檔鎖（含 pid 與時間戳）序列化。

### 9.4 Target IP 變更

`dns enable` 或 `up` 時若解析到的 Target IP 與記錄不同（例如 Docker Desktop 重建網路），在同一次交易內先反向移除舊 owned entry，再插入新的 Target IP，並更新 mapping 與 `.env`。

### 9.5 啟用期間使用者修改 daemon dns 的處理

原則：**Runestone 只認自己插入、且記錄在 `insertedEntries` 中的項目。其餘一切都屬於使用者，包含使用者在啟用之後才新增或修改的項目。**

我方每一筆項目的識別順序，逐筆獨立套用：

1. 記錄的 `index` 位置上的值與 `value` 相符 → 即為該筆。
2. 否則，陣列中值相符的項目**只有一筆** → 即為該筆。
3. 值相符的項目有多筆，且記錄的 `index` 已不相符 → 所有權衝突，中止，要求 `runestone dns disable --assume-index <n>`。不猜。
4. 完全找不到值相符的項目 → 視為已被使用者移除（見下表）。

| 使用者的修改 | 要求的行為 |
| --- | --- |
| 在我方項目之後新增項目 | 完整保留，順序不動 |
| 在我方項目之前插入自己的項目（我方不再是 `dns[0]`） | 依 9.6 的 `DNS_AUTO_REORDER` 決定；無論哪種模式，disable 時都只移除我方那筆，使用者的項目與順序完全保留 |
| 在其他位置也加入相同的 Target IP | 記錄的 `index` 仍相符 → 只移除我方那筆，使用者的重複項目保留，並警告「daemon dns 仍有指向 Runestone DNS 的項目，dns 服務移除後該項目將無法解析」；記錄的 `index` 已不相符（同時被插隊）→ 所有權衝突，要求 `--assume-index <n>` |
| 手動移除我方項目 | disable 視為已撤銷：不報錯、不修改檔案內容、清除所有權狀態並告知使用者 |
| 改掉我方項目的值（例如自行換成別的 IP） | **與上一列在觀察上無法分辨**：兩者都只是我方的值不在陣列裡了，沒有任何實作能區分「被刪掉」與「被覆寫」。因此由第 4 條規則管轄——視為已撤銷、不改任何東西。輸出必須額外回報現在坐在記錄位置上的值；使用者若確知自己是改名而非刪除，`runestone dns disable --assume-entry <ip>` 仍然可用 |
| 我方建立了 `dns` key，使用者又加入其他項目 | 移除我方項目後陣列非空 → 保留 `dns` key |
| 我方建立了 daemon 檔案，使用者又加入其他設定 | 移除我方項目後物件不是 `{}` → 保留檔案 |
| 透過 Docker Desktop 的 Docker Engine 介面重新格式化過檔案 | 以值比對仍可識別，正常撤銷 |

寫檔時的額外要求：

- 沿用原檔的縮排風格（偵測既有縮排後重用），不重排其他 key，不做不必要的格式正規化 — 格式被改寫也是一種對使用者修改的破壞。
- 只改動 `dns` 這一個 key，其餘 key 一律原樣寫回。

再入性：`dns enable` 與 `up` 在已存在 `phase=applied` 記錄時走本節的調和路徑，**不重跑 9.1 的插入動作**（否則會插入第二筆我方項目）。9.1 只適用於「沒有既有所有權記錄」的首次啟用。

### 9.6 自動排序（`DNS_AUTO_REORDER`）

當使用者把自己的項目插到我方之前時，我方的 DNS 就不再是第一筆，Runestone 的 domain 可能解析不到。要不要自動修正這件事由使用者決定，預設**不自動修正**，並在 setup 以獨立一題詢問（見 11.2）。

| `DNS_AUTO_REORDER` | `up` / `dns enable` 偵測到我方項目不在最前面時（Target IP 應在 `dns[0]`，啟用 9.7 時備援應在 `dns[1]`） |
| --- | --- |
| `false`（預設） | **只警告，不修改任何內容。** 警告需說明：我方每一筆項目目前的實際位置、DNS 可能不會生效、以及可設 `DNS_AUTO_REORDER=true` 讓 Runestone 每次啟動時把自己的項目排回最前面。 |
| `true` | 只把**我方記錄的那些項目**依角色順序搬回最前面，其他項目的相對順序完全不變，更新各自記錄的 `index`，並告知使用者「daemon 設定已更新，將於下次 Docker 重啟後生效」。 |

兩種模式的共同限制：

- **絕不搬移、修改或移除任何非我方的項目。** 自動排序調整的只有我方自己那些項目的位置。
- **自動排序不得主動重啟 Docker。** 重啟會終止全機所有 container，而 `up` 是日常操作；只寫檔案並告知生效時機。使用者要立即生效可自行重啟 Docker 或執行 `runestone dns enable`。
- 兩種模式都要在 `status` 與 `doctor` 顯示目前的設定值與偵測結果。

### 9.7 選用的 daemon 備援項目（`DNS_DAEMON_FALLBACK`）

預設關閉。設定後，Runestone 會在 Target IP 之後緊接著插入**第二筆自有項目**，因此陣列開頭成為 `[Target IP, 備援, ...原本就在的那些]`。

它買到什麼、代價是什麼，兩者都經過實測：

| | 備援關閉（預設） | 備援開啟 |
| --- | --- | --- |
| dns 服務正常運作時 | Runestone domain 解析為 Target IP，其餘一切交給 dnsmasq 上游（8.4） | 完全相同。實測：兩個 nameserver 都可達時，列在前面的那個 20/20 回應，glibc 與 musl 皆然，備援不會與我方賽跑 |
| dns 服務停止時 | 解析**立即且明確地失敗**，原因一目了然 | 解析**經備援成功**。實測：5/5 由第二個 nameserver 回應，每次 0.01 秒，glibc 與 musl 皆然 |
| dns 服務停止時查詢 Runestone domain | 失敗 | **解析為 `127.0.0.1`**，因為這些 domain 的公開紀錄就是如此（已驗證）。容器接著連上自己的 loopback，回報連線錯誤，或撞到某個不相干的本機服務 |

兩個方向都重要，沒有哪一邊絕對更好，而且兩邊都必須揭露。

**開啟它買到什麼。** 這是唯一能直接緩解 2.4 第 3 項代價的設定——「啟用後，全機每個 container 的名稱解析都依賴一個 Runestone 容器」。有備援在的情況下，dns 容器被停掉、當掉、正被 `up` 重建，或還在等 image 下載時，**全機每個 container 仍然能正常解析一般網際網路名稱**，而且是立即的、沒有逾時代價（見上表第二列）。它也緩解了第 7 項代價：Runestone 本身已被移除、daemon 卻還留著我方項目的機器，仍然能正常解析，只是解析不到 Runestone 的 domain。

**開啟它的代價是什麼。** Runestone domain 不再是失敗，而是解析成 `127.0.0.1`（見上表第三列）。明確的 DNS 失敗變成安靜的錯誤答案，而那個安靜的錯誤答案正是整個功能存在的目的所要消除的缺陷（2.1）。

**Runestone 給建議，使用者做決定。** 預設關閉，因為多插一筆自有項目是更進一步的侵入性改動，應該由使用者主動要求而不是被預設。要呈現的建議：

| 情境 | 建議 |
| --- | --- |
| 這台機器同時跑著與 Runestone 無關的專案容器 | 通常該開啟——那些專案不該因為一個 Runestone 容器停了就失去網際網路 DNS |
| 主要用於 Runestone 開發的機器，希望 DNS 壞掉時立刻看得出來 | 通常該關閉——明確的失敗比錯誤的答案好診斷 |
| 不確定 | 先關著。之後隨時可以開，代價就是再寫一次 daemon 並再重啟一次 Docker，僅此而已 |

setup 的題目與 enable 的確認都必須同時呈現**兩個**方向。只說成「加一組備用 DNS」是隱藏代價；只說成「會讓 Runestone domain 解析成 `127.0.0.1`」是隱藏好處。兩者都不可接受。

所有權規則的性質不變，只有數量改變：

- 兩筆都記錄在 `insertedEntries` 中，`role` 各異，且各自依 9.5 的順序獨立識別。
- 撤銷時兩筆都移除。**若一筆可識別、另一筆處於所有權衝突，則一筆都不移除**：中止、回報兩者狀態，並要求對衝突那筆明確給出 `--assume-index`。絕不能讓使用者手上留著 Runestone 改動的一半。
- 在 DNS 仍啟用的情況下關掉備援，只移除 `role: "fallback"` 那一筆。
- 變更它的值＝在單一交易內先移除再插入，與 9.4 相同。
- `DNS_AUTO_REORDER`（9.6）把我方項目當成一個整體處理：把 Target IP 排回 index 0、備援排回 index 1，其餘一律不動。

## 10. 操作流程

### 10.1 `runestone dns enable`

1. **前置檢查（不改動任何狀態）**：setup 已完成、Docker 可用、context 非 remote、非 Windows container 模式、可解析出 IPv4 Target IP、daemon 設定檔可讀且為合法 JSON。上游清單不會導致前置檢查失敗，因為 8.4 保證它一定存在；當它退回 `1.1.1.1` 時要明白告知。
2. 寫入 `.env`、確保 `dns/custom.conf` 存在、產生 `configuration/dns/dns-ui.yml`、更新 `compose.yml`。
3. 啟動 `dns` 服務並**實際驗證**：由一次性 container 對 `Target IP:53` 查詢一個 managed domain，必須回應 Target IP。此步失敗即停掉 dns 服務、還原 `.env`，在完全未動 daemon 設定的情況下結束。
4. 寫入所有權狀態（`phase=prepared`），原子更新 daemon JSON。
5. 向使用者確認後重啟 Docker，輪詢至恢復。**帶 `--no-restart` 時停在這一步**：保留 `phase=prepared`，並告知 daemon 設定已寫入，待使用者自行重啟 Docker 後生效。
6. 驗證：新建 container 的 `/etc/resolv.conf` 第一筆為 Target IP，且能解析 `traefik.<HOST_DOMAIN>` 為 Target IP。
7. 標記 `phase=applied`，輸出 UI 網址與提示。

任一步失敗 → 反向還原 daemon JSON → 重啟 Docker → 停止 dns 服務 → 清除狀態。還原本身失敗時，保留 `phase=prepared` 並輸出確切的 daemon 路徑與手動修復指令。

`--dry-run` 只執行第 1 步，然後印出 daemon 設定的前後 diff 並結束。它完全不寫任何東西：不寫 `.env`、不起服務、不寫所有權狀態、不動 daemon 檔案。

### 10.2 `runestone dns disable`

1. 確認記錄的 context 與 daemon 路徑仍與當前環境相符。
2. 依 9.2 反向操作並原子寫入。
3. 向使用者確認後重啟 Docker，輪詢至恢復。
4. 驗證 owned entry 已不在生效設定中。
5. 設定 `DNS_ENABLE=false`、停止並移除 dns 服務、移除 `configuration/dns/dns-ui.yml`、清除所有權狀態；`dns/custom.conf` 保留。

daemon 撤銷未成功前，不得移除 dns 服務。

`--dry-run` 會依 9.5 的順序判定將被移除的是哪些項目，印出前後 diff 後結束，不寫入任何內容。

### 10.3 `runestone dns status`

唯讀。輸出：期望狀態、dns 服務狀態、Target IP、Bind IP、daemon 路徑、所有權記錄（含 `phase` 與 `insertedEntries` 每一筆及其角色）、上游清單與各值的來源、9.7 備援是否啟用及其現況、UI 網址與驗證狀態。

外部變更偵測結果也必須顯示（依 9.5）：

- `insertedEntries` 中每一筆：是否仍存在、值是否仍相符。
- Target IP 那筆是否仍為 `dns[0]`（啟用 9.7 時備援是否仍為 `dns[1]`）；若不是，顯示目前實際位置、「DNS 可能不會生效」的提示，以及目前 `DNS_AUTO_REORDER` 的設定值。
- 陣列中是否有非我方所有、但同樣指向 Runestone DNS 的重複項目。
- 是否處於 `phase=prepared`——daemon 設定已寫入但仍在等待 Docker 重啟——以及這是刻意的 `--no-restart`，還是還原失敗留下的殘留。
- 7.4 的開發用覆寫是否有任一項生效，以及實際生效的 daemon 路徑與重啟指令。

### 10.4 生命週期整合

| 命令 | 行為 |
| --- | --- |
| `up` | DNS 啟用時帶 `--profile dns` 一併啟動，並調和 Target IP 變更、重建 mapping。若我方項目已不在 `dns[0]`，依 9.6 的 `DNS_AUTO_REORDER` 警告或搬移，且不主動重啟 Docker。 |
| `stop` | **只停 `runestone` 服務，dns 服務繼續運行。** daemon 仍指向它，停掉會讓全機 container 的 DNS 失效。要一起停時用 `runestone stop --all`，並顯示上述警告。 |
| `down` | DNS 啟用時先執行完整 disable 流程（含 Docker 重啟）；失敗則中止 down，不做任何破壞性清除。 |
| `certs create` / `certs remove` | DNS 啟用時，若憑證涵蓋的 domain 集合有變化，重啟 `dns` 服務讓 entrypoint 重新產生 mapping。 |
| `doctor` | DNS 啟用時檢查：owned entry 是否仍在 daemon `dns` 陣列最前面、dns 服務是否運行、Target IP 是否仍相符。**只回報，不自動修正**（見 9.5）。 |

### 10.5 既有 restart 行為的修正（必要前置）

目前 `composeService.restart()` 執行不帶服務名稱的 `docker compose restart`，會重啟 project 內所有服務；它被憑證／service 動態設定變更與 setup 呼叫。

**必須改為 service-scoped**：動態設定變更只重啟 `runestone`，DNS 設定變更只重啟 `dns`。這是 DNS 服務不被無關操作中斷的前提。

## 11. CLI 介面與風險揭露

### 11.1 命令

```text
runestone dns enable  [--yes] [--dry-run] [--no-restart] [--upstream <ip,...>]
runestone dns disable [--yes] [--dry-run] [--assume-entry <ip>] [--assume-index <n>]
runestone dns status
```

- `--yes` 略過重啟 Docker 的確認；未帶時重啟前必須確認。
- `--assume-entry` 與 `--assume-index` 都可以給超過一次，因為所有權可能涵蓋兩筆項目（9.7）；每一筆需要明確指定的項目給一次。
- `--dry-run` 印出 daemon 設定的前後 diff 後結束，完全不寫入任何東西。它是 16.2 各層級的主要開發工具，並且保留在正式版 CLI 裡——想先看清變更再決定是否同意的使用者，值得拿到同一個工具。
- `--no-restart` 寫入 daemon 設定後停在 `phase=prepared`，把重啟 Docker 留給使用者。在使用者重啟前不會有任何效果，而這正是這個旗標讓「寫入」變成可安全演練的原因。
- 成功 exit code `0`，操作失敗非 `0`。
- 所有文案補 `en` / `zh-TW` / `ja-JP` 三語。

### 11.2 setup 整合

DNS 相關共四題，順序固定，第二三四題僅在啟用時出現：

| 題目 | 預設 | description 必須說明 |
| --- | --- | --- |
| 是否啟用 DNS | 關閉 | 11.3 的第 1、2、3、4、7 項，並帶入實際的 daemon 路徑 |
| 上游 DNS——沿用／更換／追加 | 沿用 8.4 算出的清單，並顯示每個值的來源 | 11.3 第 10 項：全機 container 所有非 Runestone domain 的查詢都會經過它、偵測不到任何結果時出現的就是 `1.1.1.1`、以及多筆值是集合而非優先順序 |
| 是否在 daemon `dns` 陣列加入一筆備援 | 否 | 11.3 第 11 項，並依 9.7 表格同時給出**兩個**方向——dns 服務停止時它買到什麼，以及對 Runestone domain 的代價是什麼——接著給 9.7 的情境建議。description 必須讀起來像建議，不是像判決 |
| 是否啟用自動排序 | 關閉 | 兩種模式各自的風險：關閉時使用者插隊後 DNS 可能不生效且 Runestone 不會自動修正；開啟時 Runestone 會在每次 `up` 改寫 daemon 設定（只改我方自己那些項目、不重啟 Docker） |

- 依 `AGENTS.md`：可修正的輸入錯誤要回到同一題，錯誤訊息放在該題的 description。
- review 摘要必須顯示這四個值。
- 取消或前置檢查失敗時，不得留下任何 daemon 設定、服務或狀態變更。

### 11.3 風險揭露要求

原則：**使用者同意的是具體行為，不是抽象警告。** 揭露內容必須帶入實際值（daemon 路徑、Target IP、Bind IP、UI 網址），不可只寫「會修改 Docker 設定」這種空話；而且每一次要動全域狀態之前都要揭露一次，不能只在 setup 講一次就假設使用者記得。

必須揭露的項目：

| # | 揭露內容 |
| --- | --- |
| 1 | 會修改 `<實際 daemon 路徑>`，在 `dns` 陣列最前面加入 `<Target IP>` |
| 2 | 需要重啟 Docker，**會終止全機所有 container**，包含與 Runestone 無關的專案 |
| 3 | 啟用後全機 container 的 DNS 查詢都經過 Runestone 的 dns 容器；該容器停止時，全機 container 可能無法解析任何名稱 |
| 4 | 會佔用主機 `<Bind IP>:53`（tcp 與 udp） |
| 5 | `runestone stop` 刻意不停 dns 服務；`stop --all` 才會一起停，而那會使全機 DNS 失效 |
| 6 | 移除 Runestone 前必須先執行 `runestone dns disable`，否則會留下指向不存在容器的 daemon 設定 |
| 7 | 停用時只移除 Runestone 自己加入的那些項目——一筆，或啟用 9.7 備援時兩筆；其他項目與順序完全不動 |
| 8 | dns UI 在未設定 `DNS_UI_USER` / `DNS_UI_PASS` 時無任何驗證 |
| 9 | 自動排序開啟時，Runestone 會在每次 `up` 改寫 daemon 設定（只改我方自己那些項目，不重啟 Docker） |
| 10 | 全機 container 所有「不是 Runestone domain」的查詢都會被轉發到 `<上游清單>`。它永不為空；什麼都偵測不到時會使用 `1.1.1.1`，且會顯示每個值的來源 |
| 11 | 啟用 9.7 備援時會在 `dns[1]` 加入第二筆 `<備援位址>`。**好處**：dns 服務停止期間，全機每個 container 仍能立即解析一般網際網路名稱，包含與 Runestone 無關的專案。**代價**：Runestone domain 屆時會解析成 `127.0.0.1` 而不是失敗，表現出來像應用程式的 bug 而不是 DNS 中斷。Runestone 依 9.7 表格給建議，但不代為決定 |

揭露時機：

| 時機 | 必須揭露 |
| --- | --- |
| setup 的 DNS 啟用題 | 1、2、3、4、7 |
| setup 的上游題 | 10 |
| setup 的備援題 | 11，以及 9.7 表格中的實測行為 |
| setup 的自動排序題 | 9，以及關閉時的風險 |
| `dns enable` 修改 daemon 之前的確認 | 1–11 全部，帶入實際值 |
| `dns enable` 重啟 Docker 之前的確認 | 2，明說會終止全機 container |
| `dns status` | 目前生效中的侵入性設定：daemon 路徑、我方每一筆項目的實際位置、Bind IP、上游清單、9.7 備援是否啟用、UI 驗證狀態、自動排序設定 |
| `dns disable` 之前的確認 | 2 與 7 |
| `up`（DNS 啟用時） | 我方項目不在 `dns[0]` 時依 9.6 警告 |
| `stop`（DNS 啟用時） | 5 |
| `stop --all` | 3 與 5 |
| `down`（DNS 啟用時） | 會先撤銷 daemon 設定並重啟 Docker |
| 任何回滾失敗 | 確切的 daemon 路徑與手動修復步驟（見 12） |
| 使用者說明文件（見下） | 完整的第 1–8、10、11 項，以及手動移除步驟 |
| README | 一小段文字加上指向該文件的連結——這份揭露太長，不屬於 README |

`--yes` 只略過「確認」這個互動動作，**不得略過揭露內容的輸出**。

### 11.4 使用者說明文件

這個功能欠使用者的揭露塞不進 README，而硬塞進去只會讓 README 變差，揭露本身也不會變好。它有自己的文件：

| 檔案 | 內容 |
| --- | --- |
| `docs/DNS.md` | 英文的完整使用者說明：啟用 DNS 會對這台機器做什麼、11.3 的每一項揭露、如何關掉它，以及在 CLI 已經不在時如何手動移除 Runestone 的項目 |
| `docs/DNS.zh-TW.md` | 同一份文件的正體中文版 |
| `docs/DNS.ja-JP.md` | 同一份文件的日文版 |

- **一個語言一個檔案，結構相同**，語言與 CLI 本身出貨的一致（`en`／`zh-TW`／`ja-JP`）。使用者既然會用自己的語言看到警告，就必須能用同一個語言讀到警告背後的說明。
- **README 只放一小段文字與連結**，不放說明本身。它說明這個功能是做什麼的、它會全機修改 Docker daemon 設定，以及其餘內容去哪裡讀。
- 這些文件是給使用者看的，與 [`DNS-FEATURE-SPEC.md`](DNS-FEATURE-SPEC.md) 分開；後者是規範性的，寫給維護這個功能的人。

## 12. 失敗處理

| 情況 | 結果 | 可否重試 |
| --- | --- | --- |
| dns 服務綁 53 失敗 | 中止，未修改 daemon 設定；顯示佔用排查指引 | 釋放 port 後可 |
| 解析不到 IPv4 Target IP | 中止 | 修好 Docker 環境後可 |
| 上游清單什麼都偵測不到 | 使用 `1.1.1.1` 並明白告知；**絕不中止**（8.4） | 不適用 |
| 我方一筆可識別、另一筆處於所有權衝突 | 一筆都不移除；中止並回報兩者狀態（9.7） | 對衝突那筆給出 `--assume-index <n>` 後可 |
| daemon JSON 不合法 | 中止，不寫入 | 修正檔案後可 |
| Remote context / Windows container | 拒絕執行 | 切換環境後可 |
| Docker 重啟失敗或逾時 | 反向還原 daemon 設定 | 可 |
| 啟用後 DNS 驗證失敗 | 反向還原並停止 dns 服務 | 可 |
| 反向還原也失敗 | 保留 `phase=prepared`，輸出 daemon 路徑與手動修復步驟 | 手動處理後可 |
| 停用時所有權狀態遺失 | 中止並提示 `--assume-entry` | 可 |
| 使用者把我方項目的值換掉 | 視為已撤銷（9.5）：不改檔案、清除狀態，並回報現在坐在記錄位置上的值 | 不適用；若確實是改名則用 `--assume-entry <ip>` |
| 陣列中有多筆值相符且記錄的 `index` 不符 | 所有權衝突，中止並提示 `--assume-index <n>` | 手動處理後可 |
| 我方項目已被使用者手動移除 | 視為已撤銷，不改檔案，清除狀態 | 不需重試 |
| 我方項目已不在最前面 | 依 `DNS_AUTO_REORDER`：`false` 只警告；`true` 只搬移我方自己那些項目並告知下次 Docker 重啟後生效 | 可 |
| 使用者另外加了指向 Runestone DNS 的重複項目 | 保留該項目，警告移除服務後它將無法解析 | 由使用者處理 |
| setup 中途取消 | 無任何變更 | 可 |

`phase=prepared` 會來自兩種互不相關的情況：還原失敗（上表該列）與刻意的 `--no-restart`（10.1）。`status` 必須區分兩者，因為前者需要手動修復，後者只需要重啟。

## 13. 相容性與遷移

- 既有安裝沒有 `DNS_ENABLE` → 停用，行為完全不變。
- **`compose.yml` 依版本標記重生**（已定案，15.4）：目前 `ensureProjectFiles()` 只在檔案不存在時寫入 compose，升級 CLI 的既有使用者永遠拿不到含 dns 服務的新 compose。版號記在 **Compose 檔自己的標頭**，形式為 `# runestone-compose-template: <n>`；與 CLI 自身的版本不符時就重生並告知使用者。刻意不放在 `.env`：`.env` 是由解析出來的鍵值重寫的，把版號記在那裡會讓一次普通的 `up` 就吃掉使用者的註解。標頭跟著它描述的檔案走，每個 project 各自獨立，也不可能與它漂移。**原有內容絕不能被默默丟掉**：若磁碟上的檔案與該版模板應產生的內容不同，先在原地旁邊備份並在輸出中指名該備份，然後才覆寫。
- `docker/traefik/dynamic/traefik.dynamic.yml` 內 commit `3581211` 加入的 `{{ if env "DNS_ENABLE" }}` 區塊需移除，改由 CLI 產生 route。
- `docker/traefik/entrypoint.sh` 內 commit `3581211` 加入的 `start_dnsmasq()` 與其判斷需移除；runestone image 不再需要 dnsmasq 與 webproc。
- `docker/dns/` 改放新 image 的 Dockerfile 與 entrypoint。
- dns image 必須先發佈（含 arm64），CLI 才能把 DNS 列為可用功能。

## 14. 測試計畫

### 14.1 單元測試（jest，可完全離線）

- daemon JSON 所有權：兩種啟用情形、既有相同 IP 時仍插入且不去重、停用只移除我方那筆、缺 key、缺檔、非法 JSON、Target IP 變更、`--assume-entry`、`--assume-index`。
- 使用者在啟用期間的修改（9.5 每一列都要有測試）：在我方之後新增、在我方之前插入、他處加入重複 Target IP、手動移除我方項目、改掉我方項目的值、我方建立的 key/檔案但使用者加了其他內容、檔案被重新格式化。
- `DNS_AUTO_REORDER` 兩種模式：`false` 只警告且檔案零變更；`true` 只搬移我方自己那些項目、其他項目相對順序不變、各自記錄的 `index` 有更新、且不觸發 Docker 重啟。
- 再入性：重複執行 `up` / `dns enable` 不得插入第二筆我方項目。
- 寫檔保真：原檔縮排風格與其他 key 的順序在寫回後不變。
- 憑證 domain 集合的變化偵測：集合相同時不重啟 `dns` 服務，集合變化時才重啟。
- 上游 DNS：8.4 的決定順序、loopback 與 Target IP 的排除、`1.1.1.1` 作為最後手段，以及在任何輸入下結果清單都**永不為空**。
- 上游的三個 setup 動作——沿用、更換、追加——每一種都要寫出明確的 `DNS_UPSTREAM`。
- 9.7 備援：兩筆項目以正確順序插入且以不同角色記錄；撤銷時兩筆都移除；單獨關掉備援時只移除那一筆；其中一筆衝突時一筆都不移除。
- Bind IP 平台判定。
- compose 渲染：DNS 停用時不含 dns 服務；啟用時 port、profile、image tag 正確。
- `dns-ui.yml` 產生與移除。
- `enable` 與 `disable` 的 `--dry-run`：印出的 diff 與實際執行的結果一致，且**沒有任何一個檔案、服務或狀態被改動**。
- 7.4 的開發用覆寫：設定後引擎只讀寫被導向的路徑，完全不碰平台預設值，且 `status` 會提示它們正在生效。

### 14.2 命令入口測試

- `dns enable` / `disable` / `status` 的成功、失敗、exit code、確認提示、`status` 唯讀性。
- setup 的四個 DNS 題目：預設值（停用、沿用算出的上游清單、備援關閉、自動排序關閉）、錯誤回到同一題、review 摘要顯示四個值、取消不留痕跡。
- 風險揭露（11.3 揭露時機表的每一列都要有測試）：對應的揭露項目確實出現，且帶入實際的 daemon 路徑、Target IP、Bind IP 而非佔位字串；`--yes` 仍然輸出揭露內容。第 11 項必須同時帶有**好處與代價**——只講其中一邊的揭露視為測試失敗。
- `stop` 不會停掉 dns 服務；`down` 在 disable 失敗時中止。
- `certs create` / `remove` 觸發 mapping 重建。

### 14.3 手動平台驗證

| 平台 | 層級 | 由誰執行 |
| --- | --- | --- |
| Linux rootful | 14.5 涵蓋的部分為 T2，其餘為 T3 | dind 涵蓋的部分任何接手者都可做；sudo 與 systemd-resolved 由維護者 |
| Windows Docker Desktop | T4 | 僅維護者 |
| WSL2 | T4 | 僅維護者 |
| macOS Intel 與 Apple Silicon | T4 | 僅維護者 |

每個平台驗證：啟用 → 新 container 的 resolv.conf 首筆為 Target IP → 解析憑證涵蓋的子網域得到 Target IP → 停用後 daemon `dns` 陣列回到原狀（含使用者原有項目）。

- **T4 各列的輸出必須由維護者存進 repo**，讓下一個接手者不必重跑一遍才能信任它。
- 凡是 14.5 能涵蓋的項目，就不該留在只能手動驗證的類別裡——手動平台驗證的本質是做過一次之後就再也不會重跑。

### 14.4 runestone-dns image 驗證

- `linux/amd64` 與 `linux/arm64` 兩個平台都要能啟動，並確認 dnsmasq 同時回應 53/tcp 與 53/udp。
- mapping 產生規則（用 fixture `/ssl` 目錄驗證）：每個 `*.crt` 產生一條 `address=`、排除 `rootCA.crt`、排除非法 domain 檔名、目錄為空時仍能正常啟動。
- **防篡改**：在容器內手改 `/etc/dnsmasq.conf` 與 `/etc/dnsmasq.d/managed.conf` 後重啟容器，兩者內容都被還原；同一次重啟中 `custom.conf` 的內容完全未被覆寫。
- 主機重開機／Docker 重啟後由 `restart: unless-stopped` 拉起時，設定同樣正確，且過程中未執行任何 CLI 命令。
- webproc 修改 `custom.conf` 後，dnsmasq 有被重啟且新規則生效。
- `HTTP_USER` / `HTTP_PASS` 有設時 UI 需要驗證，未設時不需要。

### 14.5 dind 測試載具（風險等級 1，不需虛擬機）

privileged 的 `docker:dind` 容器有自己的 `/etc/docker/daemon.json`、自己的 53 port 命名空間、自己的一組內層容器，而**重啟該容器在語義上就等於重啟 daemon**，但爆炸半徑只有一個容器。已在 Windows 11 + Docker Desktop 29.6.2（內層 engine 29.7.2）實測：

| 驗證項 | 結果 |
| --- | --- |
| 內層 `/etc/docker/daemon.json` | 初始不存在，因此連 `createdDaemonFile=true` 這條路徑都能練到 |
| 寫入 `dns` 陣列後重啟 dind 容器 | 新的內層容器 `/etc/resolv.conf` 依陣列順序列出，我方那筆在最前，並顯示 `Overrides: [nameservers]` |
| dnsmasq 綁內層 docker0 gateway `172.18.0.1:53` | tcp 與 udp 都成功發佈；內層網路命名空間獨立，**不與宿主的 53 port 相爭** |
| `restart: unless-stopped` | daemon 重啟後自動把 dnsmasq 拉回，過程無任何 CLI 介入——即 14.4 第四項的情境 |
| 通配子網域 | `address=/test.local.example/9.8.7.6` 正確回答 `sub.api.test.local.example` |
| 宿主機 | `~/.docker/daemon.json` 逐字未變，宿主容器沒有任何一個被重啟 |

這個載具涵蓋什麼、不涵蓋什麼：

| 涵蓋 | 不涵蓋 |
| --- | --- |
| 6.1 的原生 Linux 那一列（綁 docker0 gateway） | Docker Desktop 那一列：`192.168.65.254` 與必須綁 `0.0.0.0` |
| daemon 設定的寫入 → 識別 → 撤銷 → 重啟完整循環 | `~/.docker/daemon.json` 與 `docker desktop restart`（15.1） |
| 8.2 的 `restart: unless-stopped` 與明確 `dns:` 反迴路 | 9.3 的 sudo 提權路徑（dind 內是 root） |
| 8.3 的 mapping 產生與重生 | 與 systemd-resolved 爭 `127.0.0.53`、與 Windows ICS 爭 53 port |
| — | WSL2 路徑轉換、macOS、Apple Silicon |

由此得到兩個結論：

- **載具本身要進 repo**（`docker/dns/test/`），連同「如何在沒有虛擬機的環境重現 M6a」的說明。留在對話裡它就只是部落知識。
- Linux 虛擬機補上的只有「不涵蓋」欄中屬於 Linux 的那些：sudo、systemd-resolved 與 `systemctl restart docker`。Docker Desktop 的行為只能在真機上驗證（M6b）。

## 15. 待你裁決

以下每一項都有對應的里程碑截止點，見 16.6。**目前只剩第 1 項未定**，而它在 M6b 之前不阻塞任何事。

1. **`docker desktop restart` 是否可用**：實作時偵測，不可用就走「提示手動重啟 + 輪詢等待」。若你已知結論可直接省略自動路徑。
2. **暫定——image 由放在它旁邊的腳本建置與發佈。** `docker/dns/publish.sh` 執行 `docker buildx build --platform linux/amd64,linux/arm64 --push`，發佈 `cymondez/runestone-dns:1.0`，由維護者手動執行。**這明確是一個過渡答案。** 手動發佈出去的 image 不會留下「它是怎麼來的」的紀錄，所以 CI 仍然是目的地；延後的唯一理由是申請 registry token 並把 workflow 跑通需要時間，而 M2 不該等它。`origin` 是自架的 Gitea、GitHub 是鏡像，所以 CI 真的要落地時，Gitea Actions 才是順理成章的第一目標——它的 workflow 語法與 GitHub Actions 足夠接近，檔案兩邊都能搬。在那之前**腳本本身必須進版控**，讓一個已發佈的 image 至少是可以回推出來的；而且腳本必須要求明確給定 tag 才發佈，不得預設成 `latest`。
3. **已定案——`TODO` 寫的「必須讓使用者設定其他 dns 作為備援」由兩個位置共同回答。** dnsmasq 上游（8.4）是**必要且永不為空**，預設 `1.1.1.1`，因為少了它全機 container 就失去對外名稱解析；setup 提供沿用／更換／追加。daemon `dns` 陣列裡的備援（9.7）則是**選用且預設關閉**，因為實測顯示它會把明確的 DNS 失敗換成 Runestone domain 安靜地解析成 `127.0.0.1`。`insertedEntries` 因此是一個自有項目的陣列，M1 一開始就必須照此實作。
4. **已定案——`compose.yml` 依版本標記自動重生。** 標記是 Compose 檔自己標頭裡的一行註解；與 CLI 自身的模板版本不同時就重生 Compose 檔並告知使用者，而磁碟上原有的檔案會先在原地旁邊備份（見第 13 節）。

## 16. 里程碑與風險管控

由本節衍生的工作清單——交付項目、通過條件、安全網程序與證據記錄——在 [`DNS-MILESTONES.zh-TW.md`](DNS-MILESTONES.zh-TW.md)。本節訂原則與排序，該文件追蹤進度。

### 16.1 原則：危險的不是寫入

寫 `daemon.json` 在 Docker 重啟前不會改變任何事。**重啟才是破壞性的那一步，而它可以與寫入在時間上切開。** 7.3 的 `prepared → applied` 切分正是這件事，它意味著整條寫入／識別／撤銷循環——邏輯最多、最容易寫錯的部分——可以在真實 daemon 檔案上演練，而不中斷任何一個容器。

以下里程碑只由一條規則排序：**每個里程碑最多只能把風險等級往上升一級，且下一級必須先全綠。**

| 等級 | 對機器的影響 | 復原方式 |
| --- | --- | --- |
| 0 | 只讀；fixture 與暫存目錄 | 無需復原 |
| 1 | build image、起容器、綁非 53 的 port | 刪掉容器 |
| 2 | 寫真實 `daemon.json`，**不重啟** | 把檔案改回去；期間行為零改變 |
| 3 | 重啟 Docker、綁 53 port | 機器上每個容器重啟一次 |

### 16.2 參與層級

不是每個未來的接手者都能開虛擬機。因此這個功能必須在沒有虛擬機的情況下也能開發與驗證，而且這條界線要明講而不是預設：

| 層級 | 需要 | 誰必須具備 |
| --- | --- | --- |
| T0 | node 與 jest，無需 Docker | **所有接手者（強制基線）** |
| T1 | 任何平台的 Docker | 所有接手者 |
| T2 | `docker:dind`——單一容器（見 14.5） | **所有接手者；已驗證可行** |
| T3 | Linux 虛擬機或真實 Linux 機器 | 僅維護者 |
| T4 | 在真機上重啟 Docker Desktop | 僅維護者，且一次性 |

讓 T0–T2 得以成立的三個機制——7.4 的覆寫、`--dry-run`、`--no-restart`——屬於本規格的要求，不是便利設施。少了它們，T0 與 T1 的接手者完全無法參與這個功能。

### 16.3 里程碑

| # | 內容 | 等級 | 通過條件 |
| --- | --- | --- | --- |
| M0 | 把 `composeService.restart()` 改為服務範圍（10.5，既有缺陷）；加入 7.4 的覆寫；把 16.5 的安全網寫進文件 | 0 | 既有測試全綠；此時還沒有任何 DNS 行為 |
| M1 | daemon 所有權引擎（純函式）：插入、識別、移除、排序、原子寫入、縮排保留 | 0 | 9.5 每一列都有測試，外加不變式測試：任意「啟用 → 使用者修改 → 停用」序列之後，**非我方所有的項目其值、數量與相對順序完全不變**。此時尚未接上任何 CLI 指令，因此無法被觸發 |
| M2 | runestone-dns image 與 entrypoint，多架構 | 1 | 14.4 在 amd64 與 arm64 全綠，且**在非 53 的 port 上驗證，讓這個階段全程不爭 53** |
| M3 | 服務接線與 `dns status`，功能仍關閉：compose profile、`.env`、`custom.conf`、`dns-ui.yml`、compose 模板版本化（13） | 0 | `DNS_ENABLE=false` 時 `up` / `stop` / `down` 與現行行為完全一致；`status` 能正確判讀涵蓋 9.5 所有狀態的手工 daemon 檔案 |
| M4 | **`dns disable` 先於 `dns enable`**，含 `--assume-entry` 與 `--assume-index` | 2（導向路徑） | 能正確撤銷「手動植入、且無所有權記錄」的項目。逃生門必須先於陷阱存在：若 enable 先落地又出錯，就沒有工具可以善後 |
| M5 | `dns enable` 做到 `phase=prepared`，並補上 `--dry-run` 與 `--no-restart`：完整前置檢查、啟動 dns 服務、實際查詢驗證、寫入 daemon——**不重啟** | 2 | 在真機上：`enable --no-restart` → 檢視 diff → `disable` → 檔案與快照逐位元組相同 |
| M6a | dind 載具內的端到端：前置檢查 → 寫入 → 重啟 → resolv.conf → 通配解析 → 停用 → 檔案復原；並刻意注入重啟逾時，證明反向還原真的會還原 | 宿主為 2（載具內為 3） | 在任何接手者的機器上都能跑，**且能進 CI** |
| M6b | 真機與虛擬機：Docker Desktop 的 Target IP 與 `0.0.0.0` 綁定、`docker desktop restart`、Linux 的 sudo 與 systemd-resolved、真實的 53 port 衝突 | 3 | 僅維護者，於排定窗口執行，輸出存進 repo |
| M7 | 生命週期整合、11.3 揭露矩陣、i18n | 3 | 14.2 全綠，11.3 揭露時機表每一列都有測試。這是既有指令第一次碰到 DNS 程式碼 |
| M8 | 14.3 平台矩陣；在 CLI 對外呈現此功能之前先發布 image（含 arm64）（13） | 3 | — |

在 M6a 之前，`DNS_ENABLE` 預設為 false，且沒有任何既有指令路徑會呼叫 DNS 程式碼，因此**每個里程碑都能用單一 `git revert` 完整回退**。這要當成硬約束：不要因為方便就提早把 DNS 接進 `up`。

### 16.4 為什麼 M6a 的意義大於「不需要虛擬機」

dind 載具可以進 CI。這讓「寫 `daemon.json` → 重啟 → 解析」從一次性人工檢查變成**回歸測試**。手動平台驗證的本質就是做過一次之後再也不會重跑；dind 能涵蓋的那部分不該留在這個類別裡。

### 16.5 進 M5 前的一次性安全網

- 把現在的 `daemon.json` 複製到版控之外並記下雜湊值。這是給人用的安全網，不是 Runestone 管理的備份——9.3 禁止整檔還原的規則不變。
- 確認 M4 的 `disable --assume-entry` 對「手動植入、無所有權記錄」的項目確實有效。
- 手動走一遍復原路徑：編輯 `daemon.json`、移除該筆、重啟 Docker。
- 進 M6b 前額外存一份 `docker ps -a`，因為那一步會重啟機器上每個容器。

### 16.6 第 15 節各項裁決的里程碑截止點

| 裁決項 | 截止 | 原因 |
| --- | --- | --- |
| 15.3——備援 DNS 放在 dnsmasq 上游還是 daemon 陣列 | **M1 之前——已定案**：兩者都做，見 8.4 與 9.7 | 它定下了 `insertedEntries` 是自有項目的陣列，M1 一開始就必須照此實作 |
| 15.2——image 的建置與發佈方式、名稱與起始 tag | **M2 之前——暫定**：進版控的 buildx 腳本，發佈 `cymondez/runestone-dns:1.0`；CI 延後，落地時以 Gitea Actions 為先 | 手動跑的發佈，只有在跑它的腳本在 repo 裡時才可追溯 |
| 15.4——`compose.yml` 重生策略 | **M3 之前——已定案**：自動，由 Compose 檔自己標頭裡的版本標記驅動，並備份原有內容 | — |
| 15.1——`docker desktop restart` 是否存在 | M6b 之前 | 可以延後；實作本來就會自行偵測 |
