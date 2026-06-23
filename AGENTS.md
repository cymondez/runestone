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
