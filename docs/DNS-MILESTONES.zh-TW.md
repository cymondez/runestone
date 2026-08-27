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
| M2 | runestone-dns image | 1 | T1 | 裁決 2 | 未開始 |
| M3 | 服務接線與 `dns status` | 0 | T1 | M1、M2、裁決 4 | 未開始 |
| M4 | `dns disable` | 2（導向） | T0 | M1、M3 | 未開始 |
| M5 | `dns enable` 到 `prepared` | 2 | T1 | M4 | 未開始 |
| M6a | dind 載具內端到端 | 宿主 2／載具內 3 | T2 | M5 | 未開始 |
| M6b | 真機與 VM 驗證 | 3 | T3／T4 | M6a、裁決 1 | 未開始 |
| M7 | 生命週期整合與揭露 | 3 | T1／T2 | M6a | 未開始 |
| M8 | 平台矩陣與發布 | 3 | T3／T4 | M6b、M7 | 未開始 |

M2 與 M1 互不相依，可以並行。其餘是一條鏈。

## 裁決關卡

規格 15 的四項各有里程碑截止點（規格 16.6）。前置裁決未定案時，該里程碑不得開始。

| 裁決 | 截止 | 狀態 | 延後定案的代價 |
| --- | --- | --- | --- |
| 3——備援 DNS 放 dnsmasq 上游還是 daemon 陣列 | M1 之前 | **已定案：兩者都做**——dnsmasq 上游為必要且永不為空（規格 8.4），daemon 陣列備援為選用且預設關閉（規格 9.7） | 及時定案。`insertedEntries` 是自有項目的陣列，M1 一開始就照此實作 |
| 2——image 的建置發佈方式、名稱與起始 tag | M2 之前 | 未定 | M2 無法完成。repo 目前既沒有多架構建置路徑也沒有 CI workflow，且 `make/` 不是起點——見「repo 現況」 |
| 4——`compose.yml` 重生策略 | M3 之前 | 未定 | M3 的 compose 工作要重做 |
| 1——`docker desktop restart` 是否存在 | M6b 之前 | 未定 | 低。實作會自行偵測，並退回「提示手動重啟」 |

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

**風險等級 1 · 層級 T1 · 前置：裁決 2**

**交付項目**

- [ ] `docker/dns/Dockerfile` — Alpine、dnsmasq、依 `TARGETARCH` 選取的釘版 webproc（規格 8.1）
- [ ] `docker/dns/entrypoint.sh` — 每次啟動重生 `/etc/dnsmasq.conf` 與 `/etc/dnsmasq.d/managed.conf`，然後 exec webproc 與 dnsmasq（規格 8.3）
- [ ] 依裁決 2 建立 `linux/amd64` 與 `linux/arm64` 的多架構建置發佈路徑
- [ ] 用 fixture `/ssl` 目錄的 image 驗證測試
- [ ] webproc 0.4.0 的 `--config`、`--port`、`--user`/`--pass` 旗標對釘定版本確認過（規格 8.1）

**通過條件**

- [ ] 規格 14.4 在兩種架構上全綠
- [ ] **所有驗證都在非 53 的 port 上進行**，讓這個里程碑全程不與宿主爭 53
- [ ] 防篡改：在容器內改掉兩個 Runestone 擁有的檔案後重啟，兩者都被還原，且 `custom.conf` 未被動到
- [ ] mapping 規則：每個 `*.crt` 一條 `address=`、排除 `rootCA.crt`、排除非法 domain 檔名、目錄為空時仍能啟動

**回退。** 單一 revert。一個沒有被引用的已發佈 tag 無害。

## M3 — 服務接線與 `dns status`

**目標。** 把服務跑起來所需的一切，加上那個後續每個里程碑都用來自我診斷的唯讀指令。功能仍然關閉。

**風險等級 0 · 層級 T1 · 前置：M1、M2、裁決 4**

**交付項目**

