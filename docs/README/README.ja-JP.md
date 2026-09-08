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

これは 2.x 系列をインストールします。1.2.x もバグ修正を受け取ります。詳細は[バージョンとサポート](#バージョンとサポート)を参照してください。

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

## プロジェクト統合

Runestone は「このプロジェクトをどう接続するか」を AI コーディングエージェントに自分で説明できます。あなたが毎回説明する必要はありません。

エージェントツールが元々参照する場所にガイダンスを導入します:

```bash
runestone skill install
```

プロジェクトが使っているツールを検出し、それらの分だけ書き込みます。まず `--dry-run` で対象となるパスを確認してください。`runestone skill status` は導入済みの内容を表示し、`runestone skill remove` で取り除けます。

あるいはガイダンスを出力して自分で貼り付けます:

```bash
runestone docs --ai-context
```

他のトピックは引数で指定します — `service`、`state`、`troubleshoot`、`overview`。どのトピックも末尾で他のトピックを一覧するので、引数なしで実行しただけのエージェントも残りを自分で見つけられます。

あるいは Runestone を読み取り専用の MCP サーバーとして接続します:

```bash
runestone mcp config --client claude
```

エージェントが代わりに実行しないコマンドを含む完全な説明は **[AI エージェント向けドキュメント](../AI-AGENTS.ja-JP.md)**（[English](../AI-AGENTS.md) | [繁體中文](../AI-AGENTS.zh-TW.md)）にあります。
## バージョンとサポート

| バージョンライン | 状態 | サポート範囲 |
| --- | --- | --- |
| 2.x | 現行 | 新機能はこちらに入ります |
| 1.2.x | 1.x 系列の最終機能リリース | バグ修正のみ、2026-11-30 まで |

**2.x が現行のバージョンラインです。** `npm install -g @developers-homelab/runestone-cli` でインストールされます。

**1.2.0 は 1.x 系列の最後の機能リリースでした。** バグ修正のみを受け取ります：新しいコマンド、新しいオプション、動作の変更はありません。1.2.x のサポートは **2026-11-30** に終了します。

1.x からアップグレードすると、最初の `up` で `compose.yml` が再生成され、元のファイルは `.bak` として隣に残ります。サポート期間中に 1.x 系列にとどまるには：

```bash
npm install -g @developers-homelab/runestone-cli@1
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
