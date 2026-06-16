# Runestone

[English](../../README.md) | [繁體中文](README.zh-TW.md) | 日本語

![logo](../../logos/runestone_icon_gray_large.png)

このプロジェクトは [druidfi/stonehenge 5.2](https://github.com/druidfi/stonehenge) から fork したものです。
主な変更点は、Makefile によるインストールと管理を、よりクロスプラットフォームに対応した npm ツール方式へ置き換えたことです。
このプロジェクトを気に入っていただけたら、元のアイデアである [druidfi/stonehenge 5.2](https://github.com/druidfi/stonehenge) にもスターで応援してください。

## 概要

1. ローカルのフロントエンド、バックエンドプロジェクトを `SSL 証明書` と `ローカルドメイン` でテストでき、localhost にまつわる多くの問題を避けられます。
2. 80 番と 443 番ポートを再利用できるため、複数のローカルプロジェクト間でのポート競合を減らせます。
3. `ローカルドメイン` を使うために hosts ファイルを編集する手間を省けます。

## 基本構成

- traefik: リクエストを対応するプロジェクトへ転送するリバースプロキシ。
- mailpit: 送信されたメールを捕捉して表示する SMTP テストツール。
- npm tool: Runestone を管理、実行するためのコマンドラインツール。
- @mkcert/node: ローカルで信頼できる SSL 証明書を生成するツール。

## 必要環境

- 最新版 Ubuntu LTS、または WSL2 をインストールした Windows 10/11。
- Docker 29.0+ with Docker Compose V2。
- Node.js 22.0+。

## インストールと使い方

### インストール

```bash
npm install -g @developers-homelab/runestone-cli
```

### 起動

初回起動時は対話式セットアップが開始されます。後から設定を変更する場合は `runestone setup` を実行してください。

```bash
runestone up
```

### 停止または終了

注意: システムのシャットダウン前に Runestone を停止していない場合、次回ブート時に自動的に起動します。

停止:

```bash
runestone stop
```

終了（停止 + コンテナ削除）:

```bash
runestone down
```

## 証明書管理

### 証明書一覧

`.runestone/certs` フォルダー内の証明書一覧を表示します。

```bash
runestone certs list
```

### 証明書の追加

`@mkcert/node` で生成した証明書を `.runestone/certs` フォルダーへ追加し、Traefik の動的設定も作成します。

```bash
runestone certs create <domain>
```

### 証明書の削除

`.runestone/certs` フォルダー内の証明書を削除し、対応する動的設定も削除します。

```bash
runestone certs remove <domain>
```

## 詳細ヘルプ

```bash
runestone --help
```

## Todo

- [ ] macOS (M1/M2/M3/M4/M5) で実機テストする。

## 参考

- [druidfi/stonehenge](https://github.com/druidfi/stonehenge)
- [axllent/mailpit](https://github.com/axllent/mailpit)
- [FiloSottile/mkcert](https://github.com/FiloSottile/mkcert)
- [traefik.io](https://traefik.io/)

## ライセンス

[MIT License](../../LICENSE)
