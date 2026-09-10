# Runestone Agent 支援功能里程碑

[English](SKILL-MILESTONES.md) | 正體中文

## 這份文件怎麼用

- **`SKILL-FEATURE-SPEC.zh-TW.md` 是規範來源。** 本文件不重述需求；它排序需求並記錄進度。兩者衝突時以規格為準，本文件為錯。
- **排序規則具規範性**（規格 16.2）：一個里程碑最多把風險等級抬高一階，而且下一階必須先全綠。
- 每個里程碑都是可合併的增量，而且**可以用單一 `git revert` 撤回**。這是硬約束，不是期望。
- **階段 A、B、C 可獨立出貨。** 工作可以在任一階段結束時停止，留下一個完整的產品。A 單獨就交付了正確性；B 讓人不必再手動轉述任何東西；C 讓 agent 不必解析文字。
- 建議的檔案位置只是建議。既有路徑不是：當一個交付項目點名了一個已經存在的檔案，那個檔案就是要改的那一個。
- 不要憑一個還沒跑過的測試去打勾 gate。

風險等級定義在規格 16.1，全文以編號引用。

## 狀態板

| # | 里程碑 | 風險 | 阻塞於 | 狀態 |
| --- | --- | --- | --- | --- |
| A0 | 規格與里程碑 | 0 | — | **完成** —— 兩份英文文件與兩份正體中文對照本 |
| A1 | Renderer 與主題語料 | 0 | A0 | **完成** —— 43 suites、606 通過、5 skipped，沒有動到任何既有測試檔 |
| A2 | 離線 snapshot 模組 | 0 | — | **完成** —— 44 suites、624 通過、5 skipped |
| A3 | `--ai-context [topic]` 與 `--offline` | 1 | A1, A2 | **完成** —— 44 suites、630 通過、5 skipped。第一個使用者可見的里程碑 |
| A4 | 線上層：撞名偵測 | 2 | A3 | **完成** —— 45 suites、650 通過、5 skipped |
| B1 | Marker-block 擁有權引擎 | 0 | — | **完成，之後於 2026-09-09 移除** —— 見這張表下方的說明 |
| B2 | `skill status` 與 `install --dry-run` | 1 | A1, B1 | **完成** —— 47 suites、719 通過、5 skipped。B4 的 renderer 併入此處，見下 |
| B3 | `skill install` 與 `skill remove` | 2 | B2 | **完成** —— 48 suites、743 通過、5 skipped。所有 target 都啟用，B4 隨之結案 |
| B4 | 完整 target 表與 wrapper | 2 | B3 | **完成，併入 B2 與 B3** —— 表與 renderer 落在 B2，因為 `status` 沒有它們就不存在；把每個 target 開放寫入落在 B3 |
| C1 | MCP 依賴 spike | 0 | — | **完成後於 2026-09-08 revert。** Gate 技術面全過；量到的體積被判定不可接受，擁有者裁定手寫。那正是這個里程碑存在的目的 |
| C2 | `runestone mcp serve`，唯讀 | 3 | A2 | **完成** —— 49 suites、768 通過、5 skipped。手寫協定層；production 依賴維持 13 不變 |
| C3 | `mcp config`、文件、發版 | 1 | C2 | **完成** —— 49 suites、773 通過、5 skipped |
| B5 | 使用者範圍 | 3 | B4 | **完成** —— 49 suites、788 通過、5 skipped。於 Windows 驗證；gate 的 Linux 那一半未達成 |
| C4 | MCP 工具介面：拿掉 topic enum | 3 | C2 | **完成** —— 49 suites、792 通過、5 skipped。移除一個已出貨的參數；為什麼它是錯的見下 |

A1、A2、B1、C1 都是風險 0 且彼此獨立，可以並行。A3 是第一個使用者可見的里程碑。

**2026-09-09 移除：這個功能的指引檔那一半。** repository 擁有者裁決 Runestone 不得寫進 `AGENTS.md` 或 `CLAUDE.md` —— 當初的要求是一個 skill 跟一個 MCP server，而那個標記區塊從來不是規格 §15 的決策之一。`.cursor/rules/runestone.mdc` 一併移除，理由相同：rules 檔是指引，不是 skill。

拿掉的東西：B1 的 marker 引擎整個、`--instructions-file` 選項、`cursor` target、`conflict` 與 `unterminated` 兩種 blocker，以及那 358 行為了證明 splice 安全而存在的測試與 fixture。留下的：skill 本身，寫在 `.agents/skills`、`.claude/skills` 與 `.github/skills`。沒有東西跟著消失 —— 規格 §8.1 表上每個 runtime 都靠掃這些目錄找到 skill，而那個區塊的內容 `SKILL.md` 本來就有。

**這段說明以下的內容一律不改寫。** B1 到 B5 記錄的是當時做了什麼、以及當時為什麼相信它是對的，而那份記錄正是重點：這個決定是寫下來而不是抹掉，因為一份悄悄與今天程式碼一致的里程碑文件，沒辦法顯示某個東西當初是怎麼進來的。理由寫在規格 §8.4，決策記在規格 §15 第 7 條。移除後：48 suites、734 通過、5 skipped。

## 裁決閘門

規格 15 的六項決策由 repository 擁有者於 2026-09-07 全數裁定，所以沒有任何里程碑卡在等裁決。

| 決策 | 裁定為 | 影響 |
| --- | --- | --- |
| 1 —— 語料在地化 | 只出英文；操作者訊息仍然在地化 | A1 |
| 2 —— MCP 用 SDK 還是手寫 | **裁定改判為手寫。** 原本是「SDK，以 C1 的量測為閘門」；C1 量出 107 個依賴與約 15 MB，擁有者於 2026-09-08 改判 | C1, C2 |
| 3 —— MCP 是否可變更狀態 | 唯讀，作為設計約束 | C2 |
| 4 —— `troubleshoot` 主題 | 在範圍內 | A1 |
| 5 —— 使用者範圍 | 排在最後；之後於 2026-09-08 完成 | B5 |
| 6 —— MCP transport | stdio，不是 HTTP | C2 |

唯一還能推翻計畫的量測是 C1 的。它被刻意隔離在一個設計成可以被 revert 的里程碑裡 —— 而它確實推翻了決策 2。

## A0 —— 規格與里程碑

**目標。** 把要做什麼、為什麼、以及依什麼順序寫下來，每一條事實主張不是量測過就是有引用。這個里程碑結束時不存在任何程式碼。

**風險等級 0**

**交付項目**

- [x] `docs/SKILL-FEATURE-SPEC.md` —— 16 節，沿用 `DNS-FEATURE-SPEC.md` 的形式，含成本清單與 `成本 → 約束 → 章節` 對照表
- [x] `docs/SKILL-MILESTONES.md` —— 本文件
- [x] `docs/SKILL-FEATURE-SPEC.zh-TW.md` —— 正體中文對照本
- [x] `docs/SKILL-MILESTONES.zh-TW.md` —— 正體中文對照本
- [x] 安裝路徑版圖從廠商文件量測，並記下 URL 與查證日期（規格 8.1）
- [x] `service` 欄位契約從 validator 量測，而不是從訊息表（規格 5.2）

**Gate**

- [x] 規格裡每一條標記「已查證」的主張，不是實際跑過就是讀自被引用的來源
- [x] 規格把目的定得夠窄，窄到排除安裝與設定（規格 1、3.2）
- [x] 兩份正體中文對照本存在且章節結構相同

**已落地。** 規格記下六件在第一版計畫裡就已經錯掉、現在都已量測的判斷，每一個放著都會變成缺陷：

| 修正 | 若照原樣會有的後果 |
| --- | --- |
| `buildDnsStatusReport` 不是離線的 | `docs --ai-context` 會在一條不該 spawn 任何東西的路徑上起 Docker 兩次 |
| `.agents/skills/` 才是中性位置，不是 `.claude/skills/` | 一次寫入涵蓋 Codex、Cursor 與 VS Code；原設計會寫一條 Claude 專屬路徑卻自稱多工具 |
| `name` 與 `description` 必填、`description` 上限 1024、`name` 必須與目錄同名 | 產出過不了 `skills-ref validate` 的 skill |
| logger 的 `info`／`success`／`debug` 都寫 stdout | 被汙染的 MCP 協定串流 |
| 專案的 module resolution 釘死在 node10 | SDK import 解不到型別，而且要等到工具 handler 都照它的型別寫完才會發現 |
| `service.validation.urlNoPath` 沒有任何呼叫點 | 給 agent 的內容寫著一條程式碼並不強制的規則 |

另外排進兩個重用機會，而不是等實作時才發現：`composeService.ps` 需要一個它現在沒有的 timeout 參數，而 `traefikApiBaseUrl` 已經在兩個 command 檔重複，該搬進 `traefik-api.ts`。

