# AI Development Orchestrator

Slack の開発依頼を Notion のタスクにし、`READY` のタスクは Project に結んだ Coding Agent が Git worktree で実装する。Claude Code、Codex CLI、Cursor Agent CLI は同じ Agent として差し替えられる。

```
External Input
  → Input Adapter（Slack のイベントを共通 Input にする）
  → Orchestration（Input を Project と Agent Link へ接続する）
  → Routing（Workspace → Channel → Hashtag → Project）
  → Intake（接続済みの依頼を受け取る）
  → Planner（何を作るか）
  → Task
  → Scheduler（READY を実行する）
  → worktree（Project の repository から作る）
  → Agent Runtime（Agent の起動方法を解決する）
  → Coding Agent
      Claude Code / Codex CLI / Cursor Agent CLI
  → Git commit
  → Notion を DONE に更新
```

状態の真実は Notion の Status だけです。Planner は依頼を Task に分解します。コードの変更は Agent Runtime が起動する Coding Agent CLI が行います。Claude Code、Codex、Cursor Agent は同じ Agent ID として定義されます。そのマシンに CLI が無い、または認証されていない場合は、その Task だけ失敗し、プロセスは起動したままです。commit は Git サービスが行います。GitHub Pull Request はまだ作りません。

Orchestration が決めるのは、どの Input を、どの Project の、どの Agent へ渡すかだけです。Agent の起動方法、CLI の有無、Task の状態、計画、コード生成、Git はそれぞれのサービスが持ちます。

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
| `src/slack` | Input Adapter。Slack イベントの受信、共通 Input への変換、投稿 |
| `src/orchestration` | Input Source の定義と、Input から Project / Agent への接続 |
| `src/routing` | Workspace → Channel → Hashtag → Project |
| `src/project` | Project（projectId、名前、リポジトリ） |
| `src/intake` | 接続済みの依頼を受け取り、計画へ渡す |
| `src/planning` | LLM による計画と、人間確認の判定 |
| `src/llm` | OpenAI / Anthropic。依頼の分解だけ |
| `src/notion` | Task DB への読み書き |
| `src/tasks` | Task ID の採番と状態遷移 |
| `src/scheduler` | `READY` タスクの取得と、Project からリポジトリと Agent Link の解決 |
| `src/git` | worktree 作成と commit |
| `src/agents` | Agent Runtime。Agent Link の名前から Coding Agent CLI を起動する |
| `src/notifications` | 人間向け文面 |
| `src/health` | Docker 用の `/health` |

## 前提

- Node.js 22 以上
- Slack App（Socket Mode）
- Notion Integration と、タスクを置く親ページ
- 実行したい Coding Agent の CLI。Claude Code、Codex、Cursor Agent のどれかが入っていれば、その Agent のタスクを実行できる。一つも無くてもプロセスは起動する
- Planner に API を使うときだけ OpenAI または Anthropic の API キー。Coding Agent の認証とは別

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

### Planner

Planner は依頼を Task に分解する API です。Coding Agent はコードを書く CLI です。Planner の `OPENAI_API_KEY` や `ANTHROPIC_API_KEY` は、Codex CLI や Claude Code の認証には使いません。Planner 用の API キーは起動に不要です。

`PLANNER_PROVIDER=openai` のときだけ `OPENAI_API_KEY` が必要です。`PLANNER_PROVIDER=anthropic` のときだけ `ANTHROPIC_API_KEY` が必要です。未設定のときはプロセスは起動しますが、依頼の分解はそのメッセージだけ失敗します。モデル名は `OPENAI_MODEL` と `ANTHROPIC_MODEL` で変えます。

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

`GET http://127.0.0.1:3000/health` が `{"ok":true}` を返します。postgres と redis は Compose に含めていません。Docker 内では `SCHEDULER_ENABLED=false` です。Coding Agent CLI、Git、worktree はホストの `npm run dev` で動かします。

## Phase 2

Phase 2 はホストの Node.js プロセスで動かします。コンテナからは Coding Agent CLI を起動しません。起動時に CLI の有無は見ません。Scheduler が Task を実行する直前に Agent Runtime へ availability を問い合わせます。

### Coding Agent

Agent の定義は `claude`、`codex`、`cursor` です。実行コマンドは `config/agents.json` に書きます。

```bash
cp config/agents.example.json config/agents.json
```

```json
{
  "agents": {
    "claude": { "kind": "coding", "command": "claude" },
    "codex": { "kind": "coding", "command": "codex" },
    "cursor": { "kind": "coding", "command": "agent" }
  }
}
```

