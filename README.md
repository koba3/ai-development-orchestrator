# AI Development Orchestrator

Slack の開発依頼を Notion のタスクにし、`READY` のタスクはホスト上の Claude Code CLI が Git worktree で実装する。

```
Slack
  → Orchestrator
  → LLM（依頼の分解だけ）
  → Notion Task
  → Scheduler
  → Git worktree
  → Claude Code CLI
  → Git commit
  → Notion を DONE に更新
```

状態の真実は Notion の Status だけです。Phase 1 の LLM は要求をタスクに分解します。Phase 2 のコード実装は LLM API を呼ばず、ローカルの `claude` コマンドが行います。commit は Orchestrator が行います。GitHub Pull Request はまだ作りません。

## いま動くこと

Slack の人間メッセージを受けると、次を行います。

1. 依頼文からトークンらしき文字列を除く
2. LLM に JSON Schema 付きで計画させる
3. Zod で検証する。モデルが人間確認を求めた場合、確信度が閾値未満の場合、秘密情報が含まれていた場合、migration・本番 DB・本番デプロイ・課金・契約変更・secrets 変更・breaking change が依頼文に含まれる場合は `NEEDS_HUMAN`、それ以外は `READY` にする
4. Notion にタスクを作る
5. スレッドに Task ID、要約、Notion URL を返す

同じ Slack メッセージの再配送では、タスクを二重作成しません。計画や Notion 作成の失敗は、その依頼だけ失敗通知にしてプロセスは継続します。

## まだ作っていないこと

| Phase | 内容 |
| --- | --- |
| 3 | GitHub Pull Request、実装開始と完了の Slack 通知 |
| 4 | 人間の回答による再開、retry、Review Agent |

Phase 2 は失敗したタスクを `FAILED` のまま止めます。自動 retry はしません。

## 責務

| 場所 | 役割 |
| --- | --- |
| `src/slack` | 人間のメッセージ受信と投稿 |
| `src/orchestrator` | 依頼の受付、計画、人間確認の判定 |
| `src/llm` | OpenAI / Anthropic。依頼の分解だけ |
| `src/notion` | Task DB への読み書き |
| `src/tasks` | Task ID の採番と状態遷移 |
| `src/scheduler` | `READY` タスクの取得と実行 |
| `src/git` | worktree 作成と commit |
| `src/agents` | ローカル Claude Code CLI の起動 |
| `src/notifications` | 人間向け文面 |
| `src/health` | Docker 用の `/health` |

## 前提

- Node.js 22 以上
- Slack App（Socket Mode）
- Notion Integration と、タスクを置く親ページ
- OpenAI または Anthropic の API キー

## 設定

```bash
cp .env.example .env
npm install
```

`.env` にトークンを書きます。このファイルは Git に含めません。

### Slack

