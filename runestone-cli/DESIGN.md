# Runestone CLI 設計規格書

## 1. 文件範圍

本規格書定義 Runestone CLI 的產品定位、功能範圍、使用流程、設定項目、操作介面、相容性需求與驗收標準。

本規格書聚焦產品需求與驗收範圍，不作開發技術決策。

## 2. 產品定位

Runestone CLI 是一個 npm global command line tool，用於建立與管理本機 Docker 開發閘道。

Runestone 提供一組共用的本機開發入口，使多個 Docker 專案可以透過同一套 HTTP / HTTPS 入口、Traefik routing、本地域名與本地可信任憑證進行開發測試。

Runestone CLI 的主要價值：

- 降低多專案本機開發時的 port 衝突。
- 讓本機專案可使用 HTTPS 與真實 hostname 測試。
- 提供一致的跨平台管理命令。
- 取代原本依賴 Makefile 的操作方式。
- 降低新機器或新團隊成員建立本機開發環境的成本。

## 3. 使用對象

主要使用對象：

- 同時開發多個 Docker 專案的工程師。
- 需要測試 HTTPS、cookie、OAuth redirect、webhook 或跨子網域行為的開發者。
- 需要在 Linux、macOS、Windows / WSL2 使用一致本機開發流程的團隊。

延伸使用情境：

- 使用 AI 輔助工具協助專案接入 Runestone。
- 檢查本機是否符合 Runestone 執行需求。

## 4. 核心概念

| 名稱 | 定義 |
| --- | --- |
| Runestone 開發環境 | Runestone 在本機建立的一組 Docker 開發資源，包含 reverse proxy、Mailpit、憑證、設定檔、network 與 SSH key volume。 |
| Runestone path | Runestone 保存設定與產物的位置，預設為 `~/.runestone`。 |
| Host domain | Runestone 產生服務網址的基礎網域，預設為 `local.developers-homelab.net`。 |
| Project prefix | Runestone 命名 Docker 資源時使用的前綴，預設為 `runestone`。 |
| Entrypoint | HTTP / HTTPS 對外入口名稱與 port，用於 Traefik routing。 |

## 5. 使用流程

### 5.1 安裝與初次啟動

```bash
npm install -g @developers-homelab/runestone-cli
runestone up
```

初次執行 `runestone up` 時，若尚未完成設定，系統需自動進入 setup flow。設定完成後，Runestone 開發環境需可直接啟動。

### 5.2 日常操作

| 情境 | 命令 | 結果 |
| --- | --- | --- |
| 啟動環境 | `runestone up` | 啟動 Runestone services，並顯示 Traefik / Mailpit URL。 |
| 查看狀態 | `runestone status` | 顯示 containers、SSH keys、network、volume 狀態。 |
| 暫停環境 | `runestone stop` | 停止 services，保留設定與資料。 |
| 關閉環境 | `runestone down` | 移除 services，可選擇清理 network、volume、image。 |
| 檢查主機 | `runestone doctor` | 檢查 Docker、Compose、憑證信任工具是否可用。 |

## 6. 功能需求

### 6.1 Setup

`runestone setup` 用於建立或修改 Runestone 設定。

Setup flow 需包含下列設定項：

- 顯示語言。
- Runestone path。
- Host domain。
- Project prefix。
- HTTP entrypoint name 與 port。
- HTTPS entrypoint name 與 port。
- Mailpit SMTP port。
- 是否安裝本地 CA 與預設憑證。

Setup flow 需符合下列行為：

- 可返回前一步。
- 可取消。
- 套用前需顯示設定摘要。
- 需檢查輸入的 port 是否可用。
- 使用非預設 host domain 時，需提供 DNS 指向本機的檢查。
- 若本機缺少必要工具，需提示使用者執行 `runestone doctor`。
- 修改既有設定且 Runestone 正在執行時，需詢問是否重新啟動。

### 6.2 開發環境管理

Runestone CLI 需支援啟動、停止、移除與狀態檢查。

| 功能 | 需求 |
| --- | --- |
| 啟動 | 尚未設定時自動進入 setup；確保必要設定、Docker network 與 SSH volume 存在；啟動 Runestone services。 |
| SSH key 注入 | 啟動時自動注入常見 SSH private keys；並提供手動新增方式。 |
| 停止 | 停止 services，保留設定、憑證、network 與 volume。 |
| 移除 | 移除 services；可由使用者選擇是否移除 network、volume、image。 |
| 狀態 | 顯示 containers、SSH keys、network、volume 的目前狀態。 |

### 6.3 憑證管理

Runestone CLI 需提供本地 HTTPS 憑證管理能力。

| 命令 | 需求 |
| --- | --- |
| `runestone certs install` | 安裝或重新安裝 Runestone root CA，使本機瀏覽器信任 Runestone 憑證。 |
| `runestone certs create <domain>` | 為 base domain 建立 wildcard certificate。例如輸入 `example.test` 時，管理 `*.example.test`。 |
| `runestone certs list` | 顯示 certificates 的狀態、SANs、issuer、到期日與剩餘有效時間。 |
| `runestone certs remove <domain>` | 移除指定 domain 的 certificate、private key 與 Traefik TLS 設定。 |

