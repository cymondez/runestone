# Agent 第一次接觸 Runestone：只讀探測前後對照

*English: [agent-first-contact.md](agent-first-contact.md)*

**日期。** 2026-10-14 · **分支。** `feat/agent-first-contact`（改前 `4a677b5`＝2.1.0；改後 `bf1fab4`，收尾修正 `a118051`）· **機器。** Windows 11、Docker Desktop、Runestone DNS 開啟

這份文件是規格 14.4 一直缺的那種證據：給 agent 只有 CLI 與一個假想專案，記錄它實際怎麼做，而不是推論它會怎麼做。

## 方法

三個不帶任何假設的只讀 agent，各自只知道「這台機器上有 `runestone` 指令」與一個假想專案；只准跑唯讀指令，寫檔或改狀態前必須停下來寫出會做什麼。沒有告訴它們 Runestone 是什麼，也沒有告訴它們這次改了什麼。

| 情境 | 入口 | 專案 |
| --- | --- | --- |
| 冷啟動 × host | 只有 `runestone --help` | `shop-web`：`vite --port 5173`，沒有任何 Docker 檔案 |
| skill × Docker | runtime 已載入 SKILL.md | `inventory-api`：`api`（`"8080:3000"`）與 `db`，沒有 override |
| 冷啟動 × Docker | 只有 `runestone --help` | 同上 |

**兩輪的條件差異，照實記錄。** 重跑時：允許不帶旗標的 `runestone docs`（第一輪禁止，因為它會在非終端機下崩潰）；`runestone doctor` 從允許清單移除（第一輪允許，但它不是唯讀）；每個 agent 先讀一份只描述共用環境的交接檔。skill 情境用的是當時的 SKILL.md 原文，兩輪內容不同，那正是被比較的對象。

**這份證據的限制。** 每個情境各跑一次，LLM 有隨機性；探測 agent 與作者是同一個模型家族；專案是假想的，沒有任何東西真的被接上。它能說明的是「照著工具給的文字，agent 會做什麼」，不能說明成功率。

## 結果

| 情境 | 指令數（前 → 後） | 路徑 | 差點做錯（前） | 差點做錯（後） |
| --- | --- | --- | --- | --- |
| 冷啟動 × host | 23 → 14 | 前：對，自述是運氣（先看了 `docs --help`）。後：直接走對 | 裸預設叫它「create compose.yml」；驗證不打請求，Vite 拒絕頁會被報成成功 | 無；它提前加了 Vite `allowedHosts` |
| skill × Docker | 13 → 3 | 兩輪都對 | 照字面接 network 會斷掉 `db`；用狀態碼驗證會在壞設定上通過 | 無；範本自帶 `- default`，驗證改看頁面內容 |
| 冷啟動 × Docker | 10 → 5 | 兩輪都對 | 同上兩點；「本來會先跑裸 `runestone docs`」（會崩潰） | 無；根層 help 直接指向 `docs --ai-context` |

兩輪都沒有任何一個 agent 嘗試執行禁止的指令，也沒有任何一個想自己裝 Traefik 或 Mailpit。第一輪三個都要自己決定 hostname 再列為「要問使用者」；第二輪三個都自己選定並在回報中說明。

## 實作期間的一次性實測

這些是寫進語料之前查證的事實，屬於相依套件與部署設定的前提，不寫成本專案的測試。

| 主張 | 做法 | 結果 |
| --- | --- | --- |
| override 列了 `networks:` 就會丟掉隱含的 `default` | `docker compose config`，三份檔案：只有基底（對照）、只列 runestone、兩個都列 | 基底 `default`；只列 runestone → 只剩 `runestone`；兩個都列 → 兩個都在，`db` 不受影響 |
| 掛在 Runestone 網路上的容器可用 `runestone:1025` 寄信 | 以 Runestone 映像起 `--rm` 暫時容器，送 `EHLO` | Mailpit 回 220；擴充只有 SIZE、ENHANCEDSTATUSCODES、SMTPUTF8，沒有 AUTH、沒有 STARTTLS。負向對照：連 1026 失敗 |
| host 上用 `localhost:1025` | Node 直接連線 | Mailpit 回 220 |
| 一般容器能解析 `host.docker.internal` | 預設 bridge、Runestone 網路、另一個自建網路各一個暫時容器 | **三者都是 NXDOMAIN**；加 `--add-host host.docker.internal:host-gateway` 後連得到。只換一個變數：`--dns 192.168.65.7` 時可以解析，預設 resolver 是 daemon.json 的 `192.168.65.254`、`1.1.1.1`。語料因此一律附上 `extra_hosts` 那一行 |
| HTTP 會轉 HTTPS | `curl` 一個沒有路由的 hostname | 301 → `https://…` |
| 沒有路由的 hostname 不是 404 | `curl --ssl-no-revoke` 同一個 hostname | 200，`<title>Service not found!</title>` |
| Windows 的 curl 對本機憑證失敗 | Git Bash 的 curl 與 `curl.exe`（皆 8.21.0、Schannel） | 兩者都是 `CRYPT_E_NO_REVOCATION_CHECK`；加 `--ssl-no-revoke` 後 Traefik dashboard 回 302 |
| Vite／webpack-dev-server 的 Host 檢查 | 讀官方文件 | Vite `server.allowedHosts` 預設只允許 localhost、`.localhost` 與 IP；webpack-dev-server `allowedHosts: 'auto'` 只允許 localhost、自己的 host 與 websocket hostname。兩份文件都沒寫被拒絕時的狀態碼，所以語料只描述訊息 |
| `runestone docs` 在非終端機下崩潰 | `node bin/runestone docs < /dev/null` 與開著的 pipe | 改前 `ERR_TTY_INIT_FAILED` 堆疊；改後印出 README 網址與「AI agent 請跑 `--ai-context`」，exit 0 |