- [ ] 依規格 7.1 新增 `.env` 欄位，欄位不存在即視為停用
- [ ] compose 模板加入 profile `dns` 下的 `dns` 服務（規格 8.2），image 與 tag 以字面值寫入
- [ ] 依裁決 4 在 `runestone-cli/src/utils/project-files.ts` 實作版本化的 `compose.yml` 重生（規格 13）
- [ ] `dns/custom.conf` 在服務啟動前就先建立（不存在時才建）（規格 8.3）
- [ ] `configuration/dns/dns-ui.yml` 由 CLI 產生與移除（規格 8.5）
- [ ] 移除 `docker/traefik/dynamic/traefik.dynamic.yml` 的 `{{ if env "DNS_ENABLE" }}` 區塊，以及 `docker/traefik/entrypoint.sh` 的 `start_dnsmasq()`（規格 13）
- [ ] `runestone dns status`，唯讀，輸出規格 10.3 的全部內容
- [ ] `runestone-cli/src/i18n/index.ts` — 目前為止新增文案的 `en` / `zh-TW` / `ja-JP`

**通過條件**

- [ ] `DNS_ENABLE=false` 時 `up` / `stop` / `down` 與現行行為完全一致——用回歸測試證明，不是目測
- [ ] `status` 能正確判讀涵蓋規格 9.5 所有狀態的手工 daemon 檔案，包含我方項目被推移、重複、改值、移除
- [ ] `status` 不寫入任何東西，有測試證明
- [ ] 規格 7.4 的覆寫生效時 `status` 會顯著提示
- [ ] 既有使用者升級到這個版本後行為不變

**回退。** 單一 revert。注意 traefik 模板與 entrypoint 的移除是對 runestone image 的改動；若該 image 獨立發布，要排好順序，避免舊 CLI 遇到期待「路由由 CLI 產生」的新 image。

## M4 — `dns disable`

**目標。** 先造逃生門，再造陷阱。如果 enable 先落地又出錯，就沒有任何工具可以善後。

**風險等級 2（僅導向路徑） · 層級 T0 · 前置：M1、M3**

**交付項目**

- [ ] `runestone dns disable`，實作規格 9.2 與 10.2
- [ ] `--assume-entry <ip>` 與 `--assume-index <n>`（規格 9.3）
- [ ] `--dry-run` 印出前後 diff 且不寫入任何內容（規格 10.2）
- [ ] 所有權衝突路徑一律中止並輸出 daemon 路徑與手動修復步驟，絕不猜測
- [ ] `runestone-cli/tests/commands/` 的命令入口測試

**通過條件**

- [ ] 能透過 `--assume-entry` 撤銷「手動植入、**且無所有權記錄**」的項目
- [ ] 規格 12 中結果為「中止」的每一列都真的中止且未寫入
- [ ] 我方項目已被使用者移除時視為已撤銷：不動檔案、清除狀態、不報錯
- [ ] 全部以 `RUNESTONE_DNS_DAEMON_PATH` 驗證，並能證明平台預設的 daemon 檔案未被碰過
- [ ] `--dry-run` 的輸出與之後實際執行的結果一致

**回退。** 單一 revert。

## M5 — `dns enable` 到 `prepared`

**目標。** 完整的啟用路徑，只差重啟。這是第一個會寫入真實 `daemon.json` 的里程碑，而因為它不重啟，演練期間那次寫入對機器沒有任何效果。

**風險等級 2 · 層級 T1 · 前置：M4**

**開始這個里程碑之前，先完成 16.5 的安全網。**

**交付項目**

- [ ] `runestone dns enable` 的規格 10.1 第 1–4 步：不改動任何狀態的前置檢查、`.env` 與專案檔案、啟動 dns 服務、由一次性容器實際查詢驗證、寫入所有權狀態、原子寫入 daemon
- [ ] `--no-restart` 刻意停在 `phase=prepared`（規格 10.1、11.1）
- [ ] `--dry-run` 只做前置檢查，然後印出 diff 並結束
- [ ] Target IP 變更處理（規格 9.4）與調和路徑（規格 9.5）
- [ ] 每一種失敗都有反向還原；還原本身失敗時保留 `phase=prepared` 並輸出手動修復資訊
- [ ] 修改 daemon 前的確認揭露，帶入實際數值（規格 11.3）

**通過條件**

