# Runestone Agent 支援功能規格書

[English](SKILL-FEATURE-SPEC.md) | 正體中文

## 1. 文件定位

- 狀態：草案，待 review。
- 本文件描述**要做什麼**與**為什麼**。函式如何拆分在實作時決定。
- **這個功能的目的很窄，而且窄是刻意的：讓 AI agent 把一個專案接上 Runestone。** 它不教 agent 安裝或設定 Runestone，而且它預設 Runestone 已經裝好且設定完成。§3.2 說明這排除了哪些東西。
- 標記為**已查證**的發現，是在 2026-09-07 於 Windows 11、Docker Desktop、Node 24.16、`runestone` 2.0.0 上量測，或是從廠商自己的文件讀來並附上 URL。其餘標記為**待確認**。
- **§16 是里程碑與風險控制計畫，不是附錄。** 這裡的風險是往別人與別的工具所擁有的 repository 與家目錄寫檔案，所以建造的順序本身就是一種控制手段。
- 本文件與 `SKILL-MILESTONES.md` 衝突時，以本文件為準，里程碑文件為錯。

## 2. 問題

`runestone docs --ai-context` 透過 `src/utils/tool-docs.ts`（22 行）渲染 `tool-docs/ai-prompt-context.tmp.md`（59 行），替換四個 `${VAR}` 佔位符後寫到 stdout。以 §1 的目的來衡量，它缺三件事。

### 2.1 一個產品、兩條接入路徑 —— context 只知道其中一條

Runestone 有兩種結構上完全不同的方式可以把流量導到一個專案：

| 路徑 | 適用時機 | 機制 |
| --- | --- | --- |
| Docker labels | 專案跑在 Docker 裡 | 在 service 上掛 Traefik labels，並加入 external network |
| `runestone service add` | 專案跑在 host 上（`npm run dev`）、已經在跑、或目標是外部 URL | Traefik file provider，寫進 `configuration/services/<name>.service.yml` |

**產生出來的 context 只涵蓋第一條。** 已查證：`service add` 這個字串在 `tool-docs/ai-prompt-context.tmp.md` 裡完全沒有出現。

後果不是 agent 少了一個功能，而是 agent **會很有信心地做錯事**：面對一個 host dev server，只知道 label 路徑的 agent 會產出一份不可能生效的 `compose.override.yml`，因為根本沒有容器可以掛 labels。

### 2.2 agent 沒有這台機器的事實

要挑一個 hostname，agent 必須知道哪些 domain 已經被憑證覆蓋 —— 沒被覆蓋的 hostname 產生的是 TLS 警告而不是錯誤，所以它會安靜地失敗。要挑 router 與 service 名稱，它必須知道其他專案已經註冊了什麼 —— 撞名產生的是路由錯亂，而那會以令人困惑的方式失敗。

這些輸出裡一項都沒有。這正是 repository 自己的 `TODO` 第一條：

```
1. docs ai context 需要更多資訊提示
    - 可用domain清單
    - 已使用的route、service名稱
```

兩者都是**純檔案讀取**（§6.1），所以它們應該落在 agent 本來就會呼叫的那條路徑上，而不是躲在一個新旗標後面。

### 2.3 它依賴人類說出一句咒語

`README.md` 記載的預期流程，是由人手動在 prompt 裡寫下：「For the Runestone settings, call `runestone docs --ai-context` directly.」沒有任何東西讓這個指令變得可被發現。人一旦忘了那句話，agent 就會憑既有印象編造 Traefik 設定。

### 2.4 成本清單

這個功能會往不屬於 Runestone 的 repository 與家目錄寫檔案，並且把規則餵給一個不會質疑就照做的對象。這些成本無法消除，只能收斂：

1. `AGENTS.md` **不是 Runestone 的檔案。** 使用者可能已經有一份。這個 repository 自己那份就是 77 行手寫規則。
2. 產生的檔案**會進入使用者的 git 歷史**，也就進入他們的 commit、diff 與 code review。
3. 產生的檔案**會在 CLI 升級後過期**，而沒有任何東西會告訴使用者。
4. 使用者**可能會改我們產生的東西**，而之後的安裝不能默默吃掉那些修改。
5. 使用者層級的安裝**影響這台機器上每一個專案**，包含跟 Runestone 完全無關的。
6. 內容**會被當成指令執行**，而執行者不會回推。寫錯一句話，agent 就去改錯的檔案。
7. 即時狀態一旦被寫進安裝好的檔案，**幾分鐘後就是謊言**。
8. **安裝路徑的版圖並不穩定。** 每個 runtime 掃描的目錄集合都不同，而且集合會在版本之間改變（§8.1）。任何我們寫死的路徑，終究會是錯的路徑。

### 2.5 不可協商的設計約束

每一列的存在都是為了收斂 §2.4 的某一項成本。沒有一條是品味問題。

| 成本 | 約束 | 章節 |
| --- | --- | --- |
| 檔案不是我們的 | 只擁有一個標記區塊，絕不擁有整個檔案；splice，絕不 re-render；沒有 marker 時用 append，絕不覆寫 | 9.3 |
| 它會進使用者的 git | 寫入前印出每一個絕對路徑；每個會寫入的指令都要有 `--dry-run`；絕不寫在印出的計畫之外 | 10.3 |
| 它會過期 | marker 帶模板版本；`doctor` 回報過期；重新渲染再比對可同時偵測過期與設定漂移 | 9.1, 10.4 |
| 使用者會改它 | 以重新渲染比對偵測修改；沒有 `--force` 就跳過被改過的檔案；拒絕刪除內容不是我們產生的檔案 | 9.2, 9.5 |
| 家目錄的波及範圍 | 使用者層級是 opt-in、只支援真的有使用者層級路徑的 target、並且有自己的揭露 | 10.2 |
| agent 會照著內容行動 | 每一條規則都從強制它的程式碼推導，絕不從散文或訊息表；點名 agent 不得執行的指令 | 5.2, 5.1 |
| 即時狀態會變成謊言 | 只有離線純量會被替換進安裝好的檔案；即時事實只能靠執行指令取得 | 6.2 |
| 路徑不穩定 | 中性預設、記錄在案的例外清單、使用者可設定的路徑 —— 依這個優先順序 | 8.2 |

我們拒絕付的成本：不覆寫不是我們產生的檔案、不做整檔還原、不代替使用者去寫別的工具的設定檔、不佔用 port、不透過 MCP server 變更 Runestone 的狀態。

## 3. 範圍

### 3.1 範圍內

