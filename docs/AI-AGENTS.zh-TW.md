# Runestone 與 AI Agent

[English](AI-AGENTS.md) | 繁體中文 | [日本語](AI-AGENTS.ja-JP.md)

Runestone 可以自己把「怎麼把這個專案接上來」講給 AI coding agent 聽，你不必再解釋一次。

這件事只涵蓋「把專案接上」。它預設 Runestone 已經安裝並設定完成；這裡沒有任何一項要 agent 去做安裝或設定，而下面的指令在 `runestone setup` 跑過之前不會產出任何東西。

## agent 會拿到什麼

兩件它自己推不出來的事。

**兩條接入路徑該走哪一條。** 跑在 Docker 裡的專案用 Traefik labels 接。跑在 host 上的 dev server、已經在跑的行程、或外部 URL，要用 `runestone service add` 接。選錯會安靜地失敗：沒有容器的專案掛 labels 完全無效，而 file provider 的項目指向 `localhost` 時會連到 Runestone 容器自己，不是你的機器。

**這台機器的事實。** 哪些 hostname 有憑證覆蓋，以及哪些 router 與 service 名稱已經被註冊 —— 包含被其他專案註冊的，那在你的專案裡完全看不到。

## 三種用法

### 直接印出指引

```bash
runestone docs --ai-context
```

印出 compose 簡報。要其他主題就加參數：

```bash
runestone docs --ai-context service        # 不在 Docker 裡
runestone docs --ai-context state          # 這台機器的即時事實
runestone docs --ai-context troubleshoot   # 404、502、憑證警告
runestone docs --ai-context overview       # 怎麼選，以及不該執行什麼
```

每個主題結尾都會列出其他主題，所以只跑了無參數版本的 agent 會自己找到其餘的。

### 安裝進專案

```bash
runestone skill install
```

把指引寫到你的 agent 工具本來就會讀的位置，不需要任何人手動貼。它會偵測這個專案在用哪些工具，只寫那些。

先預覽 —— 這會寫進你的 repository：

```bash
runestone skill install --dry-run
```

`runestone skill status` 顯示裝了什麼、是不是最新的。`runestone skill remove` 把它收回去。

寫到哪裡：

| 工具 | 位置 |
| --- | --- |
| Codex、Cursor、VS Code，以及任何讀共通位置的工具 | `.agents/skills/runestone/` 與 `AGENTS.md` 裡的一段 |
| Claude Code | `.claude/skills/runestone/` 與 `CLAUDE.md` 裡的一段 |
| Cursor rules | `.cursor/rules/runestone.mdc` |
| GitHub Copilot | `.github/skills/runestone/` |

`.agents/skills/` 是好幾個工具都同意的共通位置，所以寫一次就涵蓋大部分。Claude Code 讀的是它自己的路徑，所以它會多拿一份。

如果你的工具不在表上，或它的路徑搬家了，自己指定：

```bash
runestone skill install --skills-dir .mytool/skills --instructions-file MYTOOL.md
```

Runestone 只擁有它自己寫的東西。它會在你既有的檔案裡加一段有標記的區塊、絕不重寫其餘部分，改動前會先備份，而且你事後改過的東西它不會動。

### 接成 MCP server

```bash
runestone mcp config --client claude
```

印出你的 client 需要的東西。支援 `claude`、`codex`、`copilot`、`cursor`、`vscode`、`gemini`、`windsurf`、`zed`；不給 `--client` 就全部印出。注意 `vscode` 與 `copilot` 是兩個不同的工具、讀不同的檔案 —— VS Code 自己的文件寫明 Agent Host 不會讀 `.vscode/mcp.json`。Runestone 只印，不會自己去改你 client 的設定檔。

各家的形狀不能互換，這正是這個指令存在的理由。Codex 用的是 TOML 不是 JSON。VS Code 的 key 是 `servers`、Zed 是 `context_servers`，其餘才是 `mcpServers`。如果某個 client 有自己的註冊指令（`claude mcp add`、`codex mcp add`），也會一併印出來 —— 因為你執行的指令不會被貼錯檔案。

這個 server 是唯讀的。它回答問題、回傳該由你執行的確切指令，不會改動任何東西。最有用的工具是 `runestone_check_name`，在你的 agent 把名稱寫進檔案之前，先告訴它那個名稱與 hostname 有沒有被佔用。

**你不會自己啟動它，也不用停它。** 它跟 `runestone up` 不同，不是常駐服務。你的 client 會在 session 開始時把它叫起來、在 session 結束時關掉，所以沒有東西需要你去停，事後也不會有殘留的行程。

如果你在終端機裡跑它想看看，它會停在那裡等輸入。那看起來像當掉，其實不是：它是一個沒有人在跟它講話的 server。按 Ctrl+D 關掉它的輸入，它會乾淨地結束；或按 Ctrl+C 直接停掉。手動跑只有在快速確認時才有意義：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | runestone mcp serve
```

Claude Code 使用者注意：專案層級的 `.mcp.json` 在互動式 session 裡第一次被使用時會請你核准。如果一開始看起來沒反應，你在等的就是那個提示。

## agent 不會做的事

指引會告訴 agent 把這些提出來、交給你執行，因為它們影響的範圍超出它正在處理的專案：

| 指令 | 為什麼 |
| --- | --- |
| `runestone dns enable`、`runestone dns disable` | 會重啟 Docker daemon，等於停掉機器上每一個容器 |
| `runestone certs install` | 需要提權，而且會改動系統信任存放區 |
| `runestone setup` | 會重寫所有專案共用的設定 |
| `runestone down` | 移除環境，加上旗標連資料一起 |
| `runestone up`、`runestone stop` | 改變所有專案的執行狀態 |

它會在接專案的過程中執行 `runestone service add`、`runestone service remove` 與 `runestone certs create`，也會在需要查東西時執行 `runestone status` 之類的唯讀指令。

## 看起來不對的時候

**指令什麼都沒印而且回報錯誤。** Runestone 還沒設定完成。跑 `runestone setup`。

**裝好的指引過期了。** 升級 Runestone 不會去改寫已經在你 repository 裡的檔案。`runestone skill status` 會回報，`runestone skill install` 會更新它。

**你改過的檔案被跳過了。** 那是刻意的。Runestone 不會覆寫你做的修改；`--force` 可以強制，而且會留一份備份。

**agent 給的 hostname 會跳憑證警告。** 沒有憑證覆蓋它。`runestone certs create <base domain>` 可以解決，而且覆蓋只有一層 —— `example.test` 的憑證涵蓋 `api.example.test`，但不涵蓋 `a.b.example.test`。

**瀏覽器可以，但另一個容器不行。** 那是 loopback 問題，不是設定錯誤。看 [DNS 文件](DNS.zh-TW.md)。