- [ ] 在真機上：`enable --no-restart` → 檢視 diff → `disable` → daemon 檔案與 M5 前的快照**逐位元組相同**
- [ ] 同樣的循環，但事先手動加入一筆使用者項目：該項目完好未被動到
- [ ] 前置檢查失敗時不留下任何 `.env`、服務、狀態或 daemon 變更
- [ ] 第 3 步驗證失敗時停掉服務並還原 `.env`，且 daemon 檔案從未被開啟寫入
- [ ] `--dry-run` 不寫入任何東西，用前後檔案雜湊比對證明
- [ ] 揭露輸出含實際的 daemon 路徑、Target IP、Bind IP——不是佔位字串

**回退。** 單一 revert，另外在任何跑過 enable 的機器上執行 `dns disable`。

## M6a — dind 載具內端到端

**目標。** 在爆炸半徑只有一個容器的沙箱內，證明含 daemon 重啟的完整循環——好讓沒有虛擬機的接手者也能做，也好讓 CI 能反覆做。

**宿主風險等級 2、載具內 3 · 層級 T2 · 前置：M5**

**交付項目**

- [ ] `docker/dns/test/` — 規格 14.5 的載具，以及「不用虛擬機重現本里程碑」的說明
- [ ] 載具內的完整循環：前置檢查 → 寫入 → 重啟 → resolv.conf → 通配解析 → 停用 → 檔案復原
- [ ] 刻意注入重啟逾時，證明反向還原真的會還原
- [ ] 載具接進 CI

**通過條件**

- [ ] 完整循環在載具內通過
- [ ] 注入的重啟逾時導致 daemon 檔案被還原，而不是留下半套狀態
- [ ] 沙箱 daemon 重啟後 `restart: unless-stopped` 把 dnsmasq 拉回，過程無任何 CLI 介入
- [ ] 能證明整趟執行都沒有動到宿主的 daemon 檔案與容器
- [ ] 在 CI 上也通過，不只是本機

**回退。** 單一 revert。這是最後一個具備這個性質的里程碑。

## M6b — 真機與 VM 驗證

**目標。** 補上載具無法涵蓋的部分：Docker Desktop 的定址與重啟機制、Linux 的提權與 systemd-resolved，以及真實的 53 port 衝突。

**風險等級 3 · 層級 T3／T4 · 僅維護者 · 前置：M6a、裁決 1**

**這是唯一會刻意中斷一台正常工作機器的里程碑。** 要排時間。先存 `docker ps -a`（見下方檢查清單）。其他一切都已由 M6a 證明過。

**交付項目**

- [ ] Docker Desktop：Target IP `192.168.65.254`、`0.0.0.0` 綁定，以及裁決 1 決定的重啟機制
- [ ] 原生 Linux：需 sudo 的 `/etc/docker/daemon.json`、佔著 `127.0.0.53` 的 systemd-resolved、`systemctl restart docker`
- [ ] 實際觸發一次 53 port 衝突，確認規格 6.1 那條規則——port 可用性由「啟動服務」決定，不由讀 netstat 決定
- [ ] 證據存入 `docs/evidence/dns/`

**通過條件**

- [ ] 啟用 → 新容器 `resolv.conf` 首筆為 Target IP → 憑證涵蓋的子網域解析為 Target IP → 停用 → daemon `dns` 陣列回到原狀，含使用者原有項目
- [ ] Linux 上 sudo 失敗時中止且未部分寫入
- [ ] 下方證據記錄已填寫

## M7 — 生命週期整合與揭露

**目標。** 把 DNS 接進使用者本來就會執行的指令。這是既有指令第一次碰到 DNS 程式碼，因此也是 DNS 缺陷第一次可能影響到「從未執行 `dns enable` 的人」。

**風險等級 3 · 層級 T1／T2 · 前置：M6a**

**交付項目**

- [ ] 依規格 10.4 處理 `up`、`stop`、`stop --all`、`down`、`certs create`、`certs remove`、`doctor`
- [ ] setup 的四個題目與其說明（規格 11.2），含上游的沿用／更換／追加動作與備援的選用開關
- [ ] 完整的規格 11.3 揭露矩陣
- [ ] `DNS_AUTO_REORDER` 兩種模式的行為（規格 9.6），且絕不重啟 Docker
- [ ] 完整的 `en` / `zh-TW` / `ja-JP` 翻譯

