# AI Development Orchestrator

Slack に書いた開発依頼を、LLM が構造化されたタスクに分解し、Notion に登録する。Phase 1 はここまで。

```
Slack
  → Orchestrator
  → LLM（JSON Schema）
  → Notion Task
  → Slack に Task ID を返信
```

状態の真実は Notion の Status だけです。LLM は計画を判断し、TypeScript が API を実行します。Orchestrator はコードを書きません。

## いま動くこと

Slack の人間メッセージを受けると、次を行います。

1. 依頼文からトークンらしき文字列を除く
2. LLM に JSON Schema 付きで計画させる
3. Zod で検証する。モデルが人間確認を求めた場合、確信度が閾値未満の場合、秘密情報が含まれていた場合、migration・本番 DB・本番デプロイ・課金・契約変更・secrets 変更・breaking change が依頼文に含まれる場合は `NEEDS_HUMAN`、それ以外は `READY` にする
4. Notion にタスクを作る
5. スレッドに Task ID、要約、Notion URL を返す

同じ Slack メッセージの再配送では、タスクを二重作成しません。計画や Notion 作成の失敗は、その依頼だけ失敗通知にしてプロセスは継続します。

## まだ作っていないこと

次のフェーズは未実装です。

| Phase | 内容 |
| --- | --- |
| 2 | Scheduler、Coding Agent、Git worktree |
| 3 | commit、GitHub Pull Request、実装開始と完了の Slack 通知 |
| 4 | 人間の回答による再開、retry、Review Agent |

`READY` のタスクを自動で実装する処理はまだありません。

## 責務

| 場所 | 役割 |
| --- | --- |
| `src/slack` | 人間のメッセージ受信と投稿 |
| `src/orchestrator` | 依頼の受付、計画、人間確認の判定 |
| `src/llm` | OpenAI / Anthropic の構造化出力 |
| `src/notion` | Task DB への読み書き |
| `src/tasks` | Task ID の採番と初期状態 |
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

表示された ID を `NOTION_TASK_DATABASE_ID` に入れます。データベースには Title、TaskId、Description、Status、Priority、AgentType、Repository、Branch、Worktree、PullRequestUrl、Result、Error、CreatedAt、UpdatedAt、RetryCount に加え、依頼の追跡用の RequestId、Summary、SlackChannel、SlackThreadTs、SourceMessageTs、HumanQuestion、Confidence があります。

Status は `RECEIVED`、`PLANNING`、`READY`、`ASSIGNED`、`CODING`、`TESTING`、`REVIEWING`、`NEEDS_HUMAN`、`NEEDS_CHANGES`、`READY_TO_MERGE`、`DONE`、`FAILED` です。Phase 1 が書くのは `READY` と `NEEDS_HUMAN` だけです。

### LLM

`LLM_PROVIDER=openai` なら `OPENAI_API_KEY`、`anthropic` なら `ANTHROPIC_API_KEY` が必要です。モデル名は `OPENAI_MODEL` と `ANTHROPIC_MODEL` で変えます。

`DEFAULT_REPOSITORY` には、依頼文がパスを含まないときにタスクへ入れるローカルリポジトリを書きます。例: `/Users/me/projects/questoon`

`PLAN_CONFIDENCE_THRESHOLD` 未満の確信度は `NEEDS_HUMAN` になります。既定は `0.6` です。

## 起動

```bash
npm run dev
```

Docker Compose で起動する場合:

```bash
docker compose up --build
```

`GET http://127.0.0.1:3000/health` が `{"ok":true}` を返します。postgres と redis は Compose に含めていません。

## Phase 1 の確認

ボットを招待したチャンネルに、次を投稿します。

```text
Questoonに顧客CSV出力を追加して
```

スレッドに Task ID が返り、Notion に `READY` のタスクができます。本番 DB 変更、migration、deploy、認証の重大変更、外部契約、課金、secrets、大規模な breaking change、曖昧な依頼は `NEEDS_HUMAN` になり、確認質問が付きます。人間の返信でタスクを再開する処理は Phase 4 です。

Slack を使わず、設定済みの LLM と Notion だけを通す場合:

```bash
npm run simulate -- "Questoonに顧客CSV出力を追加して"
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
