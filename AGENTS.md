# Runestone Agent Guidelines

這份文件記錄維護 Runestone CLI 時必須遵守的設計原則。修改程式前先對照這份文件，不要只依賴對話記憶或直覺。

## Interactive Prompt Rules

- 可由使用者修正的輸入錯誤，必須回到同一個 prompt。
- 錯誤訊息放在同一個 prompt 的 description，不要用外部 warning 後再問下一題。
- 不可在最後寫入或建立憑證時才回報前面欄位可提前驗證的錯誤。
- `service add`、`service modify`、`service group move` 等入口都要符合相同互動規則；共用函式不代表測試可以省略入口覆蓋。
- 需要使用者從既有項目或自行輸入之間選擇時，必須放在同一個垂直 select。

## Regression Test Rules

- 每個欄位契約都要同時有正例與反例。
  - Route domain path 應拒絕。
  - Service URL path/query 應接受。
- 互動式修正流程要測實際 command 入口，不只測底層 helper。
- 新增或修改 prompt validation 時，至少掃描並評估：
  - `p.text`
  - `p.select`
  - `promptFor*`
  - `normalize*`
  - `validate*`
  - command tests

## Changelog Rules

- CHANGELOG 是給使用者看的 release note，不是實作紀錄。
- 不寫內部細節，例如 prompt frame、函式名稱、測試策略、重構方式。
- 只寫使用者會感受到的行為變更、修正與新功能。
- 條目要簡潔，可操作，可理解。
- 版本區塊使用既有格式：`## x.y.z - YYYY-MM-DD`，並按 `Added`、`Changed`、`Fixed` 分類。

## DNS Feature Rules

DNS 功能會改動機器的全域狀態（`daemon.json` 與重啟 Docker），因此規格與里程碑本身就是風險管控手段。動手前先讀 `docs/DNS-FEATURE-SPEC.md`（正體中文備查：`docs/DNS-FEATURE-SPEC.zh-TW.md`），進度與 gate 看 `docs/DNS-MILESTONES.md`。

### 開發用覆寫（spec 7.4）

- `RUNESTONE_DNS_DAEMON_PATH`：改寫 daemon 設定檔路徑，讓寫入／識別／撤銷可以對著暫存檔跑。
- `RUNESTONE_DNS_RESTART_CMD`：改寫重啟 Docker 的指令，例如改成重啟一個 dind container。
- 這兩個變數刻意不出現在 `.env` 與 `runestone setup`，不是使用者設定。它們的存在理由是：沒有它們，無法重啟 Docker 的接手者根本無法開發這個功能。
- 兩者本身就是風險——路徑填錯就是寫錯檔案——所以 `dns status` 與 `doctor` 在它們生效時必須明顯回報，風險揭露也必須印出實際生效的值。

### 生命週期接線的兩條規則（spec 10.4、11.2）

- **日常指令不重啟 Docker。** `up` 可能會寫 `daemon.json`（Target IP 輪替、自動重排），但寫完就停，並且必須說出「下次重啟 Docker 才生效」。重啟會終止機器上每一個 container，那不是 `up` 這種一天跑好幾次的指令該有的權力。重啟 *dns 服務* 是另一回事，可以。
- **`setup` 不寫 `DNS_ENABLE`。** 它只記錄 `DNS_UPSTREAM`、`DNS_DAEMON_FALLBACK`、`DNS_AUTO_REORDER` 三個設定，然後把使用者交給 `dns enable`。寫 `true` 等於在 daemon 設定空無一物時宣稱已啟用；寫 `false` 會讓已存在的項目變成孤兒。那個鍵屬於 `dns enable` 與 `dns disable`。

### 動到真實 daemon 設定檔之前的安全網（spec 16.5）

只要一個里程碑會寫入真實的 `daemon.json`（M5 起），先做完這四件事：

1. 把現在的 `daemon.json` 複製到版控之外並記下 hash。這是給人用的安全網，不是 Runestone 管理的備份；規格 9.3 禁止整檔還原這條沒有改變。

```bash
cp ~/.docker/daemon.json ~/daemon.json.pre-runestone-dns && sha256sum ~/daemon.json.pre-runestone-dns
```

2. 確認 M4 的 `runestone dns disable --assume-entry` 真的能撤掉一筆手動塞進去、沒有 ownership 紀錄的項目。
3. 手動走一次復原路徑：編輯 `daemon.json`、移除項目、重啟 Docker。
4. 進 M6b（會重啟機器上每一個 container）之前，另外存一份 `docker ps -a`。

```bash
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}' > ~/containers-before-dns-m6b.txt
```

寫入不等於生效：`daemon.json` 寫下去之後，直到 Docker 重啟才有作用。`--no-restart` 與 `--dry-run` 就是靠這一點把「寫」和「重啟」在時間上分開，這是整個計畫的核心槓桿，不要為了方便繞過它。

### Restart 範圍

- `composeService.restart()` 必須指定 service，不接受無範圍重啟。dynamic config 變更只重啟 `runestone`，DNS 設定變更只重啟 `dns`。
- Service 名稱一律取自 `COMPOSE_SERVICES`，不要寫字串常值。
