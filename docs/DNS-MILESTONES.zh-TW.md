# Runestone DNS 實作里程碑

[English](DNS-MILESTONES.md) | 正體中文

## 如何使用這份文件

- **`DNS-FEATURE-SPEC.md` 才是規範來源。** 本文件不重述需求，只負責排序與記錄進度。兩者若有衝突，以規格為準，錯的是本文件。
- **排序規則屬於規範**（規格 16.1）：每個里程碑最多只能把風險等級往上升一級，且下一級必須先全綠。理由在規格 16.1——寫 `daemon.json` 在 Docker 重啟前不會改變任何事，因此絕大部分風險都能延後到兩個明確標示的里程碑。
- 每個里程碑都是可合併的增量。在 M6a 之前，`DNS_ENABLE` 預設為 false，且沒有任何既有指令路徑會呼叫 DNS 程式碼，因此**每個里程碑都能用單一 `git revert` 回退**。這是硬約束，不是願望。
- 標示為「建議」的檔案位置就只是建議；既有路徑不是：交付項目若指向已存在的檔案，那就是要改的那個檔案。
- 不要憑「還沒跑過的測試」勾掉通過條件。

風險等級（規格 16.1）與參與層級（規格 16.2）全文以名稱引用，不在此重複定義。

## 進度總覽

| # | 里程碑 | 風險 | 層級 | 前置 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| M0 | 安全鋼索 | 0 | T0 | — | **已完成**，有一項通過條件因既有原因未綠 |
| M1 | daemon 所有權引擎 | 0 | T0 | M0 | **已完成** |
| M2 | runestone-dns image | 1 | T1 | — | **amd64 已完成**；arm64 未驗證，見 M2 |
| M3 | 服務接線與 `dns status` | 0 | T1 | — | **已完成** |
| M4 | `dns disable` | 2（導向） | T0 | — | **已完成** |
| M5 | `dns enable` 到 `prepared` | 2 | T1 | — | **已完成**，真機通過條件待 16.5 安全網 |
| M6a | dind 載具內端到端 | 宿主 2／載具內 3 | T2 | — | **已完成**，CI 通過條件待 runner |
| M6b | 真機與 VM 驗證 | 3 | T3／T4 | — | **部分完成**：Windows 的非破壞性檢查已完成，中斷與 Linux 尚未 |
| M7 | 生命週期整合與揭露 | 3 | T1／T2 | — | **已完成** |
| M8 | 平台矩陣與發布 | 3 | T3／T4 | M6b、M7 | 未開始 |

M2 與 M1 互不相依，可以並行。其餘是一條鏈。

## 裁決關卡

規格 15 的四項各有里程碑截止點（規格 16.6）。前置裁決未定案時，該里程碑不得開始。**四項現在都已定案。**

| 裁決 | 截止 | 狀態 | 延後定案的代價 |
| --- | --- | --- | --- |
| 3——備援 DNS 放 dnsmasq 上游還是 daemon 陣列 | M1 之前 | **已定案：兩者都做**——dnsmasq 上游為必要且永不為空（規格 8.4），daemon 陣列備援為選用且預設關閉（規格 9.7） | 及時定案。`insertedEntries` 是自有項目的陣列，M1 一開始就照此實作 |
| 2——image 的建置發佈方式、名稱與起始 tag | M2 之前 | **暫定：進版控的 buildx 腳本**，`cymondez/runestone-dns:1.0`。「從 CI 發佈」是延後而非放棄——申請 registry token 需要時間，M2 不該等。**CI 本身用 Drone**，跑在作為 `origin` 的自架 Gitea 上；另保留一份 GitHub Actions workflow 給鏡像 | 及時定案。欠下的債是可追溯性：手動跑的發佈之所以還能回推，只因為腳本在 repo 裡 |
| 4——`compose.yml` 重生策略 | M3 之前 | **已定案：自動重生**，由 `.env` 內的 `COMPOSE_TEMPLATE_VERSION` 驅動；使用者手改過的檔案在被覆寫前先在原地旁邊備份 | 及時定案 |
| 1——`docker desktop restart` 是否存在 | M6b 之前 | **已定案：存在**（CLI plugin `v0.4.3`，除非 detach 否則同步），而且偵測與手動備援兩者都保留——這個 plugin 的版本與 Docker Desktop 分開，較舊的安裝不會有 | 及時定案，靠量測而非假設 |

## M0 — 安全鋼索

**目標。** 讓唯二會碰到全域狀態的操作可被導向他處，並修掉 DNS 否則會繼承的 restart 範圍缺陷。這個里程碑結束時還沒有任何 DNS 行為。

**風險等級 0 · 層級 T0**

**交付項目**

- [x] `runestone-cli/src/services/docker-compose.ts` — `restart()` 改為服務範圍（規格 10.5）
- [x] 呼叫端更新：`runestone-cli/src/services/dynamic-config-manager.ts`、`runestone-cli/src/commands/setup.ts`，以及 grep 找到的其他呼叫端
- [x] 解析 daemon 路徑的地方一律尊重 `RUNESTONE_DNS_DAEMON_PATH`（規格 7.4）
- [x] 重啟 Docker 的地方一律尊重 `RUNESTONE_DNS_RESTART_CMD`（規格 7.4）
- [x] `runestone-cli/tests/services/docker-compose.test.ts` — restart 有帶服務名稱
- [x] 16.5 的安全網程序寫在接手者真的會看到的地方（本文件加上貢獻者文件）

**通過條件**

- [ ] `npm test` 全綠 — 因既有原因未綠，見下方說明
- [x] 原始碼中不再有未指定服務的 `docker compose restart`
- [x] 動態設定變更只重啟 `runestone`

**已落地。** `composeService.restart()` 現在必須帶服務清單，未指定範圍的 restart 連寫都寫不出來；服務名稱一律取自 `COMPOSE_SERVICES`，並有測試確認產生出來的 compose 檔真的宣告了其中每一個名稱。`runestone-cli/src/services/dns/daemon-target.ts` 把 daemon 設定檔路徑與重啟 Docker 的指令收在同一處解析，並尊重 7.4 的兩個覆寫——它只負責解析，目前還沒有任何地方呼叫它。安全網寫在 `AGENTS.md` 的「DNS Feature Rules」，和覆寫、restart 範圍的規則放在一起。

有兩件事是刻意留著的：

- **`npm test` 沒有全綠，原因早於這個里程碑。** `runestone-cli/tests/integration/execution.test.ts` 在 Windows 搭配 Node 20.12 以上會失敗。它靠把 `docker.cmd` 這個 shim 放進 `PATH` 來攔截 Docker，但 Node 已經不再在沒有 shell 的情況下解析或執行 `.cmd`，於是 shim 被跳過、真正的 `docker` 在被改寫過的 `USERPROFILE` 下執行、找不到自己的 compose plugin。比紅燈更嚴重的是後果：**這個假 Docker 在 Windows 上根本從來沒有被走過。** 要修它，得選擇替 CLI 提供一個有文件的 docker 執行檔指向機制，或是在 Windows 明確 skip；那是它自己的裁決，不是 DNS 的事。其餘全綠——162 項中的 161 項。
- **規格 6.2 的 WSL 那一列無法離線判定。** `platformDaemonPath()` 需要 Windows 側的家目錄，而那只能靠檢查 Docker context 得知，因此它選擇丟出錯誤並指名 `RUNESTONE_DNS_DAEMON_PATH`，而不是猜一個要寫進去的路徑。M5 必須在它本來就會檢查 context 的地方把這個值補上。

