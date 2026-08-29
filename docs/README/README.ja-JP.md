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

### ホスト環境の確認

Runestone を使うには、ホストマシンに Docker、Docker Compose、プラットフォームに応じた証明書ツールが必要です。
setup の前に環境を確認できます。また、setup で不足ツールが報告された場合は、`runestone doctor` で対応可能な修復を案内できます。

```bash
runestone doctor
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

## コンテナ用 DNS (任意)

Runestone のドメインは `127.0.0.1` に解決され、コンテナの中ではそれはコンテナ自身です — つまりコンテナ同士がドメインで到達できません。任意の DNS 機能は、Runestone のドメインを知っているリゾルバをコンテナに与えることでこれを解決します。

既定では無効で、有効にすることは侵入的です。**Docker daemon 自身の設定**に項目を追加し、Docker の再起動が必要で、それはマシン上のすべてのコンテナを停止させます。その後、マシン上のすべてのコンテナの DNS が Runestone のコンテナを経由します。

有効にする前に完全な説明を読んでください — 何が変わるか、どう無効にするか、手動で項目を削除する方法: **[DNS ドキュメント](DNS.ja-JP.md)** ([English](DNS.md) | [繁體中文](DNS.zh-TW.md))。

ドメイン自体の解決方法 — Runestone ドメイン、`traefik.me` のアドレス復号、そしてこの機能が IPv4 のみである理由 — は **[DOMAINS.md](DOMAINS.md)** (英語、[繁體中文](DOMAINS.zh-TW.md)) にあります。

```bash
runestone dns enable --dry-run
```

実際の値を埋めて「何が変わるか」を正確に表示し、何も書き込みません。

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

## Service 管理

### Service の追加

Routed service を追加し、対応する Traefik の動的設定を作成します。
必須引数が不足している、または不正な場合、Runestone は対話モードで不足分を入力します。

```bash
runestone service add <service name> --route <domain> --url <url with port> --group <group name>
```

### Service 一覧

設定済みの routed services を表示します。

```bash
runestone service list
```

### Service の削除

Routed service を削除し、対応する Traefik の動的設定も削除します。

```bash
runestone service remove <service name>
```

## プロジェクト連携

AI agent に別のプロジェクトを Runestone へ接続させる場合は、Compose ファイルを編集する前に `runestone docs --ai-context` を呼び出すよう伝えてください。
このコマンドは、AI agent が必要とするローカルの Runestone network name、host domain、Traefik entrypoint names を出力します。

```bash
runestone docs --ai-context
```

プロンプト例:

```text
Runestone 環境で動作する traefik/whoami 用の compose.yml を作成してください。
Runestone の設定は `runestone docs --ai-context` を直接呼び出して確認してください。
```

```text
compose.override.yml を追加し、`app` service に Runestone 環境向けの Traefik labels と network 設定を追加してください。
Runestone の設定は `runestone docs --ai-context` を直接呼び出して確認してください。
```

生成される AI context は [runestone-cli/tool-docs/ai-prompt-context.tmp.md](../../runestone-cli/tool-docs/ai-prompt-context.tmp.md) からレンダリングされます。
生成された context を AI agent に共有する前に、この template を確認できます。

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