**通過條件**

- [ ] 規格 14.2 全綠，且規格 11.3 揭露時機表每一列都有測試
- [ ] 揭露帶入實際數值，且 `--yes` 仍會輸出
- [ ] 揭露第 11 項**同時**陳述 9.7 備援的好處與代價，且 setup 題目讀起來像建議而非判決
- [ ] `stop` 保留 dns 服務執行；`stop --all` 停掉它之前先警告
- [ ] disable 失敗時 `down` 中止且不進行任何破壞性清理
- [ ] 只有在 domain 集合確實變化時，`certs` 變更才重建 mapping
- [ ] `doctor` 只回報，絕不自動修正
- [ ] DNS 停用時，上述每個指令的行為逐字不變

## M8 — 平台矩陣與發布

**目標。** 出貨。

**風險等級 3 · 層級 T3／T4 · 前置：M6b、M7**

**交付項目**

- [ ] 完成規格 14.3 平台矩陣，T4 各列的輸出存進 repo
- [ ] 在 CLI 對外呈現 DNS 之前**先**發布兩種架構的 image（規格 13）
- [ ] README 與 DESIGN 補上揭露項目 1–8 的摘要與手動移除步驟（規格 11.3）

**通過條件**

- [ ] 規格 14.3 表格每一列都是已完成，或明確記錄理由後延後
- [ ] 全新安裝與自前一版升級，在 DNS 關閉時都行為正確
- [ ] 文件寫明移除 Runestone 前必須先執行 `runestone dns disable`

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
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' > ~/containers-before-dns-m6b.txt
```

- [ ] 容器清單已存
- [ ] 沒有任何長時間執行或帶狀態的工作正在容器內進行中
- [ ] 已約好時間，因為機器上每個容器都會重啟

## 證據記錄

M6b 與 M8 產出的結論無法從程式碼重新推導。記錄在這裡，並把產物存進 `docs/evidence/dns/`，讓下一個接手者不必為了信任它而重跑一次 T4 驗證。

| 里程碑 | 平台 | 日期 | 證據 | 執行者 |
| --- | --- | --- | --- | --- |
| M6b | Windows Docker Desktop | | | |
| M6b | 原生 Linux（VM） | | | |
| M8 | WSL2 | | | |
| M8 | macOS Intel | | | |
| M8 | macOS Apple Silicon | | | |

## repo 現況

記錄於此，避免把 M1 與 M2 誤認為已經開工：

- `docker/dns/` 仍是**空的、未被 git 追蹤的目錄**，commit `3581211` 的東西沒有在裡面留下任何檔案，M2 從零建立其內容。`runestone-cli/src/services/dns/` 內有 M0 的 `daemon-target.ts` 與 M1 的 `json-edit.ts`、`daemon-config.ts`、`daemon-file.ts`、`upstream.ts`。**`tests/` 之外還沒有任何地方 import 它們**，這正是目前每個里程碑都能各自 revert 的原因。
- commit `3581211` 加進 runestone image 的 dnsmasq 與 webproc 相關程式——`docker/traefik/entrypoint.sh` 的 `start_dnsmasq()` 與 `docker/traefik/dynamic/traefik.dynamic.yml` 的 `{{ if env "DNS_ENABLE" }}` 區塊——仍然存在，必須在 M3 移除（規格 5.3、13）。
- repo 內沒有這個功能可以依賴的多架構建置發佈路徑，也沒有 CI workflow。建立一條是裁決 2，並且卡住 M2。
- **`make/` 目錄是從 [druidfi/stonehenge](https://github.com/druidfi/stonehenge) 繼承來的，已作廢。** 把那套 Makefile 式的安裝與管理換成 npm CLI 正是這個 fork 存在的理由（見 README），因此建置與發布計畫不得從它推導任何東西。它是殘骸，不是基準——裁決 2 決定的 image 建置路徑應該貼合 CLI 的發布流程。