**兩份正體中文對照本刻意延後**，這是排程決定而不是遺漏。DNS 規格在實作**期間**被反覆修訂 —— 決策 2 被推翻、6.2 節從平台推論改寫成 daemon 型別表、還有一整個發現被撤回 —— 因為量測一直推翻計畫。這份規格走了同一條路：C1 的量測確實推翻了決策 2，而 MCP client 表從 4 家長到 8 家。現在翻譯等於翻譯兩次。對照本在規格穩定後補上，A0 在那之前不算結案。

**回收。** 只有文件。

## A1 —— Renderer 與主題語料

**目標。** 以主題語料取代單一靜態模板，並提供一個能注入區塊的 renderer，**完全沒有使用者可見的變化**。compose 主題必須位元組相同地渲染出目前指令印出的東西。

**風險等級 0**

**交付項目**

- [x] `runestone-cli/tool-docs/ai-context/compose.md` —— 現行 `ai-prompt-context.tmp.md` 的內容，只把 `${X}` 換成 `{{X}}`，其餘一字不動
- [x] `runestone-cli/tool-docs/ai-context/{overview,service,troubleshoot}.md` —— 依規格 5.1 的新內容，每一條規則依規格 5.2 從 validator 推導
- [ ] ~~`state.md`~~ —— **2026-09-07 移到 A4。** 它整份都是事實區塊，而區塊的 renderer 要等 snapshot 模組。在區塊存在之前出貨這個資產，只會得到一個一渲染就 throw 的主題
- [x] `runestone-cli/tool-docs/ai-prompt-context.tmp.md` 刪除
- [x] `runestone-cli/src/utils/tool-docs.ts` **刪除**，改成 `src/utils/tool-docs/{index,manifest,render,assets}.ts`（規格 13 —— 兩者並存會讓舊 renderer 默默保持生效）
- [x] `renderAiPromptContext(config)` 保留簽章與 export 作為薄包裝，所以 `src/commands/docs.ts` 在這個里程碑完全不動
- [x] `{{VAR}}` 與 `{{BLOCK:NAME}}` 以 function replacer 替換；未知 token 會 throw（規格 5.3）
- [x] `runestone-cli/tests/utils/tool-docs.test.ts`（25 個測試）與一份記錄今天確切輸出的 committed fixture

**Gate**

- [x] compose 主題輸出與 A1 之前**位元組相同**，對 committed fixture 斷言 —— 「位元組相同」實際上必須被釘到什麼程度，見下方行尾註記
- [x] `npm test` 全綠且**零個測試檔被修改** —— 43 suites、606 通過、5 skipped；`git diff --name-only` 對 `tests/` 只列出新檔案與它的 fixture
- [x] 含 `$&`、`$1`、`$'`、`$$` 的值被字面替換（舊 `tool-docs.ts:9` 的缺陷）
- [x] 未知 `{{TOKEN}}` 會 throw 並指名該 token；未知區塊、以及不獨佔一行的區塊佔位符也一樣
- [x] manifest 與主題檔一對一，雙向都斷言
- [x] `src/utils/tool-docs.ts` 不再存在，以測試而非目視確認
- [x] `service` 主題的欄位規則與 `normalizeRouteDomain`、`normalizeServiceUrl` 相符，由一個把文件裡的範例餵進真正 validator 的測試斷言

**已落地。** 四個主題資產與一個四檔案的 renderer。`src/commands/docs.ts` 完全沒動，所以無參數的 `runestone docs --ai-context` 仍然印 compose 簡報，而 golden 整合測試不經修改就通過。

| 模組 | 是什麼 |
| --- | --- |
| `render.ts` | 純替換：純量、區塊、function replacer、任何未展開的東西一律硬失敗 |
| `manifest.ts` | 主題清單作為資料，帶著索引與指引檔區塊需要的 `summary` 與 `brief` 長度 |
| `assets.ts` | 唯一碰檔案系統的地方，也是資產路徑深度唯一寫下來的地方 |
| `index.ts` | `renderAiContext`、相容性包裝、以及由 manifest 推導的主題索引區塊 |

**測試抓到兩件本來會出貨的事。**

第一件是過期的建置產物。`tsc` 不會刪掉來源已消失的輸出，所以舊的單檔 renderer `dist/utils/tool-docs.js` —— 還指著已被刪除的模板 —— 就坐在新的 `dist/utils/tool-docs/` 目錄旁邊並遮蔽它，因為 Node 先解檔案再解目錄。這正是規格 13 點名的陷阱，而它出現在 `dist/` 而不是 `src/`。它比本機不便嚴重：`prepack` 會跑 `build`，而 `build` 原本不清 `dist/`，所以從帶著舊產物的工作樹發佈，就會送出一個讀不到 tarball 內檔案的 renderer。`build` 現在先跑 `clean`，用 `fs.rmSync` 實作，不需要新依賴，兩個平台行為相同。

第二件是這個里程碑核心主張本身的缺陷。「位元組相同」在一個要緊的地方講得不精確。git 存的是 LF，但這台機器 `core.autocrlf` 是 `true`，所以工作樹的模板是 CRLF、A1 之前的輸出是 1986 bytes；新資產是 LF、輸出 1927。那是 59 行檔案差 59 bytes，全部是行尾。內容確實沒變 —— 把 git 裡的模板換掉分隔符再 diff 是完全相同的，剩下 8 bytes 的大小差是八個佔位符各多兩個字元。**但 fixture 測試不可能偵測到這個差別**，因為它是拿渲染結果跟同一來源產生的 fixture 比對，兩邊都 CRLF 也一樣會過。

於是有兩個改動。`.gitattributes` 把 `runestone-cli/tool-docs/**` 與 `runestone-cli/tests/fixtures/**` 釘成 LF，範圍只限這兩條路徑，所以沒有任何既有檔案改變行為 —— 沒有它，語料的位元組就取決於是誰跑了 `npm publish`，而那不該是一個被 agent 讀取的產物該有的性質。另外加一個測試斷言任何渲染出來的主題都不含 CR；驗證方式是往資產注入 CRLF、確認那條測試會紅，再還原、確認它會綠。

**一個交付項目被移動。** `state.md` 延到 A4，它的事實區塊在那裡才被建造。在 A1 出貨它會得到一個一渲染就 throw 的主題，因為 `substitute` 把未註冊的區塊視為硬錯誤而不是原樣放過。

**回收。** 單一 revert。`tool-docs/`、`src/utils/tool-docs/`、新測試與 fixture、`clean` script 與那兩行 `.gitattributes` 以外的東西都不會改變。

## A2 —— 離線 snapshot 模組

**目標。** 一個依賴注入的模組，產生規格 6.1 離線層的機器事實。這個里程碑結束時沒有任何東西 import 它。

**風險等級 0**

**交付項目**

- [x] `runestone-cli/src/services/agent-context/probe.ts` —— typed 的「存在／不存在」值，以及把 throw 轉成「不存在」而不印任何東西的包裝
- [x] `runestone-cli/src/services/agent-context/snapshot.ts` —— snapshot 型別、依賴介面、沿用 `DnsStatusDependencies` 的 `defaultAgentContextDependencies` 常數、以及 `schemaVersion: 1`
- [x] `runestone-cli/src/services/agent-context/render.ts` —— 純區塊 renderer，snapshot 進、字串出
- [x] `traefikApiBaseUrl` 提升進 `src/services/traefik-api.ts`；`src/commands/certs.ts:62` 與 `src/commands/service.ts:81` 的重複複本刪除改用它
- [x] 檔頭註解寫明這個模組不得取得 `child_process`，以及為什麼驗收測試的規則反而會讓人誤解（規格 6）
- [x] `runestone-cli/tests/services/agent-context/snapshot.test.ts`，使用 `tests/helpers/env.ts` 的 `testEnv()`

**Gate**

- [x] **零 spawn**：`spawnCommand` 的 spy 在離線層記錄到零次呼叫
- [x] **零輸出**：`process.stdout.write` 與 `process.stderr.write` 的 spy 都記錄到零次呼叫
- [x] **JSON 契約**：`JSON.parse(JSON.stringify(snapshot))` 與 snapshot deep-equal，且沒有字串欄位含 `'✓'`、`'✗'` 或跳脫字元
- [x] 規格 6.3 的每一個離線狀況都有測試：沒有 `certs` 目錄、憑證讀不到、零個 service
- [x] 無效憑證被回報為不可用，且**不**出現在被覆蓋的 domain 裡
- [~] `certs remove` 與 `service add` 在 `traefikApiBaseUrl` 提升後行為相同 —— **production 行為是的，但兩個測試檔必須改。** 見下方註記；這條 gate 沒有照原樣達成
- [x] `src/` 底下還沒有任何東西 import 這個模組，以原始碼掃描斷言

**已落地。** `src/services/agent-context/` 底下三個模組、18 個測試，而 `src/` 裡沒有任何東西 import 它們 —— 所以這個里程碑可以單一 commit revert，而且不可能改到任何行為。

