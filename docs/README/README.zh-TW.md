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

Runestone 1.2.x 是 1.x 版本線的最後一個功能版本，詳見[版本與支援](#版本與支援)。

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

### 新增 Service

新增 routed service，並建立對應的 Traefik 動態設定檔。
當必要參數缺少或不合法時，Runestone 會進入互動模式補齊。

```bash
runestone service add <service name> --route <domain> --url <url with port> --group <group name>
```

### Service 清單

顯示已設定的 routed services。

```bash
runestone service list
```

### 移除 Service

移除 routed service，並刪除對應的 Traefik 動態設定檔。

```bash
runestone service remove <service name>
```

## 專案整合

當您要請 AI agent 將其他專案接入 Runestone 時，請告訴它在修改 Compose 檔案前先呼叫 `runestone docs --ai-context`。
這個指令會輸出 AI agent 需要的本機 Runestone network name、host domain 與 Traefik entrypoint names。

```bash
runestone docs --ai-context
```

範例 prompt：

```text
給我 traefik/whoami 且能在 Runestone 環境下運作的 compose.yml。
Runestone 設定方法請直接呼叫 `runestone docs --ai-context`。
```

```text
幫我加上 compose.override.yml，並替 `app` service 補上符合 Runestone 環境的 Traefik labels 與 network 設定。
Runestone 設定方法請直接呼叫 `runestone docs --ai-context`。
```

產生的 AI context 來自 [runestone-cli/tool-docs/ai-prompt-context.tmp.md](../../runestone-cli/tool-docs/ai-prompt-context.tmp.md)。
您可以在分享產生的 context 給 AI agent 前，先檢閱這個 template。

## 版本與支援

| 版本線 | 狀態 | 支援範圍 |
| --- | --- | --- |
| 1.2.x | 1.x 的最後一個功能版本 | 僅 bug 修復，維護至 2026-11-30 |
| 2.x | 開發中 | 發布後成為預設版本線 |

**1.2.0 是 1.x 版本線的最後一個功能版本。** 在此之後，1.2.x 只接受 bug 修復：不再新增指令、不再新增選項、不再變更行為。1.2.x 的維護於 **2026-11-30** 結束。

下一個主要版本 2.0.0 會變更既有安裝所依賴的行為，因此它是新的主要版本線，而不是 1.x 的更新。

2.0.0 發布後，`npm install -g @developers-homelab/runestone-cli` 會安裝 2.x。若要在支援期間內留在 1.x 版本線：

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