**回退。** 單一 revert。restart 範圍修正本身就有價值，所以這個里程碑可以在任何 DNS 裁決之前先落地。

## M1 — daemon 所有權引擎

**目標。** 把規格 9 整節實作為對 JSON 文字操作的純函式，不接任何 CLI 指令。這個里程碑結束時，不存在任何使用者可觸發的東西。

**風險等級 0 · 層級 T0**

**交付項目**

- [x] 所有權引擎（建議 `runestone-cli/src/services/dns/daemon-config.ts`）：插入、識別、移除、排序、寫入後重新 parse 驗證的原子寫入、縮排偵測與保留——並且是建立在**`insertedEntries` 這個自有項目清單**（規格 7.3）之上，不是單一筆
- [x] 選用的 daemon 備援項目（規格 9.7）：插在 `dns[1]`、以獨立角色記錄、獨立識別、與 Target IP 那筆一併撤銷——且其中一筆衝突時一筆都不移除
- [x] 依規格 7.3 在 `runestone-cli/src/utils/tool-state.ts` 讀寫所有權狀態，含 `schemaVersion`
- [x] 上游 DNS 的決定方式（規格 8.4）——**結果永不為空**，`1.1.1.1` 為最後手段——與各平台 Bind IP 判定（規格 6.1），兩者皆為純函式且可注入
- [x] 測試放在 `runestone-cli/tests/services/dns/`

**通過條件**

- [x] 規格 9.5 每一列都有測試
- [x] `DNS_AUTO_REORDER` 兩種模式都測：`false` 產生**零**檔案變更；`true` 只搬移我方自己那些項目且絕不觸發重啟
- [x] 再入性：重複啟用不會插入第二筆我方項目
- [x] 寫檔保真：縮排風格與其他 key 的順序在寫回後不變
- [x] **不變式測試**：任意「啟用 → 使用者修改 → 停用」序列之後，非我方所有的項目其值、數量與相對順序完全不變——9.7 備援關閉與開啟兩種情況都要測
- [x] 上游清單在任何輸入下都不為空，包含「偵測不到任何結果」與「`DNS_UPSTREAM` 為空」
- [x] `npm run test:unit` 全綠，且引擎在所有測試中都沒有碰到任何真實檔案

**已落地。** `runestone-cli/src/services/dns/` 下四個模組，測試 60 + 12 + 24 + 9 項：

| 模組 | 內容 |
| --- | --- |
| `json-edit.ts` | JSON 文字的結構掃描器：物件與陣列的區間、縮排、換行風格 |
| `daemon-config.ts` | 規格 9 整節的純函式：插入、識別、移除、重排、再入性調和 |
| `daemon-file.ts` | 唯一不純的部分——讀取、讀回重新 parse 驗證的原子寫入、刪除 |
| `upstream.ts` | 規格 8.4 上游判定與規格 6.1 Bind IP，皆為純函式且可注入 |

**引擎是編輯 JSON 文字，不是重新序列化。** 用 `JSON.parse` 再 `JSON.stringify` 程式碼會短得多，而且一定過不了 M5 的 gate：它會重繪整份文件，使用者行內的巢狀物件、tab 縮排、CRLF 換行都會被默默改寫——那正是規格 9.5 說的「改寫格式本身就是一種破壞使用者修改的方式」。現在每個操作都是 splice，不屬於我方的位元組根本不會被重繪。「啟用後停用回到位元組相同」在九種文件形態上都有測試，包含 tab 縮排、CRLF、行內物件、`{}`、以及結尾沒有換行的檔案。

`--assume-entry` 與 `--assume-index` 結果不需要引擎支援：兩者只是呼叫端把它主張的 recorded entry 講出來，而識別順序第 1 條會先被檢查，所以明確的主張永遠勝過造成它的那個歧義。兩端都有測試。

有三件事要往下帶：

- **規格 9.5 內部有一個矛盾，需要你裁決。** 識別順序第 4 條說「值完全比對不到」等於「使用者已自行移除」，而表格裡「使用者改掉我方項目的值」那一列說同樣的狀態是所有權衝突、必須用 `--assume-entry`。這兩種狀態**在觀察上完全相同**——兩者都只是我方的 IP 不在陣列裡了——沒有任何實作能分辨。引擎採第 4 條（視為已撤銷、不改檔案），並額外回報現在坐在那個記錄位置上的值，讓呼叫端可以精確警告而不必猜。如果你要採較嚴格的讀法，它就得變成「只要我方的值不見就中止」，而那會把「使用者自己刪掉我方項目」這個很常見的情況變成使用者必須手動清掉的錯誤。
- **規格 9.3 的 `dns.lock` 序列化不在這裡。** 它防的是 CLI 併發呼叫，屬於指令層，該在 M4、M5，不屬於純函式。
- **原子寫入的測試會用暫存目錄**，因為那是唯一能證明 rename 語意的方式。沒有任何測試碰到平台的 daemon 設定檔路徑，而純引擎則有測試斷言它連檔案系統與行程能力都沒有。

**回退。** 單一 revert；此時還沒有任何地方 import 這個引擎。

## M2 — runestone-dns image

**目標。** 一個已發佈的多架構 image，每次啟動都產生正確的 dnsmasq 設定，且驗證過程全程不爭 53 port。

**風險等級 1 · 層級 T1**

**交付項目**

- [x] `docker/dns/Dockerfile` — Alpine、dnsmasq、依 `TARGETARCH` 選取的釘版 webproc（規格 8.1）
- [x] `docker/dns/entrypoint.sh` — 每次啟動重生 `/etc/dnsmasq.conf` 與 `/etc/dnsmasq.d/managed.conf`，然後 exec webproc 與 dnsmasq（規格 8.3）
- [x] `docker/dns/publish.sh` — `docker buildx build --platform linux/amd64,linux/arm64 --push`，必須明確給定 tag 才發佈，不得預設成 `latest`（裁決 2，過渡）
- [x] `docker/dns/test/verify-image.sh` — 規格 14.4 的檢查，跑在臨時網路與預先填好的 volume 上，因此不需要任何宿主路徑，也全程不碰 53 port
- [x] 用 fixture `/ssl` 目錄的 image 驗證測試
- [x] webproc 0.4.0 的 `--config`、`--port`、`--user`/`--pass` 旗標對釘定版本確認過（規格 8.1）

**通過條件**

- [ ] 規格 14.4 在兩種架構上全綠 — **目前只有 amd64**，32 項全過；arm64 尚未建置，見下方
- [x] **所有驗證都在非 53 的 port 上進行**，讓這個里程碑全程不與宿主爭 53
- [x] 防篡改：在容器內改掉兩個 Runestone 擁有的檔案後重啟，兩者都被還原，且 `custom.conf` 未被動到
- [x] mapping 規則：每個 `*.crt` 一條 `address=`、排除 `rootCA.crt`、排除非法 domain 檔名、目錄為空時仍能啟動