| 模組 | 是什麼 |
| --- | --- |
| `probe.ts` | 一個可能取不到的事實。「沒去查」「查了但連不到」「查了，那裡沒東西」是三個不同的答案，型別把它們分開 |
| `snapshot.ts` | 離線事實，從一開始就是 JSON 形狀，架在一個沿用 `DnsStatusDependencies` 的注入介面上 |
| `render.ts` | snapshot 轉散文，純函式，一個語料區塊一個函式 |

`probe.ts` 那個三態區分是承重的部分。一個把「Traefik 連不上」讀成「沒有撞名」的 agent，會挑一個已經被佔用的名字，所以連不上的來源必須永遠產出一句話說出來，並指名能修它的指令。三種狀態各有測試斷言渲染結果不同。

**`certificateCovered` 是逐 route 算出來的，不是推論的**，透過既有的 `findCoveringCertificate`，而且只有有效憑證算覆蓋。過期憑證仍然會列出來 —— agent 需要知道它存在 —— 但它不能讓一個 hostname 看起來可用，那會把 agent 送去一個瀏覽器會拒絕的網域。

**憑證名稱取自 SAN，不從檔名推。** `CertificateListItem` 根本沒有 `domain` 欄位，而兩者是會不一致的；SAN 才是 TLS client 真正檢查的東西。這跟 DNS 功能對它的 mapping 產生所得到的結論是同一個。

**沒有照原樣達成的那條 gate。** 計畫斷言把 `traefikApiBaseUrl` 從 `certs.ts` 與 `service.ts` 提升出來，不會動到它們的測試。實際上會。兩個檔案都用一個只列 `readTraefikSnapshot` 的 factory 整包 mock 掉 `traefik-api`，所以 command 一旦從那個模組 import 第二個 export，它就變成 `undefined`，兩個 `certs rm` 測試直接以 exit code 失敗而不是斷言失敗。

production 行為確實沒變 —— 那個 helper 在兩份複本裡本來就是同一行模板。改的是兩個 mock factory，從整包替換改成 `...jest.requireActual(...)` 再覆蓋要測的那一個函式。那個寫法本來就是這裡的主流做法，而且在 `certs.test.ts` 自己裡面就出現兩次，其中一次還在被改的那個 mock 上方三行；`traefik-api` 那兩個才是例外。所以這個改動讓那兩個測試變得比較不脆弱而不是比較寬鬆，而它記在這裡而不是被默默吸收，是因為一條寫著「不改測試」然後改了測試的 gate，值得被讀第二次。

另一個選項是留著重複、讓新模組持有第三份同樣的 URL 模板。否決：第三份複本正是規格一開始就標出來的東西。

**有一個項目是改自己而不是跟規則吵。** `design-acceptance.test.ts` 斷言沒有原始碼符合 `/Makefile|make\s+[a-z]/i`，那是防止這個 CLI 取代掉的 Makefile 工具鏈回流的刻意守則。兩句新的文件註解裡是普通英文 —— 「probes that make a request」、「never make a hostname look usable」—— 而踩到了它。註解被改寫。為了兩個字去放寬一條刻意設下的守則不划算。

**回收。** 單一 revert。`traefikApiBaseUrl` 的提升與兩個 mock 改動會跟著一起 revert；那個提升本身有它自己的價值，但沒有東西依賴它留下。

## A3 —— `--ai-context [topic]` 與 `--offline`

**目標。** 讓語料與離線 snapshot 變得可觸及。**第一個使用者可見的里程碑。**

**風險等級 1**

**交付項目**

- [x] `src/commands/docs.ts` —— `--ai-context [topic]` 作為 optional-value option、`--offline`、主題解析，以及未知主題時設定 `process.exitCode = 1`、不寫 stdout、在 stderr 列出合法主題
- [x] 產生的主題 footer（規格 5.1），讓無參數呼叫在第一次就宣告其他主題的存在
- [x] `src/i18n/index.ts` —— 改寫的 `options.aiContext.description`，加上 `options.offline.description` 與 `docs.aiContext.unknownTopic`，**三個** locale 表都要
- [x] `tests/integration/cli.test.ts` —— 涵蓋每個主題的 table-driven 測試，以及未知主題測試

**Gate**

- [x] `tests/integration/cli.test.ts:158-196` **零修改**通過
- [x] `tests/integration/cli.test.ts:198-218` **零修改**通過
- [x] 第 192 行的 `not.toContain('${RUNESTONE_')` 被加強為同時禁止 `{{` —— 這是加強，不是改變它斷言的東西
- [x] 每個主題：exit 0、`stderr === ''`、stdout 非空、不殘留 `{{`
- [x] 未設定加上每一個主題：exit 1 且 `stdout === ''`
- [x] `docs --help` 仍含 `Options:` 與 `--ai-context`
- [x] `docs --env` 與 `docs --project` 仍被拒絕
- [x] 三個 locale 都產得出未知主題錯誤，沒有 key 退回英文
- [x] `docs --ai-context` 在每個離線主題上仍然零 spawn

**已落地。** `runestone docs --ai-context` 現在接受一個可選主題，而每個主題都帶著這台機器的真實事實。這結案了 repository `TODO` 的第一項：被覆蓋的 domain 與已被佔用的名稱來自 `listDomainCertificates` 與 `listServices`，兩者都是純檔案讀取，所以它們落在 agent 本來就會呼叫的路徑上，而不是躲在新旗標後面。

在這台機器上實測：無參數呼叫用 SAN 報出三張真實的 wildcard 憑證、說明目前沒有註冊任何 routed service，並以列出其他主題的 footer 結尾。

**兩個 golden test 的斷言都沒動就通過**，因為它們用的是 `toContain` 而不是相等比較，而新內容是追加的。有一條斷言是被**加強**而不是被改變：`not.toContain('${RUNESTONE_')` 在語料換成 `{{...}}` 之後變成空頭斷言，所以旁邊補上 `not.toContain('{{')`。把舊那行刪掉是比較順手的做法，也等於默默少一個檢查。

**footer 從 manifest 推導，而這件事立刻就有用。** 第一版寫死了一個指向 `runestone docs --ai-context state` 的指標。那個主題要到 A4 才存在，所以每個主題都會出貨一句指向 exit 1 的指令 —— 而照著錯指令跑的 agent 比什麼都沒被告知的 agent 更糟。footer 與撞名指引現在都讀 manifest，而指引只在確實定義了線上主題時才指名它，否則退回 `runestone service list` 與 Traefik dashboard。

**兩個值得一讀的測試改動。**

A1 的 fixture 斷言從相等改成連續前綴檢查。那是真的放寬，而且是 A3 刻意追加內容之後還能成立的最強說法；它仍然證明原本簡報裡沒有任何一句被重排、改寫或刪掉。

A2 那條「沒有任何東西 import snapshot 模組」的測試必須走，因為 A3 正是那個 import 它的人。但它沒有被刪掉，而是變成一份 allowlist：snapshot 模組只允許被 `src/commands/docs.ts` 觸及。它值得存在，是因為這個模組很好 import 也很誘人重用 —— 從 `up` 或 `setup` 去碰它，等於把憑證與 service 的讀取（之後還有 Docker 探測）放到一條一天跑好幾次的路徑上。多一個消費者應該要在 diff 裡被看到。實測：往 `up.ts` 加一行 import，測試會指名那個檔案。

順帶記下會再犯的一課：**里程碑的性質不該寫成永久測試。**「還沒有人 import 它」對 A2 是真的，之後則是刻意為假。

**`--offline` 現在就接上而不是等 A4**，因為每個已出貨的主題都是離線的，所以這個旗標的語意現在就已經正確；A4 只需要在既有接縫後面補上第二個層，不必再動介面。

**回收。** 單一 revert。`docs.ts` 回到 boolean 旗標，資產保留它們的區塊但沒有東西渲染它們，那兩個 i18n key 變成沒人用。

## A4 —— 線上層：撞名偵測

**目標。** 回答這個功能存在的理由、而離線答不出來的那個問題：這個 hostname 或 router 名稱是不是已經被別的專案佔用了？

**風險等級 2** —— 一條原本不 spawn 的路徑開始 spawn Docker 並發 HTTPS 請求。

**交付項目**

- [x] `composeService.ps(composePath, timeoutMs = 30000)` —— 加性的第二參數；`src/services/docker-compose.ts:244` 目前把 `30000` 寫死進一個本來就接受 timeout 的 `runCompose` 呼叫
- [x] `snapshot.ts` 的線上層：8000 毫秒預算的容器狀態，以及透過提升後 `traefikApiBaseUrl` 取得的 Traefik snapshot
- [ ] ~~注入依賴的 DNS 報告~~ —— **2026-09-07 捨棄，規格 6.1 偏離。** 見下
- [x] `runestone-cli/tool-docs/ai-context/state.md` —— 資產本身，從 A1 移來，加上它的事實區塊與每個連不上來源的散文
- [x] 逐主題的預設層級，以及 `--offline` 強制離線層