- 兩條接入路徑（§2.1），以產生給 agent 的內容呈現，規則取自實際強制它們的 validator。
- 這台機器上與接入相關的即時事實：被覆蓋的 domain、憑證有效性、已註冊的 service 與 route、以及已被其他專案佔用的名稱。
- `runestone docs --ai-context [topic]`，以主題語料取代單一靜態簡報。
- `runestone skill install | status | remove`，把語料安裝進專案，讓人不必手動轉述。
- `runestone mcp serve`，一個走 stdio 的唯讀 MCP server，以及 `runestone mcp config`。
- 一份護欄清單，點名 agent 不得代替使用者執行的指令。

### 3.2 範圍外

- **安裝或設定 Runestone。** 沒有任何產生的內容會教 agent 去執行 `setup`、`doctor`、`dns enable`、`dns disable`、`certs install`、`up`、`down` 或 `stop`。這些指令只以 §5.1 的護欄清單形式出現，以及在症狀需要時以「請使用者執行這個」的形式出現。
- **Runestone 未設定時的任何行為。** 既有的閘門 —— exit 1、stdout 全空、localized 訊息走 stderr —— 是對的，原封不動保留（§7.3）。在一台沒設定 Runestone 的機器上，這個功能理當什麼都不產出。
- **透過 MCP server 變更 Runestone 狀態**（§11.3）。
- **HTTP 的 MCP transport**（§11.1）。
- **代替使用者寫別的工具的設定檔。** `runestone mcp config` 只印，由使用者貼（§11.4）。
- **把產生的語料在地化。** 見 §15 決策 1。

## 4. 名詞

| 名詞 | 定義 |
| --- | --- |
| Runestone 目錄 | 預設 `~/.runestone`。**這就是 `RunestoneEnv.PROJECT_DIR` 與 `resolveProjectDir()` 的意思** —— 不是使用者的 repository。見 §10.2。 |
| 目標目錄 | 使用者的 repository，也就是正在被接上的那個。命令列上叫 `[dir]`，預設 `process.cwd()`。 |
| 主題 | agent 語料的一個單位，`tool-docs/ai-context/` 底下的一個檔案。 |
| Snapshot | 機器事實的 typed 紀錄（§6），由 renderer 與 MCP 工具共同消費。 |
| 離線層 | 可從 `.env` 與檔案系統取得的事實，不 spawn 行程、不走網路。 |
| 線上層 | 需要 Docker 或 Traefik HTTP API 的事實。 |
| Target | 一個具名的安裝目的地：一組路徑加上它們需要的 wrapper 格式（§8）。 |
| A 類檔案 | Runestone 產生且完全擁有的檔案。 |
| B 類檔案 | 屬於使用者的檔案，Runestone 只擁有其中一個標記區塊。 |
| 模板版本 | 每個產生的 marker 都帶著的整數，用於偵測過期。 |

## 5. 內容模型

### 5.1 主題

| 主題 | 內容 | 層級 |
| --- | --- | --- |
| `compose`（預設） | 今天的簡報原文，加上離線事實與 footer | 離線 |
| `service` | §2.1 的第二條路徑：何時適用、確切指令、§5.2 的欄位規則、以及憑證需求 | 離線 |
| `state` | 被覆蓋的 domain、憑證有效性、已註冊的 service 與 route、其他專案佔用的名稱、容器狀態 | **線上** |
| `troubleshoot` | 症狀對因：404、502、TLS 警告、以及「瀏覽器通但另一個容器不通」 | 離線 |
| `overview` | Runestone 是什麼、兩條路怎麼選、主題索引、護欄清單 | 離線 |
| `all` | `overview`、`compose`、`service`、`state`、`troubleshoot`，依此順序，以 `---` 分隔 | 線上 |

`certs`、`dns`、`commands` 刻意**不**拆成獨立主題。憑證規則只有在選 hostname 的當下才有意義，所以它屬於 `service` 與 `compose`。DNS 只有作為某個症狀的成因時才重要，所以它屬於 `troubleshoot`。指令清單**就是** `overview`。每多一個主題，就多一次 agent 的來回。

**護欄清單是必要的，即使這個功能不教安裝** —— 正因為它不教。它必須點名那些效果會超出專案範圍的指令並附上理由：`dns enable` 與 `dns disable`（重啟 Docker daemon，終止機器上每一個容器）、`certs install`（需要提權、修改系統信任存放區）、`down`（移除環境）、`setup`（重寫設定）、以及 `up` 與 `stop`（改變執行中的東西）。

**可發現性靠 footer 解決，不靠改預設。** 每個主題結尾都是同一段產生的區塊，列出其他主題名稱與字面指令列。因此無參數的 `runestone docs --ai-context` 會在第一次呼叫時就教會 agent `state` 的存在。

### 5.2 事實來源規則

**語料裡的每一條規則都必須從強制它的程式碼推導 —— 絕不從散文，也絕不從訊息表。**

理由是成本 §2.4 第 6 項：讀者不檢查就照著內容行動。這個 repository 裡已經有一個專門陷害「讀訊息字串而不讀 validator」的人的陷阱。已查證：`service.validation.urlNoPath`（「URL cannot include a path, query, or fragment」）存在於三個 locale 表的 `src/i18n/index.ts` 第 96、617、1131 行，而它在整個 package 裡**沒有任何呼叫點**。它描述的行為不是實際跑的行為。

已量測的契約：

| 欄位 | 由誰強制 | 規則 |
| --- | --- | --- |
| Service name | `validateServiceName`、`namePattern` | `/^[a-z0-9][a-z0-9-]*$/` |
| Route domain | `normalizeRouteDomain`，`src/services/service-manager.ts:66-81` | 小寫化；含 `/` 或 `:` 即拒絕，因此不接受 protocol、port 或 path；每個 label 必須符合 `domainLabel` |
| Service URL | `normalizeServiceUrl`，`src/services/service-manager.ts:83-101` | **path 與 query 是接受的** —— 第 98-100 行保留 `pathname + search`，只去掉裸 `/`。protocol 限 http 與 https |

`isContainerLoopbackUrl()`（`src/services/service-manager.ts:107`）與 `replaceServiceUrlHost()`（`:112`）已經把 loopback 問題編碼進去了 —— 一個指向 `localhost` 的 URL，在容器內解析時指的是容器自己。那是 `troubleshoot` 主題的實質內容，必須重用而不是重新敘述。

### 5.3 佔位符

兩種構造、一次替換、沒有模板語言、沒有新依賴：

