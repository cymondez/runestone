# Runestone

[English](../../README.md) | 繁體中文 | [日本語](README.ja-JP.md)

![logo](../../logos/runestone_icon_gray_large.png)

這個專案 fork 自 [druidfi/stonehenge 5.2](https://github.com/druidfi/stonehenge)。
主要的改變為將 Makefile 安裝/管理的方式，轉換成更容易跨平台的 npm tool 方式。
如果您喜歡這個專案，也請記得對原本概念發想的專案 [druidfi/stonehenge 5.2](https://github.com/druidfi/stonehenge) 給予星星支持。

## 簡介

1. 本地的專案（前端、後端均可）可以使用 `SSL 憑證` + `本地域名` 進行測試時，解決 localhost 的諸多問題。
2. 80、443 port 的複用，減少開啟多專案間的 port 衝突。
3. 省去為了使用 `本地域名` 而須修改 hosts 檔案的麻煩。

## 基本構成要素

- traefik: 作為反向代理，將請求導向對應的專案。
- mailpit: 作為 SMTP 測試工具，捕獲並顯示發送的郵件。
- npm tool: 用於管理和運行 Runestone 的命令行工具。
- @mkcert/node: 用於生成本地受信任的 SSL。

## 相依環境

- 最新版 Ubuntu LTS、安裝 WSL2 的 Windows 10/11。
- Docker 29.0+ with Docker Compose V2。
- Node.js 22.0+。

## 安裝與使用

### 安裝

```bash
npm install -g @developers-homelab/runestone-cli
```

這會安裝 2.x 版本線。1.2.x 仍持續提供 bug 修復，詳見[版本與支援](#版本與支援)。

### 檢查主機環境

Runestone 需要主機上有 Docker、Docker Compose 與平台對應的憑證工具。
您可以在 setup 前先檢查環境；如果 setup 提示缺少工具，也可以讓 `runestone doctor` 協助處理支援的修復項目。

```bash
runestone doctor
```

### 啟動

第一次啟動會進入初始化設定，之後要修改設定請使用 `runestone setup`。

```bash
runestone up
```

### 查看狀態

`runestone status` 第一行說 Runestone 現在能不能用，接著列出每個專案都能用的 Traefik 與 Mailpit 位址，最後列出需要處理的問題與修正指令。`--json` 以 JSON 印出同一份報告，給 script 與 AI agent 使用。

```bash
runestone status
```

### 停止 或 關閉

注意：如果開機前未停止，runestone 預設會隨開機啟動。

停止：

```bash
runestone stop
```

關閉（停止 + 移除容器）：

```bash
runestone down
```

## 容器用 DNS（選用）

Runestone 網域會解析到 `127.0.0.1`，而在容器裡那就是容器自己——所以容器之間無法用網域互相連到。選用的 DNS 功能解決這件事，方法是給容器一個認得你的 Runestone 網域的解析器。

它預設關閉，而開啟它是侵入性的：它會在 **Docker daemon 自己的設定**裡加入一筆項目，並且需要重啟 Docker，那會停掉這台機器上每一個容器。之後，這台機器上每一個容器的 DNS 都會經過一個 Runestone 容器。

啟用之前請先讀完整說明——它改動什麼、怎麼關掉、以及怎麼手動移除那筆項目：**[DNS 說明文件](DNS.zh-TW.md)**（[English](DNS.md) | [日本語](DNS.ja-JP.md)）。

domain 本身是怎麼解析的——Runestone domain、`traefik.me` 的位址解碼、以及這個功能為什麼只支援 IPv4——寫在 **[DOMAINS.zh-TW.md](DOMAINS.zh-TW.md)**（[English](DOMAINS.md)）。

```bash
runestone dns enable --dry-run
```

那會印出「會變成什麼樣」的精確內容，帶入你實際的數值，而且什麼都不寫。

## 憑證管理

### 憑證清單

顯示 `.runestone/certs` 資料夾內的憑證清單。

```bash
runestone certs list
```

### 加入憑證

將 `@mkcert/node` 生成的憑證加入 `.runestone/certs` 資料夾內，並且產生動態設定檔註冊進 Traefik。

```bash
runestone certs create <domain>
```

### 移除憑證

移除 `.runestone/certs` 資料夾內的憑證，並且刪除對應的動態設定檔。

```bash
runestone certs remove <domain>
```

## Service 管理

`runestone service` 是用來把不在 Docker 裡、又想用 Runestone 網址開的東西掛上去：host 上的 dev server、已經在跑的程式，或外部 URL。這些是你自己加上的路由，不是 Runestone 提供的服務；那些請看 `runestone status`。在 Docker 裡的專案改用 Traefik labels。

### 新增 Service

新增路由，並建立對應的 Traefik 動態設定檔。
當必要參數缺少或不合法時，Runestone 會進入互動模式補齊。

```bash
runestone service add <service name> --route <domain> --url <url with port> --group <group name>
```

### Service 清單

顯示用 `service add` 加上的路由。

```bash
runestone service list
```

### 移除 Service

移除路由，並刪除對應的 Traefik 動態設定檔。

```bash
runestone service remove <service name>
```

### 檢查名稱

確認一個名稱與 hostname 在這台機器的所有專案中是否還沒被用掉。不會改動任何東西。

```bash
runestone service check <service name> --route <domain>
```

## 共用資源

宣告這台機器上應該由各專案共用、不要各自再加的後端服務，例如同一個 Postgres 或 Redis。AI agent 會在指引中看到它們。Runestone 只負責記錄：不會啟動或檢查它們，資源也沒有密碼欄位。

```bash
runestone resource add <name> --kind <kind> --host <host:port> --container <host:port>
runestone resource list
```

## 專案整合

Runestone 可以自己把「怎麼把這個專案接上來」講給 AI coding agent 聽，你不必再解釋一次。

把指引安裝到你的 agent 工具本來就會讀的位置：

```bash
runestone skill install
```

它會偵測這個專案在用哪些工具，只寫那些。建議先用 `--dry-run` 看它會動到哪些路徑。`runestone skill status` 顯示裝了什麼，`runestone skill remove` 把它收回去。

或是把指引印出來自己貼：

```bash
runestone docs --ai-context
```

不加參數會印出完整指引：先說怎麼在兩種接入方式之間選擇，再列出兩種方式。要其中一部分就加參數 —— `state` 是這台機器的即時狀態，`troubleshoot` 用在路由不通時，`all` 一次全部；`runestone docs --help` 會列出所有主題。

或是把 Runestone 接成唯讀的 MCP server：

```bash
runestone mcp config --client claude
```

完整說明，包含 agent 不會替你執行哪些指令，在 **[AI agent 文件](../AI-AGENTS.zh-TW.md)**（[English](../AI-AGENTS.md) | [日本語](../AI-AGENTS.ja-JP.md)）。

## 版本與支援

| 版本線 | 狀態 | 支援範圍 |
| --- | --- | --- |
| 2.x | 目前版本線 | 新功能都在這裡 |
| 1.2.x | 1.x 的最後一個功能版本 | 僅 bug 修復，維護至 2026-11-30 |

**2.x 是目前的版本線**，`npm install -g @developers-homelab/runestone-cli` 安裝的就是它。

**1.2.0 是 1.x 版本線的最後一個功能版本。** 它只接受 bug 修復：不再新增指令、不再新增選項、不再變更行為。1.2.x 的維護於 **2026-11-30** 結束。

從 1.x 升級後，第一次 `up` 會重新產生你的 `compose.yml`，原檔會以 `.bak` 留在旁邊。若要在支援期間內留在 1.x 版本線：

```bash
npm install -g @developers-homelab/runestone-cli@1
```

## 詳細說明

```bash
runestone --help
```

## 待辦事項

- [ ] 實際測試 macOS (M1/M2/M3/M4/M5)。

## 參考

- [druidfi/stonehenge](https://github.com/druidfi/stonehenge)
- [axllent/mailpit](https://github.com/axllent/mailpit)
- [FiloSottile/mkcert](https://github.com/FiloSottile/mkcert)
- [traefik.io](https://traefik.io/)

## 授權

[MIT License](../../LICENSE)