## 重跑之後仍然開著的缺口

收尾 commit `a118051` 已處理：footer 沒列 `guide` 與 `all`、三個主題對 hostname 來源說法不一、「不要停下來問」與「commit 前要問」的先後、Vite `allowedHosts` 放得太晚。以下是新範圍，沒有在這條支線處理：

- 語料與 `status` 都沒說 host 端怎麼解析 Runestone 網域（實測是公共 DNS 回 127.0.0.1），也沒有「CA 是否已被 host 信任」的事實；三個探測都另外用 `nslookup` 或 `curl` 自己查。
- ~~`dns status` 警告 DNS UI 沒有驗證，但 `status` 的 problems 與 `state` 的「Nothing to flag」都沒提。~~ 已在 `e2c5e95` 修正。
- 專案的服務加入共用的 Runestone 網路後，它的 Compose 服務名稱（例如 `api`）會在所有專案共用的網路上成為別名；若別的專案也在那個網路上放了同名的 `db`，名稱解析可能撞到。
- ~~不帶參數的 guide 約 20 KB：footer 印三次、可用 hostname 與已佔用名稱兩個區塊各印兩次。~~ 已在 `e2c5e95` 修正：`--offline` 下 guide 從 21,924 降到 19,770 bytes，`all` 從 31,249 降到 26,786。剩下的是內容，不是重複。
- ~~troubleshoot 主題結尾的「Container state was not checked.」讀起來像失敗，其實只是該主題不查容器。~~ 已在 `e2c5e95` 修正。
- `host.docker.internal` 在 Runestone DNS 開啟時解析不到（見上表）的成因與是否該由 DNS 功能處理，已另開任務調查。

## 後續實測（2026-10-14，`e2c5e95` 之後）

有三個缺口要先實測才能決定要不要改。以下都還沒有實作。

| 問題 | 做法 | 結果 |
| --- | --- | --- |
| host 怎麼解析 Runestone 網域？ | 在 host 上用 Node 的 `dns.lookup`（走 getaddrinfo，會讀 hosts 檔） | `traefik.local.developers-homelab.net`、它底下沒有路由的名稱、`mysite.traefik.me` 都是 127.0.0.1（2、15、334 ms）。不存在的網域 15 ms 回 `ENOTFOUND` |
| host 解析不到時 `status` 怎麼說？ | 用現有的 Traefik 探測打一個解析不到的名稱 | 失敗訊息是 `getaddrinfo ENOTFOUND`，所以 `status` 會報，但歸在「Traefik API 沒有回應」底下，給的修法（開 dashboard、`up --force-recreate`）對 DNS 失敗是錯的 |
| CLI 能不能判斷 host 是否信任 Runestone 的 CA？ | `tls.getCACertificates('system')`（Node 22.22.3 有）與 `~/.runestone/certs/rootCA.pem` 比對 SHA-256 指紋 | 在系統信任庫裡：true。對照組 Node 內建清單：false。讀系統信任庫花 0.5 ms，不需要 Docker 也不需要 Traefik |
| 這個答案和 TLS client 看到的一致嗎？ | 對 Traefik dashboard 發 `https.get`，`rejectUnauthorized: true`，`ca` 先設為系統信任庫，再設為內建清單 | 系統信任庫：HTTP 200。對照組內建清單：`UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| 同時在兩個網路上的服務，解析兄弟服務名稱時會不會拿到別的專案的容器？ | 只用暫時網路與 `--rm` 容器，不碰真的共用網路：專案網路上有自己的 `db`，共用網路上有別的專案的 `db`，`api` 兩個都接；每種情況 `dig db @127.0.0.11` 十次 | 對照組（`api` 只接自己的網路）：永遠是自己的 `db`。兩個都接、兩組都讓共用網路先建立：**共用網路名稱排序在前時，十次全部回別的專案的 `db`；排在後面時，十次全部回自己的**。接上的順序不影響結果，網路 ID 的順序也不影響。libc（`getent`）與 `dig` 一致 |

最後一列的意義，以及它沒有證明的事：

- 真的共用網路是 `runestone-network`，Compose 專案的網路是 `<project>_default`。專案名稱排在 `runestone-network` 之後（例如 s 到 z 開頭）時，一個同時存在於共用網路上的名稱會解析到別的專案的容器。這台機器上的 `vllm_default` 與三個 `webhub-*` 網路就屬於這種。
- Compose 會把每個服務自己的名稱註冊成它所接上每個網路的別名，所以共用網路上的名稱就是其他專案對外接上的服務名：`api`、`web`、`app`、`frontend`。資料庫很少在其中。實際會發生的失敗是：對外接上的前端呼叫 `http://api:...`，結果打到別的專案的 `api`。
- 只在一台機器、一個 Docker Desktop 版本上量過。排序是 Docker 的實作，不是文件承諾的契約，所以指引應該說要檢查什麼，而不是承諾某個順序。