**已落地。** `docker/dns/` 現在有 `Dockerfile`、`entrypoint.sh`、`publish.sh`、`README.md` 與 `test/verify-image.sh`。amd64 驗證結果：**32 項檢查，32 項通過。**

驗證腳本刻意避開兩件事。它**全程不用 53 port**——服務發佈在 15353——所以「建 image 的里程碑」不會同時變成「第一個去爭真實 DNS port 的里程碑」。它也**不使用任何宿主路徑**：fixture `/ssl` 目錄是由輔助容器填好的 Docker volume，因此在 Windows 的 Git Bash 與 Linux shell 上行為完全一致。（第二點是自己掙來的：早期草稿把容器內路徑直接當參數傳給 `docker exec`，MSYS 把 `/etc/dnsmasq.d/custom.conf` 改寫成了 `C:/Program Files/Git/etc/dnsmasq.d/custom.conf`。現在所有容器內路徑都寫在 `sh -c` 裡面。）

有兩項發現要往下帶：

- **規格原本寫的 webproc 呼叫是錯的，8.1 已修正。** webproc 0.4.0 沒有 `--config`，可寫設定檔的旗標是 `--configuration-file`（`-c`）。`--port`、`--user`、`--pass` 確實存在。順著這次確認多得到兩項改善：`--restart-watch` 讓 `custom.conf` 在**磁碟上**被改動時也會重啟 dnsmasq，覆蓋了使用者用編輯器而非 UI 修改自己檔案的情況；以及 `HTTP_USER` / `HTTP_PASS` 改以環境變數傳入而非旗標，因為命令列上的密碼會出現在容器的行程清單裡。這正是 8.1 要求「在建置時確認」的待辦——四個假設的旗標裡有一個沒有撐過實測。
- **arm64 沒有建起來。** 維護者機器上 Docker Desktop 的預設 builder 只回報 `linux/amd64` 及其變體，arm64 建置在第一個 `RUN` 就以 `exec format error` 失敗——沒有註冊 QEMU handler。補救方式是 `docker run --privileged --rm tonistiigi/binfmt --install arm64` 或改用 `docker-container` driver 的 builder；兩者都會改動 repo 之外的狀態，因此都沒有代為執行。`publish.sh` 會先檢查 builder 的平台清單，並帶著這兩條指令拒絕執行，而不是讓建置在深處才失敗。**這條通過條件維持未打勾**：arm64 一次都沒有編譯過，沒有人應該把這個里程碑讀成「已在 arm64 驗證」。

**帶著走的債。** 發佈路徑是維護者手動執行的腳本，因此除了「腳本在 repo 裡」以外，沒有任何東西記錄一個已發佈 tag 是怎麼來的。之後由 CI 取代；在那之前，已發佈的 tag 與它建置自哪個 commit 只能靠人工對應。

**回退。** 單一 revert。一個沒有被引用的已發佈 tag 無害。

## M3 — 服務接線與 `dns status`

**目標。** 把服務跑起來所需的一切，加上那個後續每個里程碑都用來自我診斷的唯讀指令。功能仍然關閉。

**風險等級 0 · 層級 T1**

**交付項目**

- [x] 依規格 7.1 新增 `.env` 欄位，欄位不存在即視為停用
- [x] compose 模板加入 profile `dns` 下的 `dns` 服務（規格 8.2），image 與 tag 以字面值寫入
- [x] 依裁決 4 在 `runestone-cli/src/utils/project-files.ts` 實作版本化的 `compose.yml` 重生（規格 13）
- [x] `dns/custom.conf` 在服務啟動前就先建立（不存在時才建）（規格 8.3）
- [x] `configuration/dns/dns-ui.yml` 由 CLI 產生與移除（規格 8.5）
- [x] 移除 `docker/traefik/dynamic/traefik.dynamic.yml` 的 `{{ if env "DNS_ENABLE" }}` 區塊，以及 `docker/traefik/entrypoint.sh` 的 `start_dnsmasq()`（規格 13）
- [x] `runestone dns status`，唯讀，輸出規格 10.3 的全部內容
- [x] `runestone-cli/src/i18n/index.ts` — 目前為止新增文案的 `en` / `zh-TW` / `ja-JP`

**通過條件**

- [x] `DNS_ENABLE=false` 時 `up` / `stop` / `down` 與現行行為完全一致——用回歸測試證明，不是目測
- [x] `status` 能正確判讀涵蓋規格 9.5 所有狀態的手工 daemon 檔案，包含我方項目被推移、重複、改值、移除
- [x] `status` 不寫入任何東西，有測試證明
- [x] 規格 7.4 的覆寫生效時 `status` 會顯著提示
- [x] 既有使用者升級到這個版本後行為不變

**新增的測試覆蓋。** 338 項單元測試全綠：產生出來的 Compose 檔現在是被 parse 成 YAML 而不是字串比對（否則一個縮排錯誤只會在使用者機器上以 `docker compose` 錯誤浮現）、每一條重生路徑都有測試（包含「絕不覆寫既有備份」）、規格 9.5 的每一種狀態都透過 `dns status` 斷言過，而報告產生器與指令本身都有測試證明它們讓 daemon 檔案與其目錄保持位元組相同。

**已落地。** 服務可以被跑起來也可以被診斷，而功能仍然是關的。

| 新增 | 內容 |
| --- | --- |
| `.env` 欄位（規格 7.1） | 十個 DNS 鍵，全部預設為關閉或空值，`DNS_ENABLE` 不存在即視為停用 |
| Compose `dns` 服務（規格 8.2） | 置於 `profiles: [dns]` 之後，image 與 tag 寫死，53 port 依 `DNS_BIND_IP` 綁定 tcp 與 udp |
| 版本化重生（規格 13） | 模板版本不符時 `ensureProjectFiles()` 重生 `compose.yml`，並先備份原有內容 |
| `dns/custom.conf` | 不存在時建立，且永不覆寫 |
| `configuration/dns/dns-ui.yml` | 由 CLI 產生與移除（規格 8.5） |
| `runestone dns status` | 唯讀，回報規格 10.3 的全部內容 |
| i18n | `en`／`zh-TW`／`ja-JP` 各 56 個字串 |

依規格 13 從 runestone image 移除：`docker/traefik/dynamic/traefik.dynamic.yml` 的 `{{ if env "DNS_ENABLE" }}` 區塊，以及 `docker/traefik/entrypoint.sh` 的 `start_dnsmasq()`。那個 image 裡不再有任何 dnsmasq 相關的東西。

**`syncDnsUiRoute()` 存在，但刻意沒有從 `up` 呼叫。** 16.3 節規定 M6a 之前不得有任何既有指令路徑呼叫 DNS 程式碼，這樣每個里程碑才能各自 revert；生命週期接線是 M7 的工作。

三處與規格的偏離，全部已改寫進規格，而不是留在程式碼裡當意外：