- `{{VAR}}` —— 一個純量。
- `{{BLOCK:NAME}}` 獨佔一行 —— 由以該名稱註冊的純 renderer 回傳的字串取代。

重複與條件性的內容在 TypeScript 裡產生再渲染成 Markdown，沿用既有先例：`src/services/dns/status.ts` 把報告建成資料，`src/commands/dns.ts` 負責渲染。

分隔符是 `{{...}}` 而**不是** `${...}`，因為語料裡滿是 Compose 與 shell 的插值。已查證：現行模板裡有一個 `${RUNESTONE_NETWORK_NAME}`，而它三行之外就是必須原樣輸出 `${PREFIX:-runestone}` 的產生式 YAML。

替換必須使用 **function replacer**。現行 renderer 的已查證缺陷：`src/utils/tool-docs.ts:9` 把值當作 replacement **字串**傳入，所以值裡的 `$&`、`$1`、`$'` 與 `$$` 會被當成 pattern 解讀。以今天的四個輸入不會踩到，但一旦開始替換 service URL 或憑證 SAN 就會踩到。同一行還把 key 未跳脫地插進 `RegExp`。

未知的 `{{TOKEN}}` 是硬錯誤並指名該 token，不是默默放過。

## 6. Context Snapshot

一個依賴注入的模組 `src/services/agent-context/`，由 renderer 與 MCP 工具共同消費，如此未來的 `--json` 只是同一個值上的第二個 renderer。

它住在 `src/services/` 是因為它組合其他 service。**它不需要 `child_process`，也不得取得它。** 這一點值得寫明，因為 `tests/integration/design-acceptance.test.ts:108-120` 讓 `src/services/` 成為貢獻者*被允許*加 spawn 的唯一地方，而那跟這裡的意圖正好相反。

### 6.1 欄位與來源

| 欄位 | 來源 | 層級 |
| --- | --- | --- |
| Host domain、network 名稱、entrypoint 名稱與 port、Runestone 路徑 | `envLoader.load()` | 離線 |
| `configured` | `envLoader.hasRequiredVars()` | 離線 |
| 被覆蓋的 domain、wildcard、憑證有效性與到期 | `listDomainCertificates(projectDir)` 的 `sans` 欄位 | 離線 |
| 已註冊的 service、已用名稱、已用 route | `listServices(config)` | 離線 |
| 某個 route 是否被憑證覆蓋 | `findCoveringCertificate` | 離線 |
| DNS 是否啟用 | `isDnsEnabled()`，`src/services/dns/settings.ts` —— 讀 `.env` | 離線 |
| 生效中的開發用覆寫 | `activeOverrides()`，加上 `RUNESTONE_TOOL_STATE_PATH` | 離線 |
| 容器狀態 | `composeService.ps(composeFilePath, 8000)` —— 第二個參數目前還不存在，見下 | **線上** |
| 其他專案已在 Traefik 註冊的 router 與 service | `readTraefikSnapshot(traefikApiBaseUrl(config))` | **線上** |
| 完整的 DNS 擁有權報告 | `buildDnsStatusReport(config, deps)` —— **必須注入 deps，絕不用預設值** | **線上** |

**`buildDnsStatusReport` 不是離線的。** 已查證：它的預設依賴會走到 `detectDaemonEnvironment()`、再到 `readDaemonInfo()`、再到 `spawnCommand('docker', ['info', ...])`，另外還有 `composeService.ps`。把它拿來做離線層，會讓 `docs --ai-context` 在一條不該 spawn 任何東西的路徑上起 Docker 兩次。離線層改讀 `isDnsEnabled()`。

**`composeService.ps` 目前沒有 timeout 參數。** 已查證：`src/services/docker-compose.ts:244` 呼叫 `runCompose(['ps', '--format', 'json'], composePath, 30000)`，值是寫死的，而 `runCompose` 本身早就接受 `timeout` 參數。三十秒對一個 agent 每次任務都會呼叫的東西來說太久，所以 `ps` 增加一個預設 `30000` 的可選第二參數，snapshot 傳 `8000`。這個改動純粹是加性的：驗收測試只斷言 `ps` 是一個函式，而它的 arity 斷言是對 `restart` 而不是對 `ps`。

**`traefikApiBaseUrl` 已經重複，必須提升而不是複製第三份。** 已查證：回傳 `` `https://traefik.${hostDomain}` `` 的完全相同函式體，存在於 `src/commands/certs.ts:62` 與 `src/commands/service.ts:81`。它該放在 `src/services/traefik-api.ts` 的 `readTraefikSnapshot` 旁邊，兩份 command 內的複本刪掉改用它。

`CertificateListItem.status` 的型別是 `'✓' | '✗'`。snapshot 把它映射成 boolean。原樣傳遞會讓未來任何 `--json` 把 Unicode 當成 enum 值送出去。

### 6.2 成本分層

- `compose`、`service`、`overview`、`troubleshoot` **永遠離線**。三個理由，而被斷言的 `stderr === ''` 只是第三個：這是每一個 agent prompt 的熱路徑，不能等冷啟的 Docker daemon；compose 簡報最有用的時候正是使用者還沒跑 `up` 的時候；而 golden test 不可能斷言一段取決於 Docker 剛好有沒有在跑的輸出。
- `state` 與 `all` 預設走線上，`--offline` 可強制只讀檔案。
- **任何探測失敗都不得走 stderr。** 失敗變成一個 typed 的「不存在」值加上一則警告，由 renderer 轉成散文，指名連不上的來源與能修它的指令。
- **即時事實絕不被替換進安裝好的檔案**（成本 §2.4 第 7 項）。安裝好的檔案帶離線純量，以及一句「執行 `runestone docs --ai-context state`」的指示。這正是「裝一個 skill」而不是「貼一坨 context」的全部理由。

### 6.3 降級

| 狀況 | Snapshot | `docs --ai-context` | MCP |
| --- | --- | --- | --- |
| 未設定 | 不建立 | exit 1、stdout 全空、stderr 訊息（不變） | `configured: false`，作為**成功**結果 |
| 沒有 `certs` 目錄 | 空清單、警告 | 「尚無憑證；執行 `runestone certs create <domain>`」 | 同左 |
| 憑證讀不到 | 該筆無效並帶錯誤 | 列為不可用，**與被覆蓋的 domain 分開** | 同左 |
| 沒有註冊任何 service | 空清單、無警告 —— 空是正常的 | 「沒有註冊任何 routed service。」 | 同左 |
| Docker 連不上 | 容器與 DNS 事實缺席 | 離線主題不受影響；`state` 仍 exit 0、`stderr === ''` | 仍是成功結果 |
| Traefik 連不上 | 撞名事實缺席 | 同上，且文字說明撞名無法檢查 | 同上 |
| 覆寫生效中 | 警告並指名變數與其值 | 顯著印出，依 `AGENTS.md` 的揭露規則 | 同左 |