**Gate**

- [x] 讓 `spawnCommand` throw 且 Traefik 讀取 reject 時：`state` 仍 exit 0 且 `stderr === ''`，文字指名每一個連不上的來源與能修它的指令
- [x] `compose`、`service`、`overview`、`troubleshoot` 即使沒給 `--offline` 也**零**探測
- [x] `state --offline` 零探測
- [x] 8000 毫秒預算在呼叫點以檢查參數的方式斷言，不是量牆鐘
- [x] `buildDnsStatusReport` **完全**不從這個模組被呼叫，以原始碼掃描斷言 —— 這比原計畫的保證更強，因為那個呼叫被捨棄而不是被注入
- [x] 在 Runestone 有跑與沒跑兩種狀態下手動驗證

**已落地。** 兩個線上探測與 `state` 主題。在真實機器上、Runestone 有跑的狀態下驗證：主題回報兩個容器都在跑，並回報七個 Traefik router ID —— 其中四個，包含 `open-webui@docker` 與 `traefik-manager@docker`，是由跟這條分支毫無關係的專案註冊的。

最後那一點就是這一層存在的全部正當性。router 或 service ID 對 Traefik 是全域的，所以一個在本專案自己的 service 清單裡看起來自由的名字，可能已經被一個 agent 看不到的專案佔用，而只有 Traefik 知道。snapshot 裡其他每一項都能從檔案讀出來。

**兩個探測都不能讓呼叫失敗。** 兩者都降級成一個由 renderer 轉成散文的值，因為這個指令斷言 stderr 為空，而一個把 stdout 導出去的 agent 在 Docker 停著時仍然需要一個可用的答案。型別保留的那個區分 —— 連不上 vs 沒去查 —— 正是讓 renderer 能說出「Traefik 連不上，把這個名字當成未驗證而不是自由」而不是默默暗示什麼都沒註冊的原因。

**規格 6.1 偏離：不使用 `buildDnsStatusReport`。** 規格把它列在線上層。它被捨棄，而原始碼掃描現在斷言它「不存在」而不只是「有被注入」，那是更強的保證。

理由：它會 spawn `docker info` **以及**第二次 `docker compose ps`，所以納入它會讓這個主題的成本從兩次 spawn 變成三次。它相對於離線 `isDnsEnabled` 只多提供一項事實 —— daemon 項目是否真的生效，也就是「設定為開但沒套用」那個情況。那個情況有專屬指令 `runestone dns status`，而 `troubleshoot` 主題早就把 agent 指過去了。在一條 agent 會反覆呼叫的路徑上多付一次 spawn，去部分重複一個能好好回答它的指令，是個壞交易。如果這個落差實務上真的重要，誠實的修法是在 `troubleshoot` 裡加一行叫 agent 去跑 `dns status` —— 而那行已經在了。

**`composeService.ps` 取得了一個可選 timeout**，預設就是它原本寫死的 30000，所以每一個既有呼叫端都沒有改變。三十秒對 `status` 是對的，那裡有人在看、冷啟的 daemon 值得等；對這裡是錯的，snapshot 傳 8000。驗收測試的 arity 斷言是對 `restart` 而不是對 `ps`，所以加參數是安全的。

**round-trip 測試抓到一個 JSON 形狀陷阱。** `TraefikNamedResource.rule` 是選填的，而缺席的 key 會在 `JSON.stringify` 中消失，那會讓已發佈 schema 的形狀取決於某個 router 剛好有沒有 rule。它被正規化成 null。

**線上主題在哪裡被測試。** 不在整合測試套件裡：它的輸出取決於測試套件跑的那台機器上 Docker 剛好有沒有在跑，而那正是那種會通過好幾個月、然後因為無關的理由失敗的斷言。它在 `tests/commands/docs.test.ts` 以注入的探測、在真正的 command 入口被斷言，含兩條失敗路徑與 timeout 參數。整合套件只涵蓋未設定情況下的 `state`，那個答案不取決於 Docker。

**回收。** 單一 revert。`ps` 的 timeout 參數跟著一起 revert，有沒有它都無害；離線層完全沒動，因為分層是一個參數而不是一次改寫。

## B1 —— Marker-block 擁有權引擎

**目標。** 規格 9 的全部，作為對文字操作的純函式。什麼都不碰檔案系統，這個里程碑結束時不存在任何指令。

**風險等級 0**

**交付項目**

- [x] `runestone-cli/src/services/skill/version.ts` —— 模板版本常數與 marker 字串
- [x] `runestone-cli/src/services/skill/marker-block.ts` —— `findManagedBlocks`、回傳 absent／matched／stale／conflict／unterminated 的 `identifyBlock`，加上 `insertBlock`、`replaceBlock`、`removeBlock`，全部純函式
- [x] `detectNewline` 與 `splice` 重用自 `src/services/dns/json-edit.ts` 而不是重新實作
- [x] `nextBackupPath` 從 `src/utils/project-files.ts:129`（目前 module-private）export 出來或移到共用 util
- [x] `runestone-cli/tests/services/skill/marker-block.test.ts`，並把這個 repository 自己 77 行的 `AGENTS.md` 當成 committed fixture

**Gate**

- [x] **不變量測試**：對任意「插入、使用者在區塊外編輯、替換、移除」序列，**區塊外每一個位元組不變**，涵蓋至少六種文件形狀 —— 空檔、無結尾換行、CRLF、tab 縮排、已有使用者自己手寫 `## Runestone` 標題的檔案、以及含不相關 HTML 註解的檔案
- [x] 對 committed 的 `AGENTS.md` fixture 做插入再移除，77 行全部位元組相同
- [x] 兩個 `begin` marker 產生 `conflict` 且什麼都不寫
- [x] 有 `begin` 但沒有 `end` 產生 `unterminated` 且什麼都不寫
- [x] 重複插入絕不產生第二個區塊
- [x] 這個里程碑中 `src/services/skill/` 底下沒有任何檔案 import `fs`，以既有 `child_process` 掃描的方式斷言

**已落地。** `identifyBlock`、`insertBlock`、`replaceBlock`、`removeBlock`，全部純函式，47 個測試。`detectNewline` 與 `splice` 來自 DNS 引擎而不是重新實作，而 `nextBackupPath` 現在從 `project-files.ts` export 出來供 B3 使用。

**保證被精確地陳述，因為寬鬆的版本無法測試。**「區塊外什麼都不變」不可能成立：`insertBlock` 必須把區塊放在**某個地方**，而一個結尾沒有換行的檔案，不記住原本是什麼就無法還原成那個狀態 —— 而不必記住正是 marker 模型存在的理由。實際成立、並寫進原始碼的是：

> 使用者內容的每一個位元組在插入、替換、移除後都存活。檔案結尾的換行串被正規化成恰好一個換行。

第二個子句是真的改變，而且沒有被藏起來：結尾沒有換行的檔案會多一個，結尾有三個空行的檔案回來時一個都沒有。其他什麼都不動。

**第一版有一個真的 off-by-one，而第一版的測試看不見它。** `removeBlock` 吃掉了兩個換行，而 `insertBlock` 只加了一個,這會把使用者的最後兩行併掉。不變量測試裡每一種形狀都把區塊放在檔尾,而接縫正規化剛好吸收掉這個誤差 —— 所以帶著這個 bug 整個套件是綠的。以注入的方式驗證過:39 個測試 39 個仍然綠。

修法是加一種「使用者自己的文字在我們的區塊**之後**」的形狀,並以相等斷言。重新注入那個 bug 現在會讓那八個案例全部失敗、而且只有它們失敗。那才是真正值回票價的測試;其他形狀是它周圍便宜的保險。

**這個里程碑期間有兩次失敗是測試的錯而不是引擎的錯**,而且兩者都是那種否則會被「修」在錯的地方的類型。一個逐行內容比對回報了假的 CRLF 差異 —— 最後一行內容在後面有更多檔案內容時,理當重新取得它的 carriage return —— 所以內容主張改成前綴斷言。而 replace 測試用的 body 是 `generated` 與 `regenerated`,所以它「舊 body 已經不在」的斷言永遠不可能失敗;現在兩個 body 互相不是子字串。

**回收。** 單一 revert。還沒有東西 import 這個引擎;`nextBackupPath` 的 export 本身是惰性的。

## B2 —— `skill status` 與 `skill install --dry-run`

**目標。** 讀使用者的真實檔案並回報一次安裝會做什麼。**什麼都不寫。**

**風險等級 1**

`skill install` 在這個里程碑只接受 `--dry-run`,否則拒絕並說明寫入落在下一個增量。這些是分支增量而不是 release —— 只有 C3 是發版邊界 —— 所以一個會拒絕的指令是檢查點,不是出貨的缺陷。

**交付項目**