- **模板版本標記放在 Compose 檔自己的標頭，不放 `.env`。** 規格 13 原本建議 `.env`，那是個陷阱：`envLoader.write()` 是由解析出來的鍵值重寫 `.env` 的，把標記記在那裡，會讓一次普通的 `up` 就吃掉使用者環境檔裡的所有註解。標頭註解跟著它描述的檔案走，每個 project 各自獨立，也不可能與它漂移。
- **`DNS_CONTAINER_RESOLVER` 是新增的（規格 7.1、8.2）。** 規格 8.2 要求 dns 服務明確設定 `dns:`，讓 daemon 的設定不會把容器指回它自己。Compose 無法把逗號分隔的 `DNS_UPSTREAM` 展開成 YAML 序列，而把清單烤進模板又會讓「改上游」綁上「重生 Compose」。一個專用鍵、預設 `1.1.1.1`，就回答了它。風險很低——image 本來就以 `no-resolv` 執行 dnsmasq，所以這是縱深防禦，不是真正的迴圈防護。
- **`preparedReason` 是新增的（規格 7.3）。** 第 12 節要求 `status` 必須分辨「刻意的 `--no-restart`」與「反向還原失敗的殘留」，而 7.3 的紀錄裡沒有任何欄位能承載它。它是選用欄位，因此不動 `schemaVersion`；欄位不存在時 `status` 會說「未被記錄」，而不是去猜。

**回退。** 單一 revert。注意 traefik 模板與 entrypoint 的移除是對 runestone image 的改動；若該 image 獨立發布，要排好順序，避免舊 CLI 遇到期待「路由由 CLI 產生」的新 image。

## M4 — `dns disable`

**目標。** 先造逃生門，再造陷阱。如果 enable 先落地又出錯，就沒有任何工具可以善後。

**風險等級 2（僅導向路徑） · 層級 T0**

**交付項目**

- [x] `runestone dns disable`，實作規格 9.2 與 10.2
- [x] `--assume-entry <ip>` 與 `--assume-index <n>`（規格 9.3）
- [x] `--dry-run` 印出前後 diff 且不寫入任何內容（規格 10.2）
- [x] 所有權衝突路徑一律中止並輸出 daemon 路徑與手動修復步驟，絕不猜測
- [x] `runestone-cli/tests/commands/` 的命令入口測試

**通過條件**

- [x] 能透過 `--assume-entry` 撤銷「手動植入、**且無所有權記錄**」的項目
- [x] 規格 12 中結果為「中止」的每一列都真的中止且未寫入
- [x] 我方項目已被使用者移除時視為已撤銷：不動檔案、清除狀態、不報錯
- [x] 全部以 `RUNESTONE_DNS_DAEMON_PATH` 驗證，並能證明平台預設的 daemon 檔案未被碰過
- [x] `--dry-run` 的輸出與之後實際執行的結果一致

**已落地。** `runestone dns disable`，背後有 53 項測試。

指令拆成**計畫與套用**兩段，因此 `--dry-run` 不是另一份可能與正式路徑漂移的實作：試跑印出計畫，正式跑套用同一份計畫。有測試逐行斷言兩者輸出一致。

| 拒絕的情況 | 它不猜，改做什麼 |
| --- | --- |
| 沒有所有權紀錄，也沒有任何主張 | 指名檔案，並告訴使用者怎麼講明白：`--assume-entry <ip>` |
| 多筆項目與我方的值相符 | 列出衝突的位置，要求 `--assume-index <n>` |
| 紀錄是對著另一個檔案寫的 | 拒絕去動一個不是它寫的檔案 |
| daemon JSON 不合法 | 不寫入就中止，並說出它哪裡壞了 |

以上每一種都有測試證明事後磁碟上的檔案位元組相同。

有三個性質值得寫下來，因為每一個都是決定而非巧合：

- **沒有變動就不重啟。** 當使用者已經自己把我方項目刪掉時，檔案不動，而且**不重啟** Docker——為了套用「什麼都沒有」而終止機器上每一個 container 是不划算的。其餘清理照跑、紀錄照清，這正是規格 9.5 要求的。
- **鎖只在寫入時持有，不跨越確認提示。** 一個離開座位不回答提示的使用者，不該卡住之後的每一次執行。因此計畫會在鎖內重新建立一次，並與先前顯示過的那份比對；若期間檔案被改動，就什麼都不寫並要使用者重看。「你看到的就是會發生的」是被檢查的，不是被假設的。
- **diff 標記的是位置，不是值。** 用值比對會在最要緊的地方出錯：當使用者複製了我方的位址時，兩行一模一樣的內容裡只有一行是我們的，而 diff 必須指出是哪一行。早期草稿就是這樣寫錯的，被測試抓到。

順帶新增：`composeService.removeServices()` 與 Compose profile 支援，因為移除 dns 服務必須指名它的 profile（規格 8.2）。

**已對導向的 daemon 檔案端到端驗證**——一筆手動塞進去、沒有任何所有權紀錄的項目，用 `--assume-entry` 移除：使用者自己的項目值與位置都保留、帶巢狀行內物件的 `builder` 區塊位元組不變、`.env` 被改成 `DNS_ENABLE=false`，而 dns 服務移除失敗（測試用專案裡沒有 Compose 檔）時**如實說出來**，沒有假裝成功。平台的 `daemon.json` 已確認未被動到。

實跑也抓到一個單元測試不會抓到的真缺陷：有 blocker 時原本會先印計畫，於是「沒有東西要改」出現在錯誤訊息上方——讀起來像是陣列空的，但重點其實是「Runestone 不擁有裡面的東西」。現在有 blocker 就只印 blocker。

**回退。** 單一 revert。

## M5 — `dns enable` 到 `prepared`

**目標。** 完整的啟用路徑，只差重啟。這是第一個會寫入真實 `daemon.json` 的里程碑，而因為它不重啟，演練期間那次寫入對機器沒有任何效果。

**風險等級 2 · 層級 T1**

**開始這個里程碑之前，先完成 16.5 的安全網。**

**交付項目**

- [x] `runestone dns enable` 的規格 10.1 第 1–4 步：不改動任何狀態的前置檢查、`.env` 與專案檔案、啟動 dns 服務、由一次性容器實際查詢驗證、寫入所有權狀態、原子寫入 daemon
- [ ] `--no-restart` 刻意停在 `phase=prepared`（規格 10.1、11.1）——這裡 enable 一律就是這個**行為**；**旗標**本身等 M6a，理由見下
- [x] `--dry-run` 只做前置檢查，然後印出 diff 並結束
- [x] Target IP 變更處理（規格 9.4）與調和路徑（規格 9.5）
- [x] 每一種失敗都有反向還原；還原本身失敗時保留 `phase=prepared` 並輸出手動修復資訊
- [x] 修改 daemon 前的確認揭露，帶入實際數值（規格 11.3）

**通過條件**