ファイルが無いときは、この既定コマンドを使います。`CLAUDE_COMMAND`、`CODEX_COMMAND`、`CURSOR_COMMAND` が空でなければ、その Agent のコマンドだけを上書きします。`CODING_AGENT` は、Project に coding の Agent Link が無いときの既定です。

各 Runner は、公式ドキュメントで確認できたオプションだけを使います。

Claude Code は `-p`、`--output-format text`、`--permission-mode acceptEdits`、`--permission-prompts none`、`--disallowed-tools`（`git push`、`git commit`、`ssh`、`scp`）です。プロンプトは標準入力です。`bypassPermissions` は使いません。非対話で認証状態を返すコマンドは確認できていないため、コマンドが存在するときは `available` とします。

Codex は `codex exec --sandbox workspace-write --ask-for-approval never --cd <worktree> -` です。プロンプトは `-` により標準入力です。`--full-auto` と `--yolo` は使いません。認証は `codex login` で行い、実行前に `codex login status` の終了コードが 0 なら `available`、それ以外は `unauthenticated` です。Planner 用の `OPENAI_API_KEY` は子プロセスに渡しません。

Cursor Agent は `agent -p --output-format text --trust --sandbox enabled --workspace <worktree> <prompt>` です。`--force` と `--yolo`、Cursor 自身の `--worktree` は使いません。worktree は Orchestrator が作り、`--workspace` で渡します。認証は `agent status` で確認し、終了コードが 0 以外なら `unauthenticated` です。`CURSOR_API_KEY` は Cursor Agent の認証なので、子プロセスから消しません。

タイムアウトは `CLAUDE_TIMEOUT_MS` です。Agent ごとの `timeoutMs` を `agents.json` に書くと、そちらが優先されます。作業ディレクトリは常に Project から作った worktree です。

### 設定

`.env` に次を追加します。パスは自分の環境に合わせて変えます。

```bash
CODING_AGENT=claude
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

Scheduler が拾うと、状態は `READY` → `ASSIGNED` → `CODING` → `DONE` と変わります。Project ID があるタスクの worktree は `${WORKTREE_ROOT}/{projectId}/TASK-xxx`、無い古いタスクは `${WORKTREE_ROOT}/TASK-xxx` です。ブランチは `feature/TASK-xxx` です。実行するリポジトリは `config/projects.json` の `localPath` です。Notion の Repository 欄や依頼文のパスでは決めません。変更があればその worktree に commit され、Result に Coding Agent の報告と commit が入ります。変更がなければ commit せず `DONE` にします。リポジトリ不在、worktree 失敗、Agent が `available` でない、Agent の終了コードが 0 以外、Git 操作の失敗は、そのタスクだけ `FAILED` にし、Error に理由を残します。プロセスは止まりません。

途中でプロセスが落ちて `CODING` のまま残ったタスクは、手動で `READY` に戻すまで再実行しません。

GitHub Pull Request は Phase 3 で作ります。

## プロジェクトの振り分け

Slack の依頼は、LLM にプロジェクトを推測させません。Slack Adapter がイベントを共通 Input に変換し、Orchestration が有効な Input Source と Routing で Project を決めます。`agentLinks` は Project と Agent の接続です。Agent の実行コマンドは `config/agents.json` にあり、Project の設定とは分かれています。`agentLinks` がある Project は `CODING_AGENT` よりこちらが優先されます。

Agent Definition は `claude`、`codex`、`cursor` という論理的な ID です。Agent Link は、どの Project の coding をどの ID に渡すかです。Agent Runtime は、その ID をどのコマンドで、どの worktree に対して起動するかを決めます。Agent Availability は、その実行環境で CLI があるか、認証されているかを実行直前に見ます。`unknown` は定義の無い名前、`unsupported` は定義はあるが Runtime が未登録、`unavailable` は Runtime はあるが CLI が無い、`unauthenticated` は CLI はあるが認証の確認に失敗、`available` は実行できる状態です。CLI が一つも無くてもプロセスは起動します。

Codex は公式の `codex exec --sandbox workspace-write --ask-for-approval never --cd <worktree> -` で起動します。認証は `codex login status` で確認し、Planner 用の `OPENAI_API_KEY` は渡しません。Cursor Agent は公式の `agent -p --output-format text --trust --sandbox enabled --workspace <worktree>` で起動します。`--force` は使いません。認証は `agent status` で確認します。Claude Code には、非対話の認証状態を返すと確認できたコマンドが無いため、コマンドが存在するときは `available` とします。

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