- [x] `runestone-cli/src/services/skill/targets.ts` —— 內建 target 表作為**單一**資料結構,每一列帶著它的文件 URL 與查證日期（規格 8.2）
- [x] `runestone-cli/src/services/skill/plan.ts` —— `planInstall` 與 `planRemove`,對注入的讀取為純函式,決定每一個 blocker
- [x] `runestone-cli/src/services/skill/scope.ts` —— 目標目錄解析與 `RUNESTONE_SKILL_HOME`
- [x] `runestone-cli/src/commands/skill.ts` —— **自己沒有任何 option** 的 parent,加上 `status` 與 `install --dry-run`
- [x] `skill status` 的表格用 `src/utils/text.ts` 的 `padToWidth`,**不是** `padEnd` —— `certs.ts:58` 與 `service.ts:100` 兩處對 CJK 都是錯的,不可複製
- [x] `src/cli.ts` 註冊;`src/i18n/index.ts` 三個 locale 的字串
- [x] `tests/services/skill/plan.test.ts` 與 `tests/commands/skill.test.ts`
- [x] `skill`、`skill install`、`skill status`、`skill remove` 加進 `tests/integration/cli.test.ts:55-71` 與 `:89-99` 的指令清單,`'skill'` 加進 `design-acceptance.test.ts:69`

**Gate**

- [x] `status` 正確回報五種狀態:未安裝、當前、過期、當前版本但被改過、指引檔衝突
- [x] `status` 與 `install --dry-run` 什麼都不寫,以前後遞迴目錄雜湊證明,**包含沒有任何備份檔**
- [x] `skill --help` 不印 `Options:` 區段,第一行不含 `[options]`
- [x] `--project` 與 `--env` 在 `skill` 與三個子指令上都被拒絕
- [x] Target 自動偵測:`.agents/`、`.claude/`、`.cursor/`、`.codex/`、`AGENTS.md` 各自單獨存在時恰好選中自己的 target;什麼都沒有時選中性預設
- [x] `--skills-dir` 與 `--instructions-file` 覆寫表格
- [x] `--user` 與 `[dir]` 同時給時 exit 1;`--user --target cursor` exit 1 並說明理由
- [ ] ~~不合法的 `[dir]` 回到同一個 prompt~~ —— **不適用,見下。** B2 沒有任何 prompt:還沒有任何東西是互動的,因為還沒有任何東西被寫入
- [ ] ~~空的 target 選擇回到同一個多選~~ —— **延到 B3。** 多選屬於寫入那一側,B2 改為回報「什麼都沒偵測到」並附上能解決它的兩個旗標
- [x] `RUNESTONE_SKILL_HOME` 生效時被 `skill status` 大聲回報
- [x] 每一個新的訊息 key 都存在於三個 locale 表

**已落地。** Target 表、renderer、planner、範圍解析,以及 `skill install --dry-run` 與 `skill status`。什麼都不寫:兩個測試在前後對整個目錄做雜湊並斷言它沒變,包含沒有 `.bak`。

在暫存 git repository 裡手動驗證:對一個含 `.agents/` 與一份手寫 `AGENTS.md` 的目錄做 dry run,會規劃六個檔案建立與一次區段追加、指名備份路徑,而事後 `git status` 只顯示測試自己建立的那個檔案。

**`.agents/skills/` 是預設,而那是這個里程碑的實質。** 寫一次就被 Codex、Cursor 與 VS Code / Copilot 讀到。Claude Code 是記錄在案的例外,拿到 `.claude/skills/` 加 `CLAUDE.md`,因為它兩個中性路徑都不讀。Codex 是中性指引檔的別名而不是同一區塊的第四份複本 —— 由測試斷言,因為誘人的實作會連 `.codex/` 一起寫。

**三層,好讓一條路徑搬家不需要發版。** 表是單一檔案裡的資料,每一列帶著它的來源文件 URL 與查證日期;`--skills-dir` 與 `--instructions-file` 為表格不認得的 runtime 覆寫它。路徑覆寫被視為意圖的陳述,因此隱含中性 target,而不是要求同時給 `--target`。

**B4 併入這個里程碑與 B3。** `status` 必須拿已安裝的內容跟新渲染的內容比較,所以它沒有 B4 原本要加的那些 renderer 就不存在。硬拆會得到一個回答不了自己問題的 `status`。真正屬於 B4 形狀的部分 —— 把每個 target 開放**寫入** —— 落在 B3,那才是風險等級真正改變的地方。

**`--project` 是由構造而非慣例而缺席。** `PROJECT_DIR` 在這個 CLI 裡已經是指 `~/.runestone`,所以目的地是 positional 參數,使用者範圍是一個 boolean。`skill` 與兩個子指令現在都在整合套件那份「必須拒絕 `--env` 與 `--project`」的清單裡。

**allowlist 測試立刻就值回票價。** 往 `skill.ts` 加 snapshot import 讓 A3 的 allowlist 紅了,一如預期 —— 那個模組多一個消費者是決策,不是意外。它現在被列進去並附上理由,而第二條斷言強制那個理由所主張的事:安裝器只用離線 builder,不得觸及線上的那一個。安裝好的檔案活得比寫入那一刻久,所以烤進去的即時事實幾分鐘後就是謊言。

**兩條 gate 不適用。** 兩者都關於互動式 prompt,而 B2 裡沒有任何互動,因為沒有任何東西要確認。「什麼都沒偵測到」是以能解決它的兩個旗標回報的;多選隨著寫入抵達,在 B3。

**回收。** 單一 revert。指令消失;沒有其他東西呼叫 `src/services/skill/`。

## B3 —— `skill install` 與 `skill remove`

**目標。** 第一次寫進屬於使用者的目錄。`--user` 在這個里程碑**不被接受**。

**風險等級 2**

**交付項目**

- [x] `runestone-cli/src/services/skill/apply.ts` —— `applyInstall` 與 `applyRemove`,透過同目錄暫存檔加 rename 達成原子寫入
- [x] 列舉每一個絕對路徑的確認,含 `-y/--yes`、`--force`,以及鏡像 `src/commands/dns-enable.ts:537` 的非 TTY 拒絕
- [x] `skill remove`,別名 `rm` 與 `del`
- [x] ~~只有中性 target~~ —— **每一個 target 都啟用**,所以 B4 在這裡結案而不是另開一個里程碑
- [x] `tests/services/skill/apply.test.ts`

**Gate**

- [x] 安裝進 fixture git repository:`git status` 列出的**恰好**是計畫的路徑,沒有多的
- [x] 版本沒變的重裝什麼都不寫,**不產生**備份檔
- [x] 安裝在 committed 的 77 行 `AGENTS.md` 上,區塊外每一行位元組相同;`remove` 讓那個檔案回到位元組相同
- [x] 帶較舊模板版本的孤兒檔會被移除
- [x] 被使用者改過、處於當前版本的檔案,沒有 `--force` 就跳過,有的話就備份後改寫
- [x] 衝突的指引檔導致拒絕:什麼都不寫,並印出 offset 與手動移除步驟
- [x] `remove` 只刪除帶 marker 的檔案;沒有 marker 的檔案保留該目錄並在輸出中被點名
- [x] dry-run 的輸出與實跑的計畫**逐行相同**
- [x] 非 TTY 且沒有 `--yes` 時拒絕;有 `--yes` 時執行
- [x] 設定漂移偵測得到:安裝、改 `.env` 的 `PREFIX`、`skill status` 回報已安裝的檔案過期
- [~] `skills-ref validate` —— **以替代方案達成。** 已發佈的驗證器需要網路抓取,所以規格的約束改以離線方式直接斷言:`name` 與其目錄同名並符合字元規則、`description` 在 1024 以內、`metadata` 的值全部是字串、`allowed-tools` 缺席、檔案在 500 行以內。同樣的規則,而失敗時會指名欄位

**已落地。** `apply.ts`、`remove` 指令、含 `--yes` 的確認、非 TTY 拒絕,以及每一個 target 都啟用。48 suites、743 通過。

在暫存 git repository 裡手動驗證,而這個順序才是重點:

| 步驟 | 結果 |
| --- | --- |
| `install --yes` 進一個含手寫 `AGENTS.md` 的目錄 | 寫入七個檔案,取了一份備份 |
| 再一次 `install --yes` | 「everything is already up to date」;**沒有第二份備份** |
| `status` | 七個全部回報為當前 |
| `remove --yes` | `AGENTS.md` **位元組相同**,空的 skill 目錄被清掉 |

**跑起來才找到的一個真正的越界。** 目錄清理的第一版會一路往上爬到不能爬為止,所以 `remove` 刪掉了 `.agents/` —— 一個**使用者**建立的目錄,而且正是 target 偵測會去看的那一個。沒有東西遺失,但之後的 `skill install` 會偵測不到任何東西而拒絕,理由是使用者無法跟自己做過的任何事連上的。清理現在停在 skill 自己的目錄:它之上的一切屬於 runtime 或使用者,即使清掉我們的檔案讓它變空。這一點連同「移除後偵測仍然有效」一起被斷言。