- [ ] 在真機上：`enable --no-restart` → 檢視 diff → `disable` → daemon 檔案與 M5 前的快照**逐位元組相同**——**維護者步驟**：真正的 enable 會綁定主機 53 port（等級 3），且需先完成 16.5 安全網。在那之前已在指令層以真實檔案 I/O 證明
- [x] 同樣的循環，但事先手動加入一筆使用者項目：該項目完好未被動到——在指令層
- [x] 前置檢查失敗時不留下任何 `.env`、服務、狀態或 daemon 變更
- [x] 第 3 步驗證失敗時停掉服務並還原 `.env`，且 daemon 檔案從未被開啟寫入
- [x] `--dry-run` 不寫入任何東西，用前後檔案內容比對證明
- [x] 揭露輸出含實際的 daemon 路徑、Target IP、Bind IP——不是佔位字串，已對這台機器驗證

**已落地。** `runestone dns enable` 走完規格 10.1 的第 4 步，停在 `phase=prepared`。62 項測試。

**步驟的順序本身就是安全性質。** daemon 設定最後才寫、最先被還原，因此每一種可能的失敗——Docker 不可用、遠端 context、Windows 容器、服務起不來、服務起來了但不回答——都發生在機器的全域 DNS 還完全沒被碰過的時候。三項測試就是在斷言這件事：服務啟動失敗、驗證失敗、daemon 寫入失敗這三種情況下，`writeDaemon` 從未被呼叫，而 `.env` 已被還原。

所有權紀錄寫在檔案**之前**。陣列裡有一筆沒有紀錄的項目，是沒有人能撤銷的孤兒；紀錄存在但檔案裡沒有東西，只是紀錄錯了，而 `disable` 本來就處理得了。

三處刻意偏離交付清單，每一處都有理由：

- **`--no-restart` 沒有實作，也刻意不接受這個旗標。** 這個里程碑裡 `enable` 一律停在 `prepared`，因此一個指名「唯一存在的行為」的旗標，等於宣稱使用者有一個他其實沒有的選擇。它會跟重啟本身一起在 M6a 落地。那個旗標所指的行為，就是這個指令今天的行為。
- **真機的通過條件沒有打勾。** 真正的 `enable` 會綁定主機 53 port，那是風險等級 3——高於本里程碑的等級 2——而 16.5 的安全網是維護者的步驟，不是實作能代勞的。目前已證明的是：「啟用後停用回到位元組相同」在指令層以真實檔案 I/O 驗證過，涵蓋三種陣列形態，其中一種帶有既存的使用者項目。
- **`--dry-run` 對真實的 `~/.docker/daemon.json` 跑過**，那是唯讀因而是等級 0。它確認十一項揭露全部印出這台機器的真實值：實際的 daemon 路徑、從 Docker 內部解析出的 Target IP（`192.168.65.254`）、Bind IP、UI 網址與上游清單。

那次實跑值回票價，因為它暴露了一個單元測試不會抓到的缺陷。第 10 項回報上游是 `1.1.1.1` 且**來源是 `.env`**——但使用者的 `.env` 根本沒有這個鍵。是 loader 自己的預設值冒充成使用者做過的選擇，於是**規格 8.4 的偵測步驟永遠不會執行**。在只允許內部解析器的網路上，這台機器上每一個容器的查詢都會被默默轉送到公用解析器。現在 loader 讓 `DNS_UPSTREAM` 保持空值，永不為空的保證住回它該在的地方，規格 8.4 也已更正——它原本同時主張「1.1.1.1 是 `DNS_UPSTREAM` 的出廠預設」與「偵測仍會先於公用預設被嘗試」，這兩件事不可能同時成立。8.4 的第二個偵測來源（`dns.getServers()`）原本也漏了，現在已接上，並會濾掉 systemd-resolved 的 stub。

**回退。** 單一 revert，另外在任何跑過 enable 的機器上執行 `dns disable`。

## M6a — dind 載具內端到端

**目標。** 在爆炸半徑只有一個容器的沙箱內，證明含 daemon 重啟的完整循環——好讓沒有虛擬機的接手者也能做，也好讓 CI 能反覆做。

**宿主風險等級 2、載具內 3 · 層級 T2**

**交付項目**

- [x] `docker/dns/test/` — 規格 14.5 的載具，以及「不用虛擬機重現本里程碑」的說明
- [x] 載具內的完整循環：前置檢查 → 寫入 → 重啟 → resolv.conf → 通配解析 → 停用 → 檔案復原
- [x] 刻意注入重啟逾時，證明反向還原真的會還原
- [x] 載具接進 CI —— `.drone.yml`（Drone，對著自架 Gitea）與給鏡像用的 `.github/workflows/dns-harness.yml`，兩者呼叫同一批腳本

**通過條件**

- [x] 完整循環在載具內通過
- [x] 注入的重啟逾時導致 daemon 檔案被還原，而不是留下半套狀態
- [x] 沙箱 daemon 重啟後 `restart: unless-stopped` 把 dnsmasq 拉回，過程無任何 CLI 介入
- [x] 能證明整趟執行都沒有動到宿主的 daemon 檔案與容器
- [ ] 在 CI 上也通過，不只是本機 —— **pipeline 寫好了，但從來沒有跑過**，那需要一個指向這個 repo 的 Drone runner。沒有跑過的 pipeline 不算是通過的檢查

**已落地。** `docker/dns/test/dind-harness.sh`，13 項檢查全過。

沙箱裡的 daemon 跑在一個小小的監督迴圈下，而不是當容器的 entrypoint。**這是整個手法的關鍵**：殺掉它是一次真的 daemon 重啟，而容器連同裡面的 CLI 與檢查都還活著，可以觀察結果。一個 pause 檔讓載具也能讓 daemon「不要回來」，於是逾時回滾能在數秒內演練，而不是等真正的 120 秒上限。

一次跑完就證明：從 Docker 內部解析 Target IP、寫入 daemon 設定、真的重啟、新容器拿到我方位址當第一個 nameserver、萬用子網域可解析、`restart: unless-stopped` 在裸重啟後自行把 dnsmasq 帶回來（沒有任何 CLI 指令參與）、注入的重啟失敗把檔案還原而不是留下半套、`disable` 回到起始狀態。最後明確斷言宿主自己的 daemon 設定與容器清單全程未被動到。

**沒有任何東西是 bind mount 進沙箱的。** bind mount 是由 **daemon** 解析的，所以「腳本執行處存在的路徑」不一定在「daemon 所在處」存在——而那正是 CI 的處境：那裡的 step 本身就是一個容器。檔案改為透過 Docker API 送進去，於是載具不在乎它對話的是誰的 daemon。

**載具第一次跑就值回票價**，抓到一個單元測試不會抓到的東西：`isWsl()` 在沙箱裡回傳 true。Docker Desktop 的 Linux VM 跑在 WSL2 上，所以它上面每一個容器都回報 Microsoft 核心——那個本來要用來辨識 WSL 的字串，同樣會把普通的 Linux 容器辨識成 WSL，於是 daemon 路徑從容器裡去找一顆 Windows 磁碟。

**規格 6.2 的 WSL 那一列是被移除，不是被修好。** 兩個理由，第二個才是定案的那個：

