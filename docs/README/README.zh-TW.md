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