**一個開始因為錯誤理由而通過的過期測試。** B2 有一個叫「沒有 `--dry-run` 就拒絕寫入」的測試,斷言 exit 1,因為那個版本根本不能寫。B3 開放了寫入,而那個測試繼續通過 —— 通過的是非 TTY 檢查,因為 jest 給行程一個非 TTY 的 stdin。它在回報一個它已經不再測試的保證。它現在就是它悄悄變成的那個非 TTY 拒絕測試,旁邊多了兩個新測試:一個證明 `--yes` 真的會寫,一個斷言 dry-run 輸出與實跑計畫逐行相同。

**`skills-ref validate` 是被替代,不是被略過。** 已發佈的驗證器需要網路抓取,那不屬於這個測試套件。規格的約束改為直接斷言 —— `name` 與其父目錄同名並符合字元規則、`description` 在 1024 字元以內、每一個 `metadata` 值都是字串、`allowed-tools` 缺席、檔案在 500 行以內 —— 涵蓋四個 target。同樣的規則、離線、而且失敗時會指名欄位而不是只吐一個非零 exit code。

**`allowed-tools` 是刻意缺席的。** 規格定義了它,而從一個安裝進別人專案的檔案裡去限制 agent 的工具存取是僭越,而且會在沒有可見原因的情況下弄壞他們的工作流程。有測試斷言它保持缺席。

**回收。** 單一 revert。已經安裝的東西可以用被 revert 掉那個版本的 `skill remove` 移除,而且每個產生的檔案都帶 marker,所以手動移除也是可行的。

## B4 —— 完整 target 表與 wrapper

**併入 B2 與 B3 並在那裡結案。** 沒有任何東西被放棄;錯的是切法而不是工作本身。

`status` 必須拿已安裝的內容跟新渲染的內容比較,所以它沒有這個里程碑原本要加的 renderer 就不存在 —— 硬拆會得到一個回答不了自己問題的 `status`。因此表與每一個 renderer 落在 **B2**,而把每個 target 開放**寫入**落在 **B3**,那才是風險等級真正改變的地方。

每個交付項目最後落在哪裡:

| 交付項目 | 落在 |
| --- | --- |
| `claude` —— `.claude/skills/runestone/` 加 `references/*.md` | B2（渲染）、B3（寫入） |
| `cursor` —— `.cursor/rules/runestone.mdc`,單一串接檔 | B2、B3 |
| `codex` —— 指引檔 target 的別名,不是第四份複本 | B2,由測試斷言 |
| `copilot-vscode` —— `.github/skills/runestone/` | B2、B3 |
| 由每個主題的摘要建成的指引檔區塊 | B2 |
| 表格本身記載 Claude Code 例外 | B2 |

Gate 項目也跟著移動:規格的 `SKILL.md` 約束在 B3 以離線方式斷言（該里程碑說明了為何替代掉已發佈的驗證器）、`.mdc` frontmatter 在 B2 以 YAML 解析、而「安裝好的檔案裡不得出現任何即時事實」由 B2 記載的 allowlist 斷言強制。

**id 是 `copilot-vscode` 而不是 `copilot`。** `mcp --client copilot` 指的是 Copilot CLI,那是另一個產品、有自己的設定檔;一個 id 同時代表兩者,讀起來會像「裝了其中一個就會設定好另一個」。有測試斷言兩份清單不共用它。

**回收。** 不可單獨 revert,因為它不是一個獨立的 commit。B3 revert 寫入;B2 revert 表與 renderer。

## C1 —— MCP 依賴 spike

**目標。** 弄清楚 SDK 到底能不能採用,以及代價是否值得付。**這個里程碑存在的理由就是它可以被 revert。**

**風險等級 0**

**交付項目**

- [x] `@modelcontextprotocol/sdk` 進 `dependencies` —— **結果根本不需要 `tsconfig.json` 的 `paths` mapping**,與規格決策 2 的預測相反
- [x] 一個一次性模組,import server、stdio transport、in-memory transport 與 client,證明四者都型別解得到且 runtime 載得起來
- [x] 記錄下來的量測:依賴數與體積的差值

**Gate**

- [x] `npm run build` 綠且 `module` 與 `moduleResolution` **未改動**
- [x] `npm test` 綠,SDK import 在 ts-jest 下可用
- [~] ~~一個在 SDK 升級移動 `paths` 目標時會大聲失敗的測試~~ —— **不適用。** 不需要 `paths` mapping,所以沒有目錄要守
- [x] `engines.node` 未改動
- [x] 量測寫下來 —— **而且不被接受**

**落地後於 2026-09-08 revert。** 每一條技術 gate 都過了,而且讓這個里程碑看起來有風險的那個預測是錯的:不需要 `paths` mapping、`engines.node` 沒動、`npm audit --omit=dev` 什麼都沒報。

失敗的是成本:

| | 之前 | 加上 SDK |
| --- | --- | --- |
| Production 依賴 | 13 | 107 |
| 安裝體積 | — | 多約 15 MB |

打包也量過而且可行 —— 364 KB,行程層 handshake 乾淨 —— 但它把依賴安全從 npm 的公告來源移到我們身上,還讓一個原本純 `tsc` 的建置多一個 bundler。擁有者裁定手寫。

**這次 revert 也移除了這個里程碑意外 commit 進去的 `package-lock.json`。** `git add -A` 把它撿了進來,而同一個 commit message 裡才剛說過,加不加 lockfile 不是這條分支該決定的事。revert 把那件事一併修正。

**這是里程碑照設計運作,不是失敗。** 它一開始就是為了可以被 revert 而寫、被排在沒有任何東西依賴它的位置,而它促成的裁決連同產生它的量測一起記在規格決策 2。SDK 原本買的東西 —— 協定一致性 —— 現在是一個記在 `jsonrpc.ts` 裡、由行程層 handshake 測試守著的明確責任。

**回收。** 已完成:一次 revert,移除了依賴、一次性模組,以及那個意外的 lockfile。

## C2 —— `runestone mcp serve`,唯讀

**目標。** 一個走 stdio 的唯讀 MCP server,暴露規格 11.2 的三個工具。

**風險等級 3** —— 一個講協定的長駐行程。

**交付項目**

- [x] `runestone-cli/src/services/mcp/{server,tools,log}.ts`,`log.ts` 只寫 stderr 並以 `DEBUG` 為閘門
- [x] `runestone-cli/src/commands/mcp.ts` —— 薄殼;`mcp` parent 加一個 `serve` 子指令,沿用 `dns` 的形狀
- [x] 三個工具,全部標註唯讀,全部由既有 validator 與 A2 的 snapshot 組成
- [x] `src/cli.ts` 註冊;三個 locale 的 i18n 字串
- [x] `tests/services/mcp/{tools,server}.test.ts`,以及 `tests/integration/cli.test.ts` 裡的行程層 handshake 測試

**Gate**

- [x] in-memory 的 `tools/list` 回傳恰好三個工具與預期的 input schema
- [~] ~~`process.stdout.write` 記錄到零次呼叫~~ —— **重述。** transport 的工作就是把 frame 寫到 stdout,所以「零次寫入」是錯的規則。改為斷言:去掉註解後,任何 MCP 原始碼都沒有 console 呼叫、沒有 logger 或 prompt 函式庫的 import;而 `process.stdout` 恰好出現在一個地方,也就是 transport 的預設參數
- [x] **行程層 handshake**:stdin 上餵真正的 `initialize`、`notifications/initialized`、`tools/list`,得到 exit 0、`stderr === ''`,而 stdout 只含帶預期 id 的 JSON-RPC frame
- [x] `mcp serve` 在 stdin 立即 EOF 時 exit 0 且不吊住測試套件
- [x] 原始碼掃描證明 `src/commands/mcp.ts` 與 `src/services/mcp/**` 沒有 `console.log`、沒有 `process.stdout.write`、沒有 import logger 或 `@clack/prompts`,也沒有那三個 spawn 字串,**連註解裡都沒有**
- [x] Docker 停著、Traefik 連不上時,每個工具都回傳成功結果
- [x] 未設定的 Runestone 在**成功**結果裡產生 `configured: false`,文字含 `runestone setup`
- [x] `mcp` 與 `mcp serve` 加進 `cli.test.ts` 的兩份指令清單;`design-acceptance.test.ts` 綠

**已落地。** 一個手寫的 JSON-RPC 層、三個唯讀工具、stdio 迴圈,以及 `runestone mcp serve`。**production 依賴維持 13 不變**,那正是促成它的裁決要換到的東西。

對真正的 binary 驗過:四個 request 加一個 notification 進去、四個 frame 出來、`stderr` 空的、未知方法回 `-32601`,而 `check_name` 正確找到這台機器上覆蓋候選 route 的那張 wildcard 憑證。