- Windows 的支援就是在 **Windows 上**執行 CLI。使用者的 Docker 剛好裝在 WSL 裡是 Docker Desktop 的事。一條沒有人跑、也沒有人測得到的「受支援路徑」，比沒有這條路徑更糟。
- 它需要的偵測根本做不到。WSL 與 Docker Desktop 上任何容器的核心字串完全一樣，所以根本沒有東西可以拿來偵測。

那一列原本要防的風險是真的，而且仍然有處理，只是改成問一個有可靠答案的問題：**若 `docker info` 回報 daemon 是 Docker Desktop，而 CLI 卻跑在 Linux 上，前置檢查一律拒絕。** 那個 daemon 的設定在 Windows 那一側，因此寫入這個檔案系統的 `~/.docker/daemon.json` 會回報成功，卻只改到一個 Docker 從來不讀的檔案——正是這個功能要消滅的「安靜地給出錯誤答案」。`isWsl()` 在 M0 把它復活之前本來就是死程式碼，已刪除。

**回退。** 單一 revert。這是最後一個具備這個性質的里程碑。

## M6b — 真機與 VM 驗證

**目標。** 補上載具無法涵蓋的部分：Docker Desktop 的定址與重啟機制、Linux 的提權與 systemd-resolved，以及真實的 53 port 衝突。

**風險等級 3 · 層級 T3／T4 · 僅維護者**

**這是唯一會刻意中斷一台正常工作機器的里程碑。** 要排時間。先存 `docker ps -a`（見下方檢查清單）。其他一切都已由 M6a 證明過。

**交付項目**

- [x] Docker Desktop：Target IP `192.168.65.254` 已確認、全介面綁定已發佈且會回應、`docker desktop restart` 已確認存在——重啟本身尚未實際執行
- [ ] 原生 Linux：需 sudo 的 `/etc/docker/daemon.json`、佔著 `127.0.0.53` 的 systemd-resolved、`systemctl restart docker`
- [x] 實際觸發一次 53 port 衝突，確認規格 6.1 那條規則——port 可用性由「啟動服務」決定，不由讀 netstat 決定；netstat 說被佔、只看 TCP 說是空的，只有真的啟動才給出答案
- [x] 證據存入 `docs/evidence/dns/`——Windows 部分；Linux 那一列仍是空的

**通過條件**

- [ ] 啟用 → 新容器 `resolv.conf` 首筆為 Target IP → 憑證涵蓋的子網域解析為 Target IP → 停用 → daemon `dns` 陣列回到原狀，含使用者原有項目——**子網域那一半已經證明**（憑證涵蓋網域的萬用子網域，透過真正產生出來的 Compose 檔解析到 Target IP）；daemon 寫入、重啟與撤銷需要那個約好的時間窗
- [ ] Linux 上 sudo 失敗時中止且未部分寫入
- [x] 下方證據記錄已填寫——Windows 部分

**部分落地，於 Windows + Docker Desktop。** 證據：[`docs/evidence/dns/m6b-windows-docker-desktop.zh-TW.md`](evidence/dns/m6b-windows-docker-desktop.zh-TW.md)。**沒有寫過真實 daemon 檔，Docker 也沒有重啟過**——前後 SHA-256 相同，container 也是同樣 17 個。

**裁決 1 有答案了**：`docker desktop restart` 存在（CLI plugin `v0.4.3`），除非指定 detach 否則是同步的。偵測與手動備援兩者都保留，因為這個 plugin 的版本與 Docker Desktop 分開，較舊的安裝不會有它。

**這個里程碑還沒走到破壞性步驟就已經值回票價**，因為它抓到一個會讓 `dns enable` 在大多數 Windows 機器上失敗的 bug。

這台機器本來就有一個真的 53 埠衝突，不是誰安排的：Windows 的 Internet Connection Sharing 服務佔著 `0.0.0.0:53/udp`，而啟用它的正是 WSL2——所以這是「跑著 Docker Desktop 的 Windows 機器」的預設狀態，不是特例。在這個前提下，同一個意圖的兩種寫法行為並不相同：

- `-p 53:53/udp` 能啟動，而且 container 可以從 Target IP 打到服務。
- `-p 0.0.0.0:53:53/udp` 直接以 `bind: Only one usage of each socket address` 失敗。

**Compose 模板寫的是第二種。** 規格 6.1 對 ICS 的那筆觀察本身沒有錯——但它是用不帶位址的寫法量的，而實作把位址明寫出來，兩者被當成可以互換。這在 `docker compose up` 上也重現過，不只是 `docker run`；而那才是真正會執行的那一層。

修法是從 `DNS_BIND_IP` 推導出 `DNS_BIND_PREFIX`：全介面綁定時為空，指名單一介面時為 `<位址>:`，因此 Linux engine 仍然會明確綁定 docker0 gateway。`DNS_BIND_IP` 的意義以及它在揭露第 4 項裡的位置都不變；改變的只有 Compose 的寫法。Compose 模板版本 2 → 3。

**第二個發現與規格 6.1 自己給的理由相牴觸。** 表格說 Docker Desktop 必須綁 `0.0.0.0`，因為主機上沒有哪張介面持有 Target IP。但服務**只**發佈到 `127.0.0.1:53` 時，container 仍然能從 `192.168.65.254:53` 打到它，並有「服務停止」的反向對照確認回應來源。所以 `DNS_BIND_IP=127.0.0.1` 在 Docker Desktop 上是可行、而且更緊的設定。這裡沒有把它設成預設：macOS 上沒有量過，而一個只在兩個 Docker Desktop 平台其中之一被證實的預設值，不算預設值。那是 M8 平台矩陣的一列。

**16.5 的逃生口有實際演練過**：對著一筆手動塞進去、沒有所有權紀錄的項目，不給 `--assume-entry` 時拒絕，給了之後精準移除指定的那一筆，無關的項目與無關的鍵都沒有被動到。

**這台機器上的 WSL 發行版確認了「取代 WSL 偵測」的那個拒絕。** `Ubuntu-26.04` 有 systemd、systemd-resolved 與 Docker Desktop 整合，但沒有自己的 daemon；從它裡面執行 `docker info` 會回報 `Docker Desktop`——正是 `docker-desktop-elsewhere` 所依據的訊號，在舊的核心字串偵測分辨不出任何東西的地方，它確實存在而且正確。

**安全網現在是一個腳本**，`docker/dns/test/m6b-safety-net.sh`，取代了檢查清單原本那兩行 `cp`——見規格 16.5。它負責擷取、比對與還原，而且會拒絕為「Docker 並不會讀的那個 daemon 檔」重啟 Docker。這道防護不是假設出來的：這個腳本曾在自己的測試過程中，對著一個暫存檔操作卻重啟了一台正在工作的機器。

**機器做了兩件不在任何人清單上的事**，兩件都是在測試安全網時發現的，而不是在里程碑本身的流程裡。兩件都還沒寫進規格，因為都還沒有被乾淨地量過。