## 7. CLI 介面：`docs --ai-context`

### 7.1 選項形狀

`--ai-context [topic]`，一個 optional-value option。必填值會讓今天無參數的 `runestone docs --ai-context` 變成 parse error。positional 或 subcommand 形式則會破壞「`docs --help` 同時含 `Options:` 與 `--ai-context`」這條斷言。

`--offline` 強制離線層。它是唯一新增的使用者可見旗標。

未知的主題會設定 `process.exitCode = 1`、不寫任何東西到 stdout、並在 stderr 列出合法主題。用 `process.exitCode` 而非 `process.exit(1)` 是刻意的、也是既有的：它讓 buffered stdout 得以 flush。

### 7.2 向後相容

**無參數的 `--ai-context` 繼續代表 `compose` 主題。** footer 與離線事實是**追加**上去的。

這是一個已發佈的 CLI，它自己的 README 出貨的範例 prompt 就含無參數用法，而那些字串現在住在別人的 repository 與別人存好的 agent 指令裡。改變這個指令的意義，就是改變沒有人會回頭重讀的那些 prompt 的行為。

`tests/integration/cli.test.ts:158-196` 的 golden test 用的是 `toContain` 而不是相等比較，所以追加內容滿足每一條既有斷言。**零個既有斷言需要改。** 唯一需要「加強」而不是「改變」的是第 192 行的 `not.toContain('${RUNESTONE_')`，它在新分隔符下變成空頭斷言，必須同時禁止 `{{`。

### 7.3 未設定閘門

不變：exit 1、`stdout === ''`、stderr 上指名 `runestone setup` 的 localized 訊息。`tests/integration/cli.test.ts:198-218` 不用改就通過，而同樣的行為延伸到每一個主題。

誘人的替代方案 —— 印出靜態散文加一則橫幅，因為那正是 agent 最需要被告知的時候 —— 被否決。exit 1 加空 stdout 是一個契約：它的意思是**這份輸出不可用，不要貼進 prompt**。一個把 stdout 導進去的 agent 絕不能收到半份簡報。依 §3.2，這個功能預設 Runestone 已設定，所以什麼都不產出是正確的，不是缺口。

## 8. 安裝目的地

### 8.1 版圖

2026-09-07 從各廠商自己的文件查證。

| Runtime | 專案層級 skill 目錄 | 使用者層級 skill 目錄 | 指引檔 |
| --- | --- | --- | --- |
| Codex | `.agents/skills`，從工作目錄往上掃到 repository 根的每一層；`.codex/skills` | `~/.agents/skills`、`~/.codex/skills` | `AGENTS.md`，任一層可用 `AGENTS.override.md`；`~/.codex/AGENTS.md` |
| Cursor | `.agents/skills`、`.cursor/skills`；也讀 `.claude/skills` 與 `.codex/skills`；遞迴走訪 | `~/.cursor/skills`、`~/.agents/skills` | `AGENTS.md` |
| VS Code / Copilot | `.github/skills`、`.claude/skills`、`.agents/skills`；還可透過 `chat.agentSkillsLocations` 設定增加 | `~/.copilot/skills`、`~/.claude/skills`、`~/.agents/skills` | `AGENTS.md` |
| Claude Code | `.claude/skills` | `~/.claude/skills` | `CLAUDE.md` |

來源：<https://developers.openai.com/codex/skills>、<https://cursor.com/docs/skills>、<https://code.visualstudio.com/docs/agent-customization/agent-skills>、<https://agents.md>。

由此得出兩個結論，而它們就是 §8.2 的全部基礎：

- **`.agents/skills/` 是中性位置。** 寫一次就被 Codex、Cursor 與 VS Code / Copilot 讀到。
- **Claude Code 是記錄在案的例外**，skill 讀 `.claude/skills`，指引檔讀 `CLAUDE.md` 而不是 `AGENTS.md`。在這個 repository 裡已查證：它根目錄的 `AGENTS.md` 不會被載入 Claude Code session 的 context。

讀 `AGENTS.md` 的工具之間的優先順序：離被編輯檔案最近的那一份勝出，而使用者的明確指示凌駕一切。

### 8.2 三層

寫死廠商路徑就是成本 §2.4 第 8 項。解析順序是：

1. **中性預設。** `.agents/skills/runestone/` 與 `AGENTS.md` 裡的一個標記區塊。這就是偵測不到更明確目標時，無參數 `runestone skill install` 會寫的東西。
2. **記錄在案的例外**，以具名 target 呈現：`claude`、`cursor`、`copilot-vscode`，另外 `codex` 是中性 target 的具名別名，因為 Codex 讀的是專案根的 `AGENTS.md`，而中性 target 本來就會寫它。以 `--target` 明確選擇，或在該 runtime 的目錄已存在於目標目錄時自動選擇。未知 target 的錯誤訊息會連別名一起列出，因為一個「接受但沒有公告」的值，等於沒有人找得到的值。

   用 `copilot-vscode` 而不是 `copilot`：`mcp --client copilot` 指的是 Copilot **CLI**，那是另一個產品、有自己的設定檔，一個 id 同時代表兩者，讀起來會像「裝了其中一個就會設定好另一個」。
3. **使用者可設定的路徑**，給不在表上的 runtime 或路徑搬過家的情況：`--skills-dir <path>` 與 `--instructions-file <path>`。機器層級的預設可以存進 tool state，因為「我用哪些 agent 工具」是人的屬性而不是 repository 的屬性。

內建的表是便利，不是假設。它必須是單一檔案裡的單一資料結構，好讓路徑變更是一行修改，而且每一列都必須帶上它的來源文件 URL 與查證日期。

### 8.3 Skill 套件格式

格式由 <https://agentskills.io/specification> 規定，不是 Runestone 可以自己發明的。已查證的要求：