憑證管理規則：

- 使用者輸入 base domain，不輸入 wildcard domain。
- 憑證資料不完整時，系統需提示錯誤。
- 移除不存在的憑證時，系統需提示結果，但不視為嚴重錯誤。
- `runestone cert` 可作為 `runestone certs` 的 alias。

### 6.4 SSH Key 管理

Runestone CLI 需支援管理注入到 Runestone 開發環境的 SSH keys。

| 命令 | 需求 |
| --- | --- |
| `runestone keys ls` | 列出已注入的 SSH keys。 |
| `runestone keys add <path>` | 將指定 SSH private key 加入 Runestone 開發環境。 |

自動偵測的 key 名稱：

- `id_rsa`
- `id_ecdsa`
- `id_ed25519`
- `id_dsa`

若 private key 有對應 public key，需一併加入。

### 6.5 Doctor

`runestone doctor` 用於檢查本機是否符合 Runestone 執行需求。

檢查範圍：

- Docker 是否可用且版本符合需求。
- Docker Compose 是否可用。
- 作業系統是否具備本地憑證信任所需工具。

若缺失項目可由系統協助修復，需先詢問使用者。若無法協助修復，需提供明確的手動處理建議。

### 6.6 文件與 AI 整合輔助

`runestone docs` 用於提供文件入口。

`runestone docs --ai-context` 用於輸出專案接入 Runestone 所需的精簡資訊，內容需包含：

- Runestone Docker network name。
- Host domain suffix。
- HTTP / HTTPS entrypoint name。
- Traefik routing 所需資訊。
- 不修改 Runestone 自身設定的提醒。

若尚未完成 setup，需提示使用者先執行 `runestone setup`。

## 7. 命令範圍

Runestone CLI 需提供下列命令：

```text
runestone setup
runestone doctor
runestone docs
runestone docs --ai-context
runestone up
runestone up --force-recreate
runestone up --no-deps
runestone stop
runestone down
runestone down --remove-network
runestone down --remove-volumes
runestone down --purge
runestone status
runestone certs install
runestone certs create <domain>
runestone certs list
runestone certs list --no-header
runestone certs remove <domain>
runestone keys ls
runestone keys add <path>
```

需支援下列 aliases：

```text
runestone cert
runestone certs c <domain>
runestone certs i
runestone certs ls
runestone certs rm <domain>
runestone certs del <domain>
runestone keys list
```

## 8. 設定需求

Runestone 需保存下列設定：

- Runestone path。
- 顯示語言。
- Host domain。
- Project prefix。
- HTTP entrypoint name 與 port。
- HTTPS entrypoint name 與 port。
- Mailpit SMTP port。
- Runestone image 與 tag。
- 本地 CA 是否已安裝。

若必要設定不存在，系統需視為尚未完成 setup。

## 9. 使用體驗需求

Runestone CLI 需符合下列使用體驗：

- 訊息簡潔、明確、可執行。
- 錯誤訊息需包含問題與下一步。
- Help output 不顯示內部或測試用選項。
- 無額外 options 的 command，不顯示只有 help 的 options 區塊。
- 支援 English、繁體中文、日本語。
- 互動流程可取消，且取消後不影響 terminal 使用。

## 10. 相容性需求

支援平台：

- Linux。
- macOS。
- Windows 10/11 with WSL2。

最低需求：

- Node.js 18 或以上。
- Docker 29 或以上。
- Docker Compose V2。

## 11. 安全與資料保護

Runestone 會處理 SSH private keys 與本地 CA，因此需符合：

- 不在 terminal 顯示 SSH private keys。
- 不將 SSH private keys 傳出本機。
- 不覆蓋不符合預期的使用者自訂憑證設定。
- 安裝 local CA 前需讓使用者確認。
- 移除憑證時只移除 Runestone 管理的檔案。

## 12. 非目標

本版本不包含：

- GUI。
- 專案註冊管理。
- Plugin system。
- 自動修改其他專案的 Compose 檔。
- 自帶 Docker Engine。
- 遠端部署。
- 正式環境 reverse proxy 管理。
- 多使用者權限管理。

## 13. 驗收標準

交付成果需符合下列條件：

- 使用者可透過 npm 安裝並取得 `runestone` 命令。
- 第一次執行 `runestone up` 時，若尚未設定會自動進入 setup。
- setup 後可成功啟動 Runestone 開發環境。
- `status` 可顯示 containers、network、volume、SSH keys。
- `stop` 可停止 services 並保留資料。
- `down` 可移除 services，並可選擇清理 network、volume、image。
- certificate commands 可安裝 root CA、建立、列出與移除 domain certificates。
- SSH key commands 可加入與列出 keys。
- `doctor` 可檢查必要 host environment。
- `docs --ai-context` 可輸出專案接入所需資訊。
- 使用者不需要 Makefile，也不需要 clone repository，即可使用 Runestone。
