# Runestone と AI エージェント

[English](AI-AGENTS.md) | [繁體中文](AI-AGENTS.zh-TW.md) | 日本語

Runestone は「このプロジェクトをどう接続するか」を AI コーディングエージェントに自分で説明できます。あなたが毎回説明する必要はありません。

対象は「プロジェクトの接続」だけです。Runestone が既にインストールされ設定済みであることを前提とし、エージェントにセットアップを行わせるものは何もありません。以下のコマンドは `runestone setup` を実行するまで何も出力しません。

## エージェントが得られるもの

自力では判断できない 2 つのことです。

**2 つの接続経路のどちらを使うか。** Docker 内で動くプロジェクトは Traefik のラベルで接続します。ホスト上の開発サーバー、既に起動しているプロセス、外部 URL は `runestone service add` で接続します。ここを間違えると静かに失敗します。コンテナのないプロジェクトに付けたラベルは効果がなく、file provider の項目が `localhost` を指していると、あなたのマシンではなく Runestone コンテナ自身に届きます。

**このマシンの事実。** どのホスト名が証明書でカバーされているか、そしてどの router 名と service 名が既に登録されているか。他のプロジェクトによる登録も含まれ、それはあなたのプロジェクトからは一切見えません。

## 3 つの使い方

### ガイダンスを出力する

```bash
runestone docs --ai-context
```

compose 向けの説明を出力します。他のトピックは引数で指定します:

```bash
runestone docs --ai-context service        # Docker 内ではない場合
runestone docs --ai-context state          # このマシンの現在の事実
runestone docs --ai-context troubleshoot   # 404、502、証明書の警告
runestone docs --ai-context overview       # 選び方と、実行してはいけないもの
```

どのトピックも末尾で他のトピックを一覧するので、引数なしで実行しただけのエージェントも残りを自分で見つけられます。

### プロジェクトに導入する

```bash
runestone skill install
```

エージェントツールが元々参照する場所にガイダンスを書き込むので、誰も貼り付ける必要がありません。プロジェクトが使っているツールを検出し、それらの分だけ書き込みます。

先にプレビューしてください。これはリポジトリに書き込みます:

```bash
runestone skill install --dry-run
```

`runestone skill status` は導入済みの内容と最新かどうかを表示します。`runestone skill remove` で取り除けます。

書き込み先:

| ツール | 場所 |
| --- | --- |
| Codex、Cursor、VS Code、および共通の場所を読むツール | `.agents/skills/runestone/` と `AGENTS.md` 内の一節 |
| Claude Code | `.claude/skills/runestone/` と `CLAUDE.md` 内の一節 |
| Cursor rules | `.cursor/rules/runestone.mdc` |
| GitHub Copilot | `.github/skills/runestone/` |

`.agents/skills/` は複数のツールが合意している共通の場所なので、1 回の書き込みで大半をカバーします。Claude Code は独自のパスを読むため、もう 1 部を受け取ります。

お使いのツールが表にない場合、あるいはパスが変わった場合は、自分で指定してください:

```bash
runestone skill install --skills-dir .mytool/skills --instructions-file MYTOOL.md
```

Runestone は自分が書いたものだけを所有します。既存のファイルには印を付けた一節を追加するだけで残りは書き換えず、変更前にバックアップを取り、あなたが後から編集したものには手を触れません。

### MCP サーバーとして接続する

```bash
runestone mcp config --client claude-code
```

クライアントの設定に貼り付けるブロックを出力します。`--client cursor` と `--client vscode` はそれぞれ正しい形を出力し、`--client` を省略すると 3 つとも出力します。Runestone は出力するだけで、クライアントの設定ファイルを自分で編集することはありません。

このサーバーは読み取り専用です。質問に答え、あなたが実行すべき正確なコマンドを返すだけで、何も変更しません。最も有用なツールは `runestone_check_name` で、エージェントが名前をファイルに書き込む前に、その名前とホスト名が使用可能かどうかを答えます。

Claude Code についての注意: プロジェクト単位の `.mcp.json` は、対話セッションで最初に使われるときに承認を求めます。最初は何も起きないように見えても、待っているのはその確認です。

## エージェントが行わないこと

ガイダンスはこれらを提案するだけにとどめ、実行はあなたに委ねるよう指示します。作業中のプロジェクトの範囲を超えて影響するためです:

| コマンド | 理由 |
| --- | --- |
| `runestone dns enable`、`runestone dns disable` | Docker デーモンを再起動し、マシン上のすべてのコンテナを停止します |
| `runestone certs install` | 権限昇格が必要で、システムの信頼ストアを変更します |
| `runestone setup` | すべてのプロジェクトが共有する設定を書き換えます |
| `runestone down` | 環境を削除し、フラグ次第でデータも削除します |
| `runestone up`、`runestone stop` | すべてのプロジェクトの実行状態を変更します |

プロジェクトの接続作業として `runestone service add`、`runestone service remove`、`runestone certs create` は実行しますし、何かを確認する必要があるときは `runestone status` のような読み取り専用コマンドも実行します。

## うまくいっていないように見えるとき

**コマンドが何も出力せずエラーで終了する。** Runestone がまだ設定されていません。`runestone setup` を実行してください。

**導入済みのガイダンスが古い。** Runestone を更新しても、既にリポジトリにあるファイルは書き換えられません。`runestone skill status` が報告し、`runestone skill install` が更新します。

**編集したファイルがそのまま残っている。** これは意図的です。Runestone はあなたの変更を上書きしません。`--force` で上書きでき、その場合もバックアップを残します。

**エージェントが提案したホスト名で証明書の警告が出る。** それをカバーする証明書がありません。`runestone certs create <base domain>` で解決します。カバー範囲は 1 階層だけで、`example.test` の証明書は `api.example.test` をカバーしますが `a.b.example.test` はカバーしません。

**ブラウザーでは動くのに別のコンテナからは動かない。** これは loopback の問題であり、設定ミスではありません。[DNS ドキュメント](DNS.ja-JP.md)を参照してください。