**C1 被 revert,而那正是它被建造的目的。** 它的 gate 技術上全過 —— 不需要 `paths` mapping、`engines` 不用動、沒有新漏洞 —— 但量到的成本是 107 個 production 依賴與約 15 MB,而基準是 13。打包也量過而且可行(364 KB、handshake 乾淨),但它把依賴安全從 npm 移到我們身上,還讓一個純 `tsc` 的建置多一個 bundler。擁有者裁定手寫。

**SDK 原本買的是什麼,講清楚,因為現在換我們扛:** 協定一致性。五個方法是很小的表面,但 MCP 修訂得快,而壞掉的長相是「我的 agent 就是看不到 Runestone」,輸出裡沒有線索解釋。`jsonrpc.ts` 裡的 `PROTOCOL_VERSION` 是要跟著 bump 的東西,行程層的 handshake 測試是會抓到破裂的東西。

**兩個值得點名的協定細節**,因為它們正是手寫 server 最容易做錯的:

- notification 沒有 id,絕對不能回應。回覆 `notifications/initialized` 會留下一個對不上的 response,有些 client 會判為協定錯誤。已知與未知的 notification 都有斷言。
- 解析失敗時沒有可還原的 id,所以 response 帶 `null`,不是用猜的。

**模型可以自己修正的狀況是成功結果,不是 JSON-RPC 錯誤。** 未知主題、不合法的名稱、未設定的 Runestone:全部帶 `isError` 與那句能修好它的訊息回去,因為 JSON-RPC 錯誤會走到 client 的錯誤路徑,模型在那裡根本讀不到。這就是 `AGENTS.md` 那條「同一個 prompt 內修正」的規則,套在機器讀者身上。

**有一條 gate 是被重述而不是被打勾。** 計畫寫著 `process.stdout.write` 必須是零次呼叫。那是錯的規則:把 frame 寫到 stdout 正是 transport 的全部工作。純淨掃描的第一版在三個地方紅了 —— 其中兩個是在**解釋這條規則**的註解,另一個是 transport 自己的預設輸出參數。現在斷言的是本來真正想講的。

**順帶抓到一個什麼都沒證明的對照組。** 純淨掃描的第一次反向驗證用字串取代注入 `console.log`,但那個取代其實沒有命中,於是它「通過」了卻什麼都沒測。重做時加上「注入確實生效」的斷言,掃描才如預期地紅、還原後綠。這是這條分支上第二次遇到同一種失敗模式。

**回收。** 單一 revert。沒有其他東西 import `src/services/mcp/`,也沒有既有指令改變。

## C3 —— `mcp config`、文件、發版

**目標。** 讓這個功能可被找到、可被使用,並出貨。

**風險等級 1**

**交付項目**

- [x] `runestone mcp config [--client <name>]`,依 client 印出正確的區塊
- [x] `docs/AI-AGENTS.md` 加 `.zh-TW.md` 與 `.ja-JP.md` —— 面向使用者的說明,含專案層級 `.mcp.json` 首次使用要核准的行為
- [x] 根 `README.md` 的「Project Integration」改寫,不再要求使用者手動轉述指令;`docs/README/README.zh-TW.md` 與 `README.ja-JP.md` 逐行對齊
- [x] `runestone-cli/scripts/sync-readme.js` —— 新文件連結的重寫規則,以及移除 `README.md:163` 那個已經死掉的 `ai-prompt-context.tmp.md` 連結
- [x] `runestone-cli/DESIGN.md` —— 6.6 節改寫、7 節的指令清單擴充、13 節的驗收標準更新
- [x] `runestone-cli/CHANGELOG.md` —— 只寫使用者感受得到的變更
- [x] 根 `AGENTS.md` —— 新增 `## Skill Feature Rules` 一節

**Gate**

- [x] `npm pack --dry-run` 含 `tool-docs/ai-context/` 底下每一個檔案
- [x] 打包後的 tarball 能渲染每一個主題 —— 裝進暫存 prefix 而不是全域,所以這台機器上正在用的 `runestone` 沒有被覆蓋。同樣的證明,沒有副作用
- [x] `mcp config` 的輸出 parse 成 JSON,而它的 `command` 與 `args` 餵進 C2 的 handshake 測試能跑出一個可用的 session
- [x] 同步後的 npm README 每一個連結都解得到
- [x] 三種語言的 `docs/AI-AGENTS.md` 有相同的標題數與層次、相同的表格、相同的 code block —— 以機械方式檢查
- [x] `runestone skill install` 在三種 README 語言裡都有記載

**已落地。** `runestone mcp config`、三語使用者文件、三種語言的 README 改寫,以及維護者規則。

**打包出來的 tarball 有真的裝起來跑過**,這是單元測試無法滿足的那條 gate:四個離線主題都能從打包後的配置渲染、沒有任何未展開的佔位符,證明 A1 改動的資產路徑深度在 `dist/` 裡也是對的,不只是在 `src/`。裝進暫存 prefix 而不是全域,所以這台機器上正在用的 `runestone` 沒有被動到。

**`mcp config` 只印,不寫。** 去改別的工具的設定檔,跟去改 Docker daemon 的設定檔是同一類行為,而這個專案把那類行為視為最高風險。而且各家的形狀真的不一樣,又因為其他部分長得一模一樣而特別容易漏看。八個 client,每一列都帶 key、位置、文件 URL 與查證日期,而且都有測試逐列斷言。

其中三項不是同一主題的變奏。**Codex 是 TOML**:一段 JSON 貼進 `config.toml` 根本不算是設定,所以另外手寫了一個四行的 TOML renderer。**`type` 不是一個是非題欄位**:VS Code 文件寫 `"stdio"`、Copilot CLI 文件寫 `"local"`,而 Gemini、Windsurf、Zed 只列 `command` 與 `args`。而 **VS Code 與 GitHub Copilot CLI 是不同的 client**,在檔案、key、`type` 值三者上都不同,兩列互相交叉引用。

**這個里程碑自己的 gate 抓到兩個既有的壞連結。** `scripts/sync-readme.js` 會把相對文件連結改寫成絕對 URL 給 npm 複本用,而它從來沒有 `docs/DOMAINS.md` 與 `docs/DOMAINS.zh-TW.md` 的規則 —— 所以自從那兩份文件寫出來以後,每一次發佈的 README 裡它們都是死的。跟新規則一起修掉而不是另外記著:同一個檔案、同一個成因、兩行。

**還有一個一出生就會壞的連結。** 兩份在地化 README 位於 `docs/README/`,所以它們用兄弟層寫法指向 `AI-AGENTS.zh-TW.md` 會解到高一層的目錄。在 commit 前用實際渲染出來的路徑檢查抓到,而不是假設英文檔的寫法可以照搬。

**三語結構對等,以機械方式檢查:** 八個標題、層次相同、十三列表格、十四行 code fence。行數不同 —— 142、107、107 —— 因為英文換行方式不同,這正是 gate 訂在結構而不是長度的原因;既有的 `DNS.*` 三份也是同樣情形。

**回收。** 文件乾淨地 revert。`mcp config` 是加性的,沒有東西依賴它。

## B5 —— 使用者範圍

**風險等級 3**

**Gate**

- [x] 確認訊息印出**解析後的絕對路徑**,沒有佔位符,在真實機器上驗過
- [x] 在 `RUNESTONE_SKILL_HOME` 重導下完成 install、status、remove 的完整循環,而真實的 `~/.claude`、`~/.codex`、`~/.agents` 以前後雜湊**可證明未被觸碰**
- [x] 於 Windows 手動驗證。**Linux 那一半以「不成立」撤回,不是略過** —— 見下
- [x] 帶著使用者自己內容的既有 `~/.codex/AGENTS.md`,在插入、替換、移除後區塊外位元組相同

**已落地。** 大部分程式碼在 B3 與 B4 就已經在了;B5 加的是驗證,而驗證找到兩個缺陷。

在 Windows 上以 `RUNESTONE_SKILL_HOME` 重導驗證:install、status、remove 全部 exit 0;一份帶著使用者自己規則的既有 `~/.codex/AGENTS.md` 在完整循環後位元組相同;而四個真實家目錄的目的地事後仍然不存在,所以沒有任何東西被寫到重導之外。

**最後那一點的第一次量測是污染的,必須重做。** 它對整個 `~/.claude` 做雜湊,而這個 session 本身就在往那裡寫自己的狀態,於是它回報了一個跟 Runestone 無關的變化。誠實的檢查只探測 Runestone 可能寫入的那四條路徑,別無其他。

**缺陷一:中性預設的退路根本不存在。** 規格 8.2 讓中性位置成為「偵測不到更明確目標時,無參數 `skill install` 會寫的東西」,而 B2 的 gate 也正是這樣寫的 —— **而且我把它打勾了**。程式碼實際上是在每一條非互動路徑報「No agent runtime detected」然後 exit 1:`--dry-run`、`--user`、`--yes`,以及任何非 TTY shell。一個還沒有這些目錄的專案是最常見的情況,所以文件上那條主打指令對多數新使用者是直接失敗的。

