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
- `dns status` 警告 DNS UI 沒有驗證，但 `status` 的 problems 與 `state` 的「Nothing to flag」都沒提。
- 專案的服務加入共用的 Runestone 網路後，它的 Compose 服務名稱（例如 `api`）會在所有專案共用的網路上成為別名；若別的專案也在那個網路上放了同名的 `db`，名稱解析可能撞到。
- 不帶參數的 guide 約 20 KB：footer 印三次、可用 hostname 與已佔用名稱兩個區塊各印兩次。
- troubleshoot 主題結尾的「Container state was not checked.」讀起來像失敗，其實只是該主題不查容器。
- `host.docker.internal` 在 Runestone DNS 開啟時解析不到（見上表）的成因與是否該由 DNS 功能處理，已另開任務調查。