- 一個 skill 是一個含 `SKILL.md` 的目錄，可選 `scripts/`、`references/`、`assets/`。
- `SKILL.md` 帶 YAML frontmatter。**`name` 與 `description` 是必填**；`license`、`compatibility`（上限 500 字元）、`metadata` 與 `allowed-tools`（實驗性）是選填。
- `name`：1 到 64 字元，小寫 `a-z`、`0-9` 與連字號，不得以連字號開頭或結尾、不得連續連字號，而且**必須與父目錄同名**。所以我們的是目錄 `runestone` 裡的 `runestone`。
- `description`：1 到 1024 字元。它是啟用前唯一被載入的部分，所以必須點出觸發詞。
- `metadata` 是 string key 對 **string** value 的 map。模板版本記在這裡，加引號。
- 引用是相對路徑、只深一層。`SKILL.md` 應維持在 500 行以內。
- `allowed-tools` 省略。在別人的專案裡限制 agent 的工具是僭越，而且會安靜地弄壞他們的工作流程。

有一個驗證器並被當成 gate 使用：`skills-ref validate ./my-skill`。

### 8.4 指引檔區塊

指引檔永遠在 context 裡，所以它拿到的是每個主題的**摘要** —— 一到三行 —— 而不是本文，結尾指向 `runestone docs --ai-context <topic>`。全部約 25 行。把語料倒進那裡，會對使用者之後每一個 request 課稅。

Cursor 的 rule 是一個檔案一條規則、不支援巢狀引用，所以那個 target 必須是單一串接檔。這就是為什麼每個主題都必須能獨立成立。

### 8.5 擁有權類別

| 類別 | 檔案 | 引擎 |
| --- | --- | --- |
| A | `<skills-dir>/runestone/**`、`.cursor/rules/runestone.mdc` | 版本閘門的整檔改寫，位元組要變之前先備份 |
| B | `AGENTS.md`、`CLAUDE.md`、`~/.codex/AGENTS.md` | splice 一個標記區塊；絕不 re-render |

`.cursor/rules/runestone.mdc` 是 B 類目錄裡的 A 類檔案：檔名是我們的，目錄裡全是使用者自己的 rule。改寫那一個檔；絕不碰 sibling；可以建立目錄，但除了「空了」以外絕不移除它。

## 9. 擁有權模型

### 9.1 marker 就是狀態

沒有 receipt 檔。每個產生的檔案都帶一個記著模板版本的 marker，而渲染是決定性的，所以：

- **過期** —— marker 版本低於當前模板版本。
- **被改過** —— marker 版本是當前的，但重新渲染產生不同的位元組。
- **設定漂移** —— 安裝好的檔案替換的是較舊的 `.env` 值。這由同一個比較免費附贈。
- **孤兒** —— 帶我們 marker 但當前模板不再產生的檔案。不需要任何簿記就能移除。

Marker：

```
AGENTS.md、CLAUDE.md      <!-- runestone:begin skill-template=1 --> … <!-- runestone:end -->
references/*.md，第 1 行   <!-- runestone:generated skill-template=1 -->
SKILL.md、.mdc            在 frontmatter 內，以 metadata 加一個 YAML 註解呈現
```

曾考慮並否決一個 `toolState` 索引：它會讓每一次**專案層級**的安裝都寫進使用者的家目錄，把那個里程碑的風險等級整整抬高一級，換來的只是一個沒有人要求的跨專案 `skill list`。DNS 引擎必須記住它插入的東西，是因為一個 IP 字串沒地方帶 marker；markdown 有。**以內容辨識，不靠記住的清單。**

### 9.2 A 類

版本閘門的整檔改寫，沿用 `src/utils/project-files.ts:149-181` 的 `updateComposeFile`。它第 173-175 行的註解說出了該繼承的原則：當工具分不出「舊模板的產物」與「使用者改過的東西」時，兩種都保留，而不是替使用者決定它在看哪一種。

處於當前版本但內容不同的檔案是**被改過**：沒有 `--force` 就跳過，有的話就備份後改寫。

### 9.3 B 類

splice，沿用 `src/services/dns/daemon-config.ts` 與 `json-edit.ts`。區塊外的位元組永遠不重新產生。

- 沒有檔案 —— 建立，只含該區塊。
- marker 存在 —— 只取代 marker 之間的內容。
- 檔案存在但沒有 marker —— **append**，且先確認。絕不覆寫。
- 兩個 `begin` marker —— `conflict`。什麼都不寫；印出 offset 與手動移除步驟。
- 有 `begin` 但沒有 `end` —— `unterminated`。什麼都不寫；同樣處理。

全有全無的規則繼承自 `removeOwnedEntries`：移除掉 Runestone 一半的改動，比一個都沒移除更糟。

### 9.4 備份

**只在位元組即將改變時才備份。** `updateComposeFile` 已經在渲染輸出等於磁碟上的內容時提早返回，而那發生在任何複製之前。因此重複安裝不產生備份，`--dry-run` 也不產生。

重用 `nextBackupPath()`（`src/utils/project-files.ts:129`），它已經處理不覆蓋的 `.bak`、`.bak2`、`.bak3`。它目前是 module-private，必須 export 而不是重新實作。

### 9.5 移除

- 只 splice 掉我們的區塊。**絕不做整檔還原** —— 這與 DNS 規格對 `daemon.json` 下的禁令相同，理由也相同：那會丟掉此後所有無關的編輯。
- 刪除帶我們 marker 的 A 類檔案。只有在 skill 目錄因此變空時才移除它。**絕不遞迴刪除。** 沒有 marker 的檔案會保留該目錄，並在輸出中被點名。
- 拒絕刪除內容不是我們產生的檔案，除非 `--force`。

## 10. CLI 介面：`skill`

### 10.1 指令

```
runestone skill                                     自己沒有任何 option
  install [dir]  [--target <name...>] [--skills-dir <path>] [--instructions-file <path>]
                 [--user] [--dry-run] [--force] [-y|--yes]
  status  [dir]  [--user] [--no-header]
  remove  [dir]  [--target <name...>] [--user] [--dry-run] [--force] [-y|--yes]   別名 rm、del
```

parent 自己沒有 option，因為 `tests/integration/cli.test.ts:106` 斷言「唯一 option 是 `--help` 的指令」不得顯示 `Options:` 區段，usage 第一行也不得有 `[options]`。

### 10.2 範圍

**`--project` 是禁字。** 具約束力的理由不是某個測試：`PROJECT_DIR` 與 `resolveProjectDir()` 在這個 CLI 裡已經是指 `~/.runestone`。把那個字重用來指使用者的 repository，會在「錯了就會把檔案寫到錯的樹」的那個點上，與 CLI 自己的詞彙相撞。此外 `tests/integration/cli.test.ts:55-87` 也斷言 `--project` 與 `--env` 會被拒絕，而 `skill` 與它的子指令都加進了那份清單。