**`unless-stopped` 可能撐不過 `docker desktop restart`。** 重啟之後三十秒，六個 `unless-stopped` 的容器還躺著，而兩個 `always` 的都回來了。如果成立，影響遠不只是整潔問題：規格 8.3 正是靠 `restart: unless-stopped` 讓 dns 服務在 Docker 重啟後「完全不需要 CLI 介入」就回來，而 M6a 確實驗證過這件事——但它是用**砍掉** `dockerd` 的方式，那是崩潰，不是優雅關機。走這條路的話，`completeEnable` 會重啟 Docker、發現 dns 服務不見了、resolv.conf 與解析檢查失敗，然後把 daemon 的寫入反向還原。方向是安全的，但同時也等於 `dns enable` 在 Docker Desktop 上永遠不會成功。這次的觀察被「`docker start` 與重啟賽跑」污染了，所以**真正的那一輪必須把它量乾淨**：重啟，然後只看，什麼都不要碰。

**在 Windows 上重啟 Docker，可能讓前一刻還在發佈的埠變成不可用。** Docker 停著的那段時間，`winnat` 把 TCP 1025–1124 收成動態排除範圍，於是 `runestone` 容器再也無法為 Mailpit 發佈 1025——`netsh int ipv4 show excludedportrange` 可以確認那個範圍，而釋放它需要以管理員權限執行 `net stop winnat`。53 埠不受影響，因為這台機器的動態範圍從 1025 起算；但這個功能發佈的任何高於它的埠都會受影響。

**剩下什麼，以及為什麼。** 破壞性循環需要一個約好的時間窗：這台機器上跑著 12 個 container，其中好幾個是有狀態的，而重啟 Docker 會把它們全部終止。原生 Linux engine 則需要一台真的有的機器；這裡的 WSL 發行版只帶 Docker Desktop 整合，所以 `/etc/docker/daemon.json`、`sudo`、`systemctl restart docker` 與 systemd-resolved 的 `127.0.0.53` 全都還沒驗證。

## M7 — 生命週期整合與揭露

**目標。** 把 DNS 接進使用者本來就會執行的指令。這是既有指令第一次碰到 DNS 程式碼，因此也是 DNS 缺陷第一次可能影響到「從未執行 `dns enable` 的人」。

**風險等級 3 · 層級 T1／T2**

**交付項目**

- [x] 依規格 10.4 處理 `up`、`stop`、`stop --all`、`down`、`certs create`、`certs remove`、`doctor`
- [x] setup 的四個題目與其說明（規格 11.2），含上游的沿用／更換／追加動作與備援的選用開關
- [x] 完整的規格 11.3 揭露矩陣——除了文件那兩列，它們是檔案而不是時機，屬於 M8
- [x] `DNS_AUTO_REORDER` 兩種模式的行為（規格 9.6），且絕不重啟 Docker
- [x] 完整的 `en` / `zh-TW` / `ja-JP` 翻譯——每個語系 461 個鍵，數量一致

**通過條件**

- [x] 規格 14.2 全綠，且規格 11.3 揭露時機表每一列都有測試
- [x] 揭露帶入實際數值，且 `--yes` 仍會輸出
- [x] 揭露第 11 項**同時**陳述 9.7 備援的好處與代價，且 setup 題目讀起來像建議而非判決
- [x] `stop` 保留 dns 服務執行；`stop --all` 停掉它之前先警告
- [x] disable 失敗時 `down` 中止且不進行任何破壞性清理
- [x] 只有在 domain 集合確實變化時，`certs` 變更才重建 mapping——在服務層有覆蓋；指令端的接線只有一次呼叫，沒有另外驅動，因為 `certs create` 會實際跑 mkcert
- [x] `doctor` 只回報，絕不自動修正
- [x] DNS 停用時，上述每個指令的行為逐字不變

**已落地。** `services/dns/lifecycle.ts` 與 `commands/dns-notices.ts`，加上 setup 的四個題目。新增 41 個測試；單元測試 517 中通過 515，唯一的失敗是 M6a 就已存在的 Windows 載具問題。

**這個檔案存在的目的只為守住一條規則：日常指令裡沒有任何東西會重啟 Docker。** `up` 可能偵測到 Target IP 換了，或是有東西插到我方前面；這兩種情況它都只寫入 daemon 設定就停手——並且在同一口氣裡說清楚：這個變更要等下次重啟 Docker 才生效。一個一天會跑好幾次的指令，不可以有權力終止整台機器上的每一個 container。發生這種情況時，所有權紀錄會退回 `phase: prepared`，因為它現在正是那個狀態：一筆已寫入、但 Docker 還沒讀到的變更。

**`stop` 是刻意保留 dns 服務執行的。** daemon 還指著它，停掉它會讓這台機器上每一個 container 的名稱解析壞掉，包含與 Runestone 毫無關係的專案。`--all` 會連它一起停，而且是在 container 倒下**之前**就把這兩件事講出來——等 DNS 已經全機壞掉才出現的警告是驗屍報告，不是揭露。

**`down` 先撤銷再破壞，撤不掉就中止。** 在 daemon 還指著它的時候移除 dns container，正是這個功能存在要防止的那種失敗；因此撤銷被阻擋、重啟沒有發生、或檔案驗證不過，任何一種都會讓拆除停下來，而且什麼都不移除。

**憑證變更是去問容器，不是去查一份記住的清單。** 「domain 集合有沒有變」真正的問法是「執行中容器的 `managed.conf` 跟磁碟上的憑證還一不一致」，而答案只存在容器裡：image 拉取、crash 重啟、主機重開，三者都會在完全沒有 CLI 參與的情況下重新產生它（規格 8.3），一份記住的清單會跟這三件事全部脫節。不一致時，就做一次服務範圍的重啟——一個容器，我方自己的。

**`doctor` 只回報，絕不修正。** 它用到的每一個相依都是讀取，而且有測試斷言結束後 daemon 檔案逐位元組相同。從診斷指令自動修正 `dns` 陣列，正是規格 9.3 禁止的那種猜測：那個陣列裡有不屬於我方的項目，而診斷指令是最不該去決定「哪一個是」的地方。

**setup 問完四題，什麼都不啟用**——見規格 11.2 的增補。它寫入三個設定、跑一次唯讀的前置檢查（讓不適合的機器當場說出來），然後把使用者交給 `dns enable`。它在任何方向上都不會寫 `DNS_ENABLE`：寫 `true` 等於在 daemon 設定空無一物的情況下宣稱 DNS 已開啟，寫 `false` 則會安靜地讓一筆已經存在的項目變成孤兒。

**揭露矩陣是「每一列一個測試」，不是一個總結。** `tests/commands/dns-disclosure.test.ts` 驅動規格 11.3 揭露時機表的每一個時機，包含 setup 那四題——做法是把 clack 的 prompt 類別換成假件後直接驅動 `runSetup`，於是渲染出來的 description 可以被讀回來斷言。`dns enable` 那一列是**按編號**斷言全部十一項，而不是抽樣；`--dry-run` 與 `--yes` 兩條路徑則證明了跳過提示不會連揭露一起跳掉。

另有一段配套斷言守住這個里程碑的另一半：DNS 關閉時，`up` 不帶 profile 啟動專案、`stop` 就是它一直以來那個不分服務的專案停止、`down` 直接拆除不撤銷也不重啟、`doctor` 一個字都不提。

**真的去跑一次 `doctor` 又抓到兩個缺陷，兩個都不是單元測試會抓到的。**