已改成符合規格,並保留舊行為做對的那一半:互動路徑仍然會問,因為有人可問就比用預設好;而退回預設時會宣告自己,不是默默選一個。編碼舊行為的那個測試是改寫而不是刪除,理由記在測試裡。

**缺陷二:`--target` 接受的比它公告的多。** `codex` 是 `agents` 的合法別名,但未知 target 的錯誤訊息只列正規表格,所以任何打錯字的人永遠不會知道那個別名存在。錯誤訊息現在也列出別名。

**順帶為我先前自己造成的一個缺陷加了守門測試。** `copilot-cli` 改名為 `copilot` 是用全域字串取代做的,而它也重寫了 GitHub 文件 URL 裡的一個路徑片段,把一個引用變成 404。已還原,並加測試釘住那個產品路徑片段。這個守門測試的第一版寫得太寬,反而把正確的 URL 標成錯的 —— 因為 GitHub 真實路徑裡本來就有 `/copilot/how-tos/` —— 已收窄到真正壞掉的那一段。

**這條 gate 的跨平台那一半於 2026-09-08 撤回,而理由值得記下來,因為它本來就是照抄進來的。**

它來自 DNS 里程碑,而那裡的跨平台驗證有具體的承重理由:daemon 設定檔路徑逐平台不同、Docker Desktop 與原生 engine 行為不同、牽涉提權、而且有東西要綁 port 53。寫 Markdown 一項都不沾。

兩個量測結案,而且它們比在 Linux 上手動跑一次更強:

- **沒有任何會分歧的平台條件式程式碼。** `process.platform`、`win32`、`darwin` 在 `src/services/skill/` 與 `src/commands/skill.ts` 裡完全不存在。相對路徑以 `/` 儲存、透過 `path.join(root, ...relative.split('/'))` 組合;家目錄根來自 `os.homedir()`。在 Linux 上跑會執行完全相同的程式碼。
- **唯一真正因平台而異的軸是行尾,而它被直接測試。** marker 引擎的不變量套件帶有五個 CRLF 案例,涵蓋插入、替換、移除,以及區塊位於檔案中段的往返。那比手動跑一次單一行尾風格的保證更強。

憑「它應該一樣」去打勾一條 gate,是這份文件明文禁止的,而且禁得對。因為一條 gate 對這個功能從來就不成立而撤回它,是另一回事,而這段註記就是那個成立理由。

**回收。** 單一 revert。中性退路與別名列示本身有它們的價值,但會跟其餘部分一起乾淨地 revert。

## C4 —— MCP 工具介面：拿掉 topic enum

**目標。** 從 MCP 介面移除 `topic` 參數，因為產生它的那個約束在那裡不成立。

**風險等級 3** —— 它改動一個已經出貨的介面。

**交付項目**

- [x] 規格 11.2 改寫：四個工具、沒有 topic，含理由與量測
- [x] 規格 5.1：`all` 標記為 CLI 專屬、沒有 MCP 對應，並寫明它的順序
- [x] `runestone_integration_guide` 與 `runestone_troubleshoot` 取代 `runestone_context`
- [x] CLI 實作 `--ai-context all` —— 它被規格寫著卻不存在
- [x] manifest 加上 `ALL_TOPIC` 與 `ALL_TOPIC_ORDER`，讓順序只寫一次
- [x] `runestone docs --help` 列出每一個主題並附在地化說明
- [x] 測試、三語使用者文件、changelog

**Gate**

- [x] 沒有任何工具接受 `topic`，也沒有任何工具的 input schema 含 `enum`
- [x] 每一個語料主題都恰好抵達一個工具，對 manifest 斷言
- [x] 指南在一次呼叫裡包含兩條接入路徑與護欄清單
- [x] 指南與疑難排解樹即使沒給 `offline` 也**零**探測
- [x] `--ai-context all` exit 0 並渲染每一個主題，`overview` 開頭
- [x] `--ai-context all --offline` 渲染全部五個且不探測
- [x] `docs --help` 在三個 locale 都列出每一個主題
- [x] 行程層 handshake 以四個新名稱仍然通過

**已落地。** 四個工具，沒有一個帶 topic。49 suites、792 個測試。

**這個里程碑存在，是因為擁有者問了「MCP 為什麼需要 topic？」而誠實的答案是它不需要。** 第一版把 CLI 的形狀照搬到 MCP，沒有先問產生那個形狀的約束是否仍然成立。它不成立：CLI 呼叫是一個行程、輸出要進稀缺的 prompt context，所以拿一個主題勝過拿五個 —— 但在 MCP 上連線是開著的，第二次呼叫幾乎免費，而且**選擇機制本來就存在**。topic enum 讓模型選兩次，而內層那次必須在它看到任何能提供判斷依據的東西**之前**做出。

而且一個 enum 同時在做三件不相關的事：`overview`／`compose`／`service` 是同一個意圖被拆成三份、`troubleshoot` 是不同意圖、而 `state` 與 `runestone_status` 重複。

體積這個反對意見是量測而不是辯論：`overview` 4.3 KB、`compose` 3.3 KB、`service` 5.0 KB，所以合併後的指南約 12 KB —— 而它取代的形狀是 4.3 KB 的索引、然後一次猜、然後 3.3 或 5.0 KB，猜錯就兩份都付。一次 12 KB 既比較便宜也比較簡單。

三個工具變成四個，而規格 11.2 別處正是反對這件事的。接受：四個命名清楚的工具，對模型來說比三個裡有一個帶六個值 enum 的更好選。

**`--ai-context all` 根本不存在，而我跟擁有者說它存在。** 被問到有哪些主題時，我照規格回答而不是照程式碼 —— 規格列了 `all`，而 `resolveTopic` 只查 manifest，所以它 exit 1。MCP 那側有。已在 CLI 實作，並照規格 5.1 陳述的順序，那個順序刻意不是 manifest 的順序：`overview` 開頭，因為在得到判斷依據之前先讀細節是顛倒的。MCP 的 `all` 隨 enum 一起消失，所以兩個介面不再需要就它達成一致。

**一個靠讀程式碼而不是靠測試抓到的分層 bug。** `all` 含線上主題，但 `findTopic('all')` 回傳 undefined，所以第一版實作會安靜地落到離線層，把 state 主題渲染成「沒去查」。`all` 現在明確是線上的。

**help 的主題列示就是最初的那個請求，而且它是從 manifest 推導的。** 那個選項描述寫著「可指定主題」卻從來沒說有哪些，所以唯一的查法是猜錯一次 —— 而這個里程碑正是這樣開始的。列示由 manifest 產生、標籤在地化，並標出預設與那兩個會查 Docker 的，所以新主題不需要有人記得去加就會出現。

**回收。** 單一 revert。`runestone_context` 回來、CLI 失去 `all`、help 失去主題列示。

## 證據紀錄

| 里程碑 | 內容 | 日期 | 證據 |
| --- | --- | --- | --- |
| A0 | 安裝路徑版圖讀自廠商文件 | 2026-09-07 | 規格 8.1,含 URL |
| A0 | `service` 欄位契約量測自 validator | 2026-09-07 | 規格 5.2 |
| A0 | `service.validation.urlNoPath` 沒有任何呼叫點 | 2026-09-07 | 規格 5.2 |
| A0 | Claude Code 不會載入這個 repository 的 `AGENTS.md` | 2026-09-07 | 規格 8.1 |
| A4 | 規格 14.4 端到端:在真實專案裡只給 agent `docs --ai-context` | 2026-09-08 | **由 repository 擁有者驗證。** 沒有留下 transcript,所以這一列記錄的是「檢查跑過且通過」,不是 agent 逐步做了什麼 |

## Repository 現況

- 分支是 `feat/skill-support`,從 `develop` 的 `ba67a7e` 切出,`main` 與 `origin/develop` 也在同一個位置。沒有繼承任何未合併的東西。
- `runestone-cli` 在 2.0.0,changelog 有一個未發佈區塊。面向 agent 的介面是三個指令:五個主題的 `docs --ai-context [topic]`、跨四個 target 的 `skill install | status | remove`,以及 `mcp serve | config`。**production 依賴維持 13 不變** —— MCP server 是手寫的,那正是 C1 的裁決換到的東西。
- 階段 A、B、C 功能上都完成,規格 14.4 的端到端檢查也已由 repository 擁有者跑過並通過。
- **沒有 CI。** 這份文件裡的每一條 gate 都是手動跑的。
- 發佈是手動的,順序固定:merge 到 `develop`、merge 到 `main`、再發佈到 npm。
- A0 期間發現並刻意留在這條分支之外的三個清理項目:三個 locale 表沒有自動化 key parity 測試、`service.validation.urlNoPath` 是孤兒 key,以及 `certs list` 與 `service list` 用 `String.length` 而不是既有的 CJK-aware helper 算欄寬。
