# Runestone service command design planning

## Goal
規劃 Runestone CLI 的 `service` 管理功能，用於將外部或本機服務註冊到 Runestone Traefik routing，並將 service metadata 保存到 `~/.runestone/runestone.config.json`。

Implementation extension: implement the planned service management feature in `runestone-cli`.

## Success Criteria
- 定義 `runestone service add/list/remove/remove-group` 的產品行為。
- 定義 service metadata 的保存內容與更新規則。
- 定義 dynamic config 產物位置與刪除規則。
- 定義互動模式觸發條件與驗證需求。
- 列出需要產品決策的未定事項，不擅自假設。
- `runestone service` command tree is implemented and wired into CLI.
- Service metadata is stored in `runestone.config.json`.
- Service dynamic configs are created under `configuration/services`.
- Traefik API validations, certificate coverage checks, repair, and group commands are covered by tests.

## Current Context
- 目前 `~/.runestone/runestone.config.json` 保存 CLI 狀態，例如 `runestonePath` 與 `locale`。
- Traefik file provider 監看 `/configuration`。
- 憑證 dynamic config 已改為 `configuration/certs`。
- 本次新需求指定 service dynamic config 建立於 `configuration/services/<service-name>.service.yml`。

## Constraints
- 使用者要求若資訊或情境不足，需停止詢問，不可擅自假設。
- 本階段為設計規劃，不進行實作。
- 規格應維持產品/PM 規格口吻，避免內部實作細節。

## Risks
- `service` / `srevice` 命令拼字需確認，避免規格化錯誤命令。
- Traefik API 查重範圍未明確，可能影響既有 docker/file provider route 與 service。
- route domain 是否需自動補 host domain、是否需要憑證、是否允許已存在 certificate，尚未定義。
- 刪除 group 時是否需逐筆確認與錯誤回復策略尚未定義。
- `runestone.config.json` 與 dynamic config 檔案之間可能產生不同步狀態，需定義呈現與修復行為。

## Approval Required
- 需要使用者回答未定事項後，才能完成正式設計規格。

## Work Packets
- P1 現況盤點：已檢查 tool state、env loader、Traefik dynamic config 與目前 DESIGN.md 口吻。
- P2 需求拆解：整理 command、參數、驗證、儲存、刪除與列表需求。
- P3 開放問題：列出不可擅自假設的產品決策問題。
- P4 規格整合：等待使用者回覆後產出設計規劃。
- P5 Implementation discovery: inspect existing command/service/test patterns.
- P6 Implementation: add service repository, dynamic config generation, Traefik API checks, and commands.
- P7 Tests: add focused tests and run verification.

## Integration Policy
只將使用者明確確認的行為寫入正式設計規格；未確認事項保留為 open question。

## Verification
- 檢查規格是否覆蓋所有使用者提出的命令與選項。
- 檢查是否有把未確認情境寫成既定規格。
- 檢查用語是否維持產品設計規格書語氣。

## Reusable Artifacts
本 workflow 可作為後續 Runestone CLI 新 command 設計規劃模板。