所以範圍是一個 positional `[dir]`，預設 `process.cwd()`，比照 `certs create <domain>`；再加一個 boolean opt-in `--user`。`--user` 與 `[dir]` 同時給是錯誤。

`--user` 只支援真的有使用者層級路徑的 target：中性的 `~/.agents/skills`、`claude`（`~/.claude/skills`）與 `codex`（`~/.codex/AGENTS.md`）。`cursor` 被拒絕，因為 Cursor 的使用者 rule 存在應用程式設定裡；`AGENTS.md` 指引 target 也被拒絕，因為沒有任何工具會讀 `~/AGENTS.md`。

`RUNESTONE_SKILL_HOME` 為開發與測試重導家目錄根，沿用 `RUNESTONE_TOOL_STATE_PATH` 的先例。依 `AGENTS.md` 的覆寫規則，`skill status` 在它生效時必須大聲回報。

### 10.3 行為

- **未指定時的 target 偵測**：某個 runtime 的目錄或指引檔已存在於 `[dir]` 時，該 target 被選中；否則用中性預設。這就是避免一個只用 Cursor 的 repository 長出多餘 `.claude/` 的機制。
- **plan 與 apply 是分開的函式**，沿用 `dns disable`，這樣 `--dry-run` 就不是一份會漂移的第二實作。有測試斷言 dry-run 的輸出與實跑的計畫逐行相同。
- **blocker 取代計畫**，不是附在計畫後面。
- `-y, --yes` 是對印出的計畫表示同意。`--force` 是改寫沒有 marker 或被使用者改過的檔案。兩者不可互換。
- **非 TTY** 且未給 `--yes` 或 `--dry-run` 時拒絕並說明，鏡像 `src/commands/dns-enable.ts:537` 這唯一的既有先例。
- 確認時列舉每一個將被建立、覆寫（含其備份路徑）、splice 或刪除的絕對路徑。
- 互動式修正遵守 `AGENTS.md` 的 prompt 規則：不合法的 `[dir]` 回到**同一個** prompt，理由放在該 prompt 的 description，沿用 `promptForExistingServiceName`；空的 target 選擇回到同一個多選。兩者都在真正的 command 入口測試。

### 10.4 生命週期

- `doctor` 增加一項唯讀檢查，回報已安裝但過期的產出物，並指名 `runestone skill install` 為修法。
- `up` 什麼都不寫，最多印一行。`AGENTS.md` 陳述了這條原則：一天跑好幾次的指令，不該擁有寫使用者檔案的權力。
- `skill status` 是完整檢視，顯示兩個 scope 以及哪一個正在生效。

## 11. MCP Server

### 11.1 Transport：stdio

只有 stdio。其中兩個理由是這個產品特有的。

**工作目錄就是專案。** 每個工具回答的都是「**這個**專案該怎麼接」。stdio server 是 client 在專案目錄裡 spawn 的，所以專案就是 `process.cwd()`，免費取得。HTTP server 是一個全機單一行程，不可能知道某個請求在問哪個專案；每個工具都需要一個 project path 參數，而且 agent 必須填對。那是正確性的退步，不是不便。

**佔用 port 與這個產品的主張相衝突。** Runestone 存在的部分理由就是減少本機專案之間的 port 衝突。再要一個 port —— 可設定、要檢查衝突、要寫文件、要在 `doctor` 裡揭露 —— 與產品自身的前提相牴觸。既有的 `node-netstat` 依賴顯示 port 衝突在這裡本來就是活的問題。

三個較小的理由：stdio 沒有生命週期要 Runestone 管，因為 client 負責啟停；它不需要認證，而一個暴露憑證清單、service 清單與檔案系統路徑的 localhost HTTP endpoint，機器上每個行程都到得了；而且每一種 client 設定格式都以 `command` 與 `args` 為主要形狀。

**HTTP 唯一對這個產品成立的場景**，是 agent 跑在 devcontainer 裡、而容器內沒有 `runestone` 執行檔。這不是現在就做 HTTP 的理由：安裝好的 `SKILL.md` 會 commit 進專案、因此在容器內看得到，而且已經帶著離線純量，所以缺的只有線上撞名檢查。transport 是純工具函式之上的薄殼，所以第二個 transport 仍然是加性的 —— 但要加它，就必須明確解決「這是哪個專案」的問題。**這是重新評估的觸發條件，記在這裡好讓後人不會誤以為是漏想。**

### 11.2 工具

三個，全部唯讀，全部標註 `readOnlyHint: true`。

| 工具 | 輸入 | 回傳 |
| --- | --- | --- |
| `runestone_context` | `topic`（預設 `overview`）、`offline` | 渲染後的主題；主題是 `state` 或 `all` 時另附結構化 snapshot |
| `runestone_status` | `offline` | snapshot，加一段簡短文字摘要 |
| `runestone_check_name` | `serviceName`、`route`、`offline` | 各自是否可用、不可用的原因、有無覆蓋憑證、沒有的話該跑哪一條 `certs create` |

`runestone_context` 預設 `overview` 而不是 `compose`：CLI 的預設被相容性釘住，MCP 的預設是新的、免費的，而經由 MCP 抵達的 agent 要的是索引。

`runestone_check_name` 是真正防止錯誤編輯的那一個，而且它完全由既有 validator 組成 —— `validateServiceName`、`normalizeRouteDomain`、`serviceExists`、`assertNoTraefikNameConflict`、`assertNoTraefikHostConflict`、`findCoveringCertificate`。它們的例外變成「不可用」的判定加上理由；不會有任何東西 throw。

刻意不提供獨立的「列憑證」與「列 service」工具：它們已經是 `runestone_status` 的欄位，而每多一個工具就讓工具選擇變差一分。

### 11.3 唯讀，作為設計約束

不是分階段的權宜之計。

1. `AGENTS.md` 把互動式 prompt 定為**契約**而非實作細節，並明寫共用函式不能免除逐入口的測試覆蓋。MCP 呼叫沒有 prompt 可以回到。
2. 互動路徑在 stdio 上**物理上不可能**：`@clack/prompts` 寫 stdout，所以在 handler 裡重用既有 command 流程會汙染協定串流。沒有任何「直接呼叫既有指令」的版本能成立。
3. **變更發生的那一刻沒有人在場。** client 的工具授權是 per-tool、常常是 per-session 的；它不是 per-call 的知情同意，也無法把 Runestone 的揭露呈現成阻斷式閘門。
4. 損失很小。`runestone_check_name` 做掉困難的部分，而 `runestone_context` 回傳確切的指令列讓人在自己的終端執行，而在那裡 prompt 規則與揭露都仍然適用。agent 提議，人執行。