1. [Slack App](https://api.slack.com/apps) を作る
2. Socket Mode を有効にする
3. App-Level Token に `connections:write` を付け、`SLACK_APP_TOKEN` に入れる
4. Bot Token Scopes に `chat:write`、`channels:history`、`groups:history`、`im:history`、`mpim:history` を付ける
5. Event Subscriptions で `message.channels`、`message.groups`、`message.im` を購読する
6. ワークスペースへインストールし、`SLACK_BOT_TOKEN` と Signing Secret を入れる
7. 依頼を書くチャンネルにボットを招待する

`SLACK_CHANNEL_IDS` が空なら、ボットが見ている会話の人間メッセージをすべて依頼として扱います。限定するときは `C0123,C0456` のように書きます。

### Notion

1. [Notion Integration](https://www.notion.so/my-integrations) を作り、`NOTION_TOKEN` に入れる
2. タスクデータベースの親にするページを Integration に共有する
3. そのページ ID を `NOTION_PARENT_PAGE_ID` に入れる
4. データベースを作る

```bash
npm run notion:setup
```

表示された ID を `NOTION_TASK_DATABASE_ID` に入れます。データベースには Title、TaskId、Description、Status、Priority、AgentType、Repository、Branch、Worktree、PullRequestUrl、Result、Error、CreatedAt、UpdatedAt、RetryCount に加え、依頼の追跡用の RequestId、Summary、SlackChannel、SlackThreadTs、SourceMessageTs、HumanQuestion、Confidence、WorkspaceId、Hashtag、ProjectId、ProjectName、RepositoryMode、LocalRepository、RemoteRepository があります。

すでに作ったデータベースには、新しい項目を同じ名前で追加してください。`npm run notion:setup` は新しいデータベースを作るだけで、既存のデータベースは更新しません。項目が無いページは空文字として読めます。

Status は `RECEIVED`、`PLANNING`、`READY`、`ASSIGNED`、`CODING`、`TESTING`、`REVIEWING`、`NEEDS_HUMAN`、`NEEDS_CHANGES`、`READY_TO_MERGE`、`DONE`、`FAILED` です。Phase 1 が書くのは `READY` と `NEEDS_HUMAN` だけです。

### LLM

`LLM_PROVIDER=openai` なら `OPENAI_API_KEY`、`anthropic` なら `ANTHROPIC_API_KEY` が必要です。モデル名は `OPENAI_MODEL` と `ANTHROPIC_MODEL` で変えます。

`DEFAULT_REPOSITORY` は、プロジェクト設定が無い古い経路でのみ使います。通常の Slack 受付は `config/projects.json` のリポジトリを使います。

`PLAN_CONFIDENCE_THRESHOLD` 未満の確信度は `NEEDS_HUMAN` になります。既定は `0.6` です。

## 起動

```bash
npm run dev
```

Docker Compose で起動する場合:

```bash
docker compose up --build
```

`GET http://127.0.0.1:3000/health` が `{"ok":true}` を返します。postgres と redis は Compose に含めていません。Docker 内では `SCHEDULER_ENABLED=false` です。Claude Code、Git、worktree はホストの `npm run dev` で動かします。

## Phase 2

Phase 2 はホストの Node.js プロセスで動かします。コンテナからは Claude Code を起動しません。

### Claude Code

この開発環境では Claude Code `2.1.287` が `claude` として入っていました。未導入のマシンでは、公式の手順で Claude Code CLI を入れてから、次で非対話実行ができることを確認します。

```bash
claude --version
claude --help
```

`claude --help` に `-p, --print` と `--permission-mode` があることを確認します。このリポジトリは CLI をインストールしません。

Runner が使うオプションは help で確認したものだけです。

- `-p` と `--output-format text` で非対話実行する
- `--permission-mode acceptEdits` でファイル編集を許可する
- `--permission-prompts none` でそれ以外の確認は拒否する
- `--disallowed-tools` で `git push`、`git commit`、`ssh`、`scp` を拒否する

`bypassPermissions` は使いません。プロンプトでも、push、deploy、secrets、API key、SSH 鍵、本番 DB 操作を禁止しています。commit は Claude Code ではなく Orchestrator が行います。

### 設定

`.env` に次を追加します。パスは自分の環境に合わせて変えます。

```bash
CODING_AGENT=claude
CLAUDE_COMMAND=claude
WORKTREE_ROOT=/Users/koba/worktrees
SCHEDULER_INTERVAL_MS=5000
SCHEDULER_ENABLED=true
```

`WORKTREE_ROOT` が空だと Scheduler は起動しません。Slack の受付は続きます。Git の `user.name` と `user.email` が未設定だと commit に失敗し、タスクは `FAILED` になります。

### 起動

```bash
npm run dev
```

Scheduler は 5 秒ごとに Notion の `READY` を見ます。同じタスクは、取得直後に `ASSIGNED` へ変え、プロセス内でも実行中として覚えるので、重なって起動しません。

### READY タスクの確認

Notion に次のようなタスクを 1 件作り、Status を `READY` にします。Repository は実在する Git リポジトリの絶対パスにします。

| 項目 | 例 |
| --- | --- |
| Title | QuestoonのREADMEにテスト用の説明を追加 |
| Description | README.mdに「AI Orchestrator Test」というセクションを追加してください。 |
| AgentType | backend |
| Repository | /Users/koba/projects/questoon |
| Status | READY |

Scheduler が拾うと、状態は `READY` → `ASSIGNED` → `CODING` → `DONE` と変わります。Project ID があるタスクの worktree は `${WORKTREE_ROOT}/{projectId}/TASK-xxx`、無い古いタスクは `${WORKTREE_ROOT}/TASK-xxx` です。ブランチは `feature/TASK-xxx` です。実行するリポジトリは `config/projects.json` の `localPath` です。Notion の Repository 欄や依頼文のパスでは決めません。変更があればその worktree に commit され、Result に Claude Code の報告と commit が入ります。変更がなければ commit せず `DONE` にします。リポジトリ不在、worktree 失敗、Claude Code の終了コードが 0 以外、Git 操作の失敗は、そのタスクだけ `FAILED` にし、Error に理由を残します。プロセスは止まりません。

途中でプロセスが落ちて `CODING` のまま残ったタスクは、手動で `READY` に戻すまで再実行しません。

GitHub Pull Request は Phase 3 で作ります。

## プロジェクトの振り分け

Slack の依頼は、LLM にプロジェクトを推測させません。`config/projects.json` が Workspace、Channel、Hashtag、Project、Repository を決めます。

```bash
cp config/projects.example.json config/projects.json
```

`id` には Slack の workspace ID（`T` で始まる）と channel ID（`C` で始まる）を入れます。同じ `#backend` でも、workspace と channel が違えば別プロジェクトです。Hashtag の大文字小文字は区別しません。登録済みの Hashtag が複数ある依頼は保留し、未登録の Hashtag は無視します。Hashtag が無く、channel に `defaultProject` も無いときは保留します。

```text
#questoon ログイン画面にGoogle認証を追加して
```

解決できるとスレッドに `Project: Questoon` と Task ID が返ります。解決できないときは `対象プロジェクトを指定してください。` と返します。

`npm run simulate` は `SIMULATE_WORKSPACE_ID` と `SIMULATE_CHANNEL_ID` を使い、依頼文に Hashtag が必要です。

## Phase 1 の確認

ボットを招待したチャンネルに、設定した Hashtag を付けて投稿します。

```text
#questoon Questoonに顧客CSV出力を追加して
```

スレッドに Task ID が返り、Notion に `READY` のタスクができます。本番 DB 変更、migration、deploy、認証の重大変更、外部契約、課金、secrets、大規模な breaking change、曖昧な依頼は `NEEDS_HUMAN` になり、確認質問が付きます。人間の返信でタスクを再開する処理は Phase 4 です。

Slack を使わず、設定済みの LLM と Notion だけを通す場合:

```bash
SIMULATE_WORKSPACE_ID=TXXXXXXXX SIMULATE_CHANNEL_ID=CXXXXXXXX npm run simulate -- "#questoon Questoonに顧客CSV出力を追加して"
```

このコマンドも `.env` の Slack 設定を要求します。投稿は標準出力に出ます。

## 開発

```bash
npm run typecheck
npm run lint
npm test
```

テストは Slack、Notion、LLM へ接続しません。

ログは JSON で、`time`、`taskId`、`agentType`、`event`、`status`、`error` を含みます。依頼本文と API キーはログに出しません。