第一個：**daemon 路徑是逐位元組比對的**，所以在 Windows 上 `C:/x/daemon.json` 與 `C:\x\daemon.json`——同一個檔案，差別只在誰怎麼打的——會被判定為不一致。而那個比對正是讓 `dns disable` 拒絕動作的依據，於是失效模式是「**誤判**而拒絕移除一筆真的屬於 Runestone 的項目」，並且印出兩條使用者看起來一模一樣的路徑。`sameDaemonPath()` 現在會把兩邊 resolve 過，並且只在 Windows 上折疊大小寫；這個問題在 `disable` 裡本來就存在，而 M7 差一點把它擴散到 `up` 與 `doctor`。

第二個：**`doctor` 回報了一個失敗的 DNS 檢查，然後在結尾說「環境檢查已通過」**，因為它的判定只看主機工具檢查。DNS 啟用時，dns 服務沒在跑不是外觀問題——機器的 Docker daemon 正指著它——所以 DNS 檢查失敗現在會讓 `doctor` 以非零結束，並且用自己的結語：主機環境沒問題、沒有東西需要安裝，這跟原本那句失敗訊息叫使用者去做的事正好相反。

**回退。** 單一 revert 接線的那個 commit。DNS 服務本身不受影響，所以回退會讓既有指令回到 M7 之前的行為，而不會動到已經套用 DNS 的安裝。

## M8 — 平台矩陣與發布

**目標。** 出貨。

**風險等級 3 · 層級 T3／T4 · 前置：M6b**

**交付項目**

- [ ] 完成規格 14.3 平台矩陣，T4 各列的輸出存進 repo
- [ ] 在 CLI 對外呈現 DNS 之前**先**發布兩種架構的 image（規格 13）
- [ ] `docs/DNS.md`、`docs/DNS.zh-TW.md`、`docs/DNS.ja-JP.md`——完整的使用者說明，一個語言一個檔案且結構相同，涵蓋揭露項目 1–8、10、11 與手動移除步驟（規格 11.4）
- [ ] README 只加一小段文字與指向該文件的連結，不加其他：這份揭露太長，不屬於 README

**通過條件**

- [ ] 規格 14.3 表格每一列都是已完成，或明確記錄理由後延後
- [ ] 全新安裝與自前一版升級，在 DNS 關閉時都行為正確
- [ ] 文件寫明移除 Runestone 前必須先執行 `runestone dns disable`
- [ ] 使用者說明文件的每個語言版本涵蓋相同項目——使用者既然用自己的語言看到警告，就要能用同一個語言讀到說明

## 安全網檢查清單

### 進 M5 前——第一次寫入真實 daemon 檔案

```bash
cp ~/.docker/daemon.json ~/daemon.json.pre-runestone-dns && sha256sum ~/daemon.json.pre-runestone-dns
```

原生 Linux 的路徑是 `/etc/docker/daemon.json`。若檔案不存在，把「不存在」這件事記下來——`createdDaemonFile=true` 是另一條撤銷路徑（規格 9.2）。

- [ ] 已在版控之外取得快照並記錄雜湊
- [ ] 已確認 M4 的 `disable --assume-entry` 對「手動植入、無所有權記錄」的項目確實有效
- [ ] 已手動走過一遍復原路徑：編輯檔案、移除該筆、重啟 Docker

這份快照是給人用的安全網，**不是** Runestone 管理的備份：規格 9.3 依然禁止整檔還原，因為還原檔案會連帶丟掉這期間發生的其他無關修改。

### 進 M6b 前——那唯一一次刻意中斷

```bash
sh docker/dns/test/m6b-safety-net.sh capture
```

它會快照 daemon 檔與其雜湊、Runestone 的工具狀態，以及每個執行中的容器連同它的 restart policy。`status` 可在任何時候比對機器與快照；`restore` 會把 daemon 檔放回去、重啟 Docker 讓還原後的檔案真的被讀到，並把「先前在跑、現在沒在跑」的容器叫起來。

- [x] 容器清單已存
- [ ] 沒有任何長時間執行或帶狀態的工作正在容器內進行中
- [ ] 已約好時間，因為機器上每個容器都會重啟
- [ ] **每個執行中容器的 restart policy 都已記下。** 沒有 policy 的容器不會自己回來；而 `unless-stopped` 在**優雅的** `docker desktop restart` 之後會不會回來——相對於 M6a 演練的「把 daemon 砍掉」——在這個平台上還沒有定論

## 證據記錄

M6b 與 M8 產出的結論無法從程式碼重新推導。記錄在這裡，並把產物存進 `docs/evidence/dns/`，讓下一個接手者不必為了信任它而重跑一次 T4 驗證。

| 里程碑 | 平台 | 日期 | 證據 | 執行者 |
| --- | --- | --- | --- | --- |
| M6b | Windows Docker Desktop | 2026-08-28 | [m6b-windows-docker-desktop.zh-TW.md](evidence/dns/m6b-windows-docker-desktop.zh-TW.md)——裁決 1、Target IP、ICS 的 53 埠衝突與 `0.0.0.0:53:53` 的 bug、`127.0.0.1` 綁定、撤銷逃生口。破壞性循環尚未執行 | cymondez |
| M6b | 原生 Linux（VM） | | | |
| M8 | WSL2 | | | |
| M8 | macOS Intel | | | |
| M8 | macOS Apple Silicon | | | |

## repo 現況

M7 之後更新：

- `docker/dns/` 放著 M2 的 image、entrypoint、發佈腳本、README 與驗證腳本，加上 M6a 的 dind 載具；commit `3581211` 的東西沒有在裡面留下任何檔案。`runestone-cli/src/services/dns/` 已是完整的引擎，而 **M7 正是既有指令路徑開始 import 它的那一刻**：`up`、`stop`、`down`、`certs`、`doctor` 現在都會進到 `lifecycle.ts`。M0 到 M6a 仍然可以各自 revert；從 M7 開始，revert 會連生命週期接線一起帶走。
- commit `3581211` 加進 runestone image 的 dnsmasq 與 webproc 相關程式——`docker/traefik/entrypoint.sh` 的 `start_dnsmasq()` 與 `docker/traefik/dynamic/traefik.dynamic.yml` 的 `{{ if env "DNS_ENABLE" }}` 區塊——已在 M3 移除（規格 5.3、13）。
- CI 是 `.drone.yml`，另保留 `.github/workflows/dns-harness.yml` 給 GitHub 鏡像；兩者呼叫同一批腳本。**兩者都還沒有跑過**，那需要一個指向這個 repo 的 Drone runner。image 發佈仍然是進版控的 `docker/dns/publish.sh`，仍然需要一個 registry token（裁決 2）。
- **`make/` 目錄是從 [druidfi/stonehenge](https://github.com/druidfi/stonehenge) 繼承來的，已作廢。** 把那套 Makefile 式的安裝與管理換成 npm CLI 正是這個 fork 存在的理由（見 README），因此建置與發布計畫不得從它推導任何東西。它是殘骸，不是基準——裁決 2 決定的 image 建置路徑應該貼合 CLI 的發布流程。