若這條被推翻，閘門是以下全部：一個必須手打進 client 設定、永不預設也永不隨附的 `--allow-write` 旗標；一份恰好只有 `service add` 與 `service remove` 的允許清單；一個預設為 true 的 `dryRun` 輸入；dry-run 回傳、寫入呼叫必須回echo 的計畫 hash；`destructiveHint: true`；工具 description 裡原文承載的揭露文字；以及一份 append-only 的稽核紀錄。

### 11.4 註冊

Runestone 不寫別的工具的設定檔。`runestone mcp config` 印出區塊，由使用者貼上。

各家的形狀不同，而每一個差異都會產生「安靜地不能動」而不是「報錯」的設定。八個 client，每一列都從該廠商自己的文件讀來，並帶上 URL 與查證日期：

| `--client` | 位置 | 格式 | Key | `type` |
| --- | --- | --- | --- | --- |
| `claude` | 專案根的 `.mcp.json` | JSON | `mcpServers` | `stdio` |
| `codex` | `~/.codex/config.toml` 或 `.codex/config.toml` | **TOML** | `[mcp_servers.<name>]` | — |
| `copilot` | `~/.copilot/mcp-config.json` | JSON | `mcpServers` | **`local`** |
| `cursor` | `.cursor/mcp.json` 或 `~/.cursor/mcp.json` | JSON | `mcpServers` | `stdio` |
| `vscode` | `.vscode/mcp.json` | JSON | **`servers`** | `stdio` |
| `gemini` | `~/.gemini/settings.json` | JSON | `mcpServers` | — |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` | JSON | `mcpServers` | — |
| `zed` | Zed 的 settings 檔 | JSON | **`context_servers`** | — |

其中三項不是同一主題的變奏。**Codex 是 TOML**：一段 JSON 貼進 `config.toml` 根本不算是設定。**`type` 不是一個是非題欄位**：VS Code 文件寫 `"stdio"`、Copilot CLI 文件寫 `"local"`，而 Gemini、Windsurf、Zed 只列 `command` 與 `args` —— 所以每一列只輸出它所引用的那份文件真的有寫的形狀，因為輸出一個廠商沒有寫的欄位或值，是一個 schema 驗證器可能會拒絕的猜測。

**VS Code 與 GitHub Copilot CLI 是不同的 client**，卻經常被當成共用設定。它們在檔案、key、`type` 值三者上都不同，而且 VS Code 自己的文件寫明 Agent Host 不會讀 `.vscode/mcp.json`。兩列互相交叉引用。

某個 client 有自己的註冊指令時 —— `claude mcp add`、`codex mcp add`、`copilot mcp add` —— 會印在區塊上方，因為使用者執行的指令不可能被貼錯檔案。

專案層級的 `.mcp.json` 在互動式 session 首次使用時會要求使用者核准，非互動式則不會詢問。使用者文件必須說明這一點，否則一個正常的安裝看起來會像壞了。

### 11.5 stdout 純淨

stdout 只承載 protocol frame，別無其他。

- `src/commands/mcp.ts` 與 `src/services/mcp/**` 不得有 `console.log`、不得有 `process.stdout.write`、不得 import logger 或 `@clack/prompts`。它們也不得出現 `child_process`、`spawnSync`、`execSync` 這些字串，**連註解裡都不行**，因為驗收測試比對的是檔案文字。
- **logger 是一個 stdout writer。** 已查證：`info`、`success`、`debug` 全都用 `console.log`。規則是「不要 import logger」，不是「小心處理警告」。MCP 層有自己的、只寫 stderr 的 logger，並以 `DEBUG` 為閘門。
- 每一個從 handler 可達的 service 都經過稽核。`composeService` 會捕獲子行程輸出而不是繼承；Traefik reader 與那兩個 list 函式都不寫。`environment-doctor` 的安裝路徑用了 `stdio: 'inherit'`，絕不能可達 —— 而唯讀工具保證了這一點。
- `mcp serve` 不得在 stdout flush 完成前結束。

## 12. 失敗處理

- 每一個寫入操作都配有它的逆操作，而寫到一半失敗不留下半套狀態：寫入透過同目錄的暫存檔加 rename 達成原子性，沿用 `daemon-file.ts`。
- 未知主題、不合法的名稱、或未設定的 Runestone，都是**可修正**的狀況：訊息本身帶著修法。這與「同一個 prompt 內修正」是同一條原則，套用在機器讀者身上。
- Docker 或 Traefik 連不上**不是錯誤**：答案仍然有用，所以它是成功結果裡的一則警告加一個缺席值。
- 協定或內部故障才是錯誤。其餘都不是。

## 13. 相容性與遷移

- 無參數的 `runestone docs --ai-context` 行為如前，只是追加了內容（§7.2）。
- `tool-docs/ai-prompt-context.tmp.md` 移除，內容成為 `compose` 主題。`renderAiPromptContext()` 保留簽章作為薄包裝，維持一個版本。
- 建立 `src/utils/tool-docs/` 時，`src/utils/tool-docs.ts` 必須**刪除**。兩者並存會讓舊 renderer 默默保持生效，因為模組解析優先選檔案。
- `README.md` 目前連到 `runestone-cli/tool-docs/ai-prompt-context.tmp.md`。那個連結在 GitHub 上通、在 npm 複本裡早就是死的，而這裡那個檔案被移除了。`scripts/sync-readme.js` 重寫六個特定的 link pattern，每一個新的文件連結都需要一條規則。
- 不新增 `.env` 欄位，也不引入 state schema（§9.1）。

## 14. 測試計畫

### 14.1 離線單元測試

- Renderer：對 committed fixture 斷言 `compose` 輸出位元組相同；含 `$&`、`$1`、`$$` 的值被字面替換；未知 token 會 throw；manifest 與主題檔一對一。
- Snapshot：§6.3 的每一列；以 `spawnCommand` 的 spy 斷言零 spawn；零 stdout 與 stderr 寫入；`JSON.parse(JSON.stringify(snapshot))` 與 snapshot deep-equal；任何字串欄位不含 `'✓'`、`'✗'` 或跳脫字元。
- Marker 引擎：對任意「插入、使用者在他處編輯、替換、移除」序列，**區塊外每一個位元組不變**，涵蓋至少六種文件形狀，包含空檔、無結尾換行、CRLF、tab 縮排、使用者自己手寫的 `## Runestone` 標題、以及不相關的 HTML 註解。**這個 repository 自己那份 77 行的 `AGENTS.md` 就是其中一個 fixture。**
- conflict 與 unterminated 的 marker 什麼都不寫。

### 14.2 Command 入口測試

透過 `createProgram().parseAsync`，service 以 mock 取代，沿用 `tests/commands/status.test.ts`。互動式修正在這裡測試，不只在 helper 層。

### 14.3 整合測試

- 兩個既有的 golden test **不經修改**通過。
- Table-driven：每個主題 exit 0、`stderr === ''`、stdout 非空、不含 `{{`。
- 未設定時，每個主題：exit 1 且 stdout 全空。
- `status` 與 `install --dry-run` 什麼都不寫，以前後遞迴雜湊證明，包含沒有備份檔。
- 安裝進一個 fixture git repository：`git status` 列出的恰好是計畫的路徑。
- 產生的 skill 目錄通過 `skills-ref validate`。
- 行程層的 MCP handshake：stdin 上餵真正的 `initialize`、`notifications/initialized`、`tools/list`；exit 0、`stderr === ''`，而 stdout 每一行都是帶預期 id 的 JSON-RPC frame，別無其他。**這是整份計畫裡最有價值的測試** —— 它是唯一能抓到「日後有人重用了一個長出寫入的 service」的東西。
- 打包後的 tarball 安裝起來能渲染每一個主題，這是唯一能證明資產路徑在 `dist/` 裡正確的方法。

### 14.4 手動驗證

這個功能的目的無法用單元測試證明。線上層落地之後，在兩個真實專案裡 —— 一個 host dev server、一個 Docker 專案 —— 只給 agent `runestone docs --ai-context`，記錄它是否選對路徑、選到可用的 hostname、以及不撞名的名稱。證據放 `docs/evidence/skill/`。

## 15. 決策

由 repository 擁有者於 2026-09-07 全數裁定。

1. **產生的語料只出英文。** 它是給機器讀的 prompt，而且會 commit 進使用者的 repository，那裡設定檔的通用語言是英文；把它在地化，等於把結構對等的 gate 套到每一次改一句話上。操作者看到的訊息仍然三語走 `t()`。這是對 CLI i18n 規則的刻意departure，並如此記錄。
2. **裁定為：手寫，不用 SDK。** ~~採用 `@modelcontextprotocol/sdk`，以量測為閘門。~~ **2026-09-08 被那個為了推翻它而存在的閘門推翻。** C1 採用了 SDK 而且技術面全過 —— 結果根本不需要 `paths` mapping、`engines.node` 不用動、沒有新漏洞 —— 但量到的成本是 **107 個 production 依賴、約 15 MB，而基準是 13**。打包也量過而且可行（364 KB、handshake 乾淨），但它把依賴安全從 npm 移到我們身上，還讓一個純 `tsc` 的建置多一個 bundler。擁有者裁定手寫。C1 已 revert；production 依賴維持 13。

   SDK 原本買的、現在換我們扛的是：**協定一致性**。五個方法是很小的表面，但 MCP 修訂得快，而壞掉的長相是「我的 agent 就是看不到 Runestone」，輸出裡沒有線索。`src/services/mcp/jsonrpc.ts` 的 `PROTOCOL_VERSION` 是要跟著 bump 的東西，行程層的 handshake 測試是會抓到破裂的東西。
3. **MCP server 唯讀**（§11.3）。
4. **`troubleshoot` 在範圍內。** 它是「瀏覽器通但另一個容器不通」唯一的落點，而那是接入成功之後最常見的失敗。
5. **使用者範圍排在最後，之後有做。** 它是唯一的家目錄寫入，而且服務的是跨專案便利性而不是 §1 的目的，所以它被寫進規格並排在最後，使得放棄它不會有任何代價。2026-09-08 開始做並完成，於 Windows 驗證；它手動 gate 的 Linux 那一半未達成。
6. **stdio，不是 HTTP**（§11.1）。

## 16. 里程碑與風險控制

### 16.1 風險階梯

這裡沒有任何一步會中斷一台機器。這條階梯比 DNS 功能的淺得多，而把一個「最糟不過是 git repository 裡多一個檔案」的功能切得太碎，本身就是另一種錯。

| 等級 | 影響 | 復原 |
| --- | --- | --- |
| 0 | fixture 與暫存目錄；沒有使用者可見變化 | 沒有東西要復原 |
| 1 | 在既有指令的輸出後追加內容；讀使用者的真實路徑但不寫 | 沒有東西要復原 |
| 2 | 原本不 spawn 的路徑開始 spawn Docker 或發網路請求；或寫進使用者的 repository | `git status` 看得到；`skill remove`；旁邊有備份 |
| 3 | 寫進使用者的家目錄，那裡不在版控下；或跑一個講協定的長駐行程 | 只有我們自己的備份與 `skill remove` |

等級 3 高於 2，是因為 repository 幾乎總是在版控下，而家目錄不是。

### 16.2 排序規則

一個里程碑最多把等級抬高一階，而且下一階必須先全綠。每個里程碑都是可單一 `git revert` 的增量；這是硬約束，不是期望。

### 16.3 里程碑

排序在 `SKILL-MILESTONES.md`，該文件記錄進度與 gate。階段 A、B、C 可獨立出貨，所以工作可以在任一階段結束時停止。

| # | 里程碑 | 等級 |
| --- | --- | --- |
| A0 | 本文件與里程碑文件 | 0 |
| A1 | Renderer 與主題語料；輸出位元組相同 | 0 |
| A2 | 離線 snapshot 模組 | 0 |
| A3 | 接上 `--ai-context [topic]` 與 `--offline`，只有離線層 | 1 |
| A4 | 線上層：撞名偵測 | 2 |
| B1 | Marker-block 擁有權引擎，純函式 | 0 |
| B2 | `skill status` 與 `skill install --dry-run` | 1 |
| B3 | `skill install` 與 `skill remove`，目標目錄範圍 | 2 |
| B4 | 完整 target 表與其 wrapper | 2 |
| C1 | MCP 依賴 spike，設計成可 revert | 0 |
| C2 | `runestone mcp serve`，唯讀 | 3 |
| C3 | `mcp config`、文件、發版 | 1 |
| B5 | 使用者範圍 | 3 |

A3 是第一個使用者可見的里程碑。
