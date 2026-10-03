# Phase 1 Slack to Notion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slack に投稿された開発依頼を、構造化 JSON の計画に分解し、Notion Task を作成して Task ID を Slack に返す。

**Architecture:** Slack は人間とのインターフェース、LLM は計画の判断だけを行い、TypeScript が状態遷移と外部 API 呼び出しを実行する。タスクの真実は Notion の Status だけとする。Phase 1 では Scheduler、Coding Agent、Git、GitHub PR は作らない。

**Tech Stack:** Node.js 22、TypeScript、npm、Slack Bolt（Socket Mode）、Notion API、OpenAI または Anthropic、Zod、Pino、Vitest、Docker Compose

## Global Constraints

- PostgreSQL と Redis は MVP では使わない
- LLM の自由形式テキストをシステムの状態にしない。計画は JSON Schema と Zod で検証する
- Orchestrator はコードを書かない
- secret は `.env` のみ。ログと Git に出さない
- タスク失敗でプロセス全体を落とさない
- Phase 2 以降（Scheduler、worktree、PR、retry、人間の回答による再開）は実装しない
- 初期 Status は、人間確認が不要なら `READY`、必要なら `NEEDS_HUMAN`

---

### Task 1: プロジェクト土台

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.env.example`

- [x] npm、TypeScript strict、ESLint、Vitest、Docker Compose の `orchestrator` サービスを用意する

### Task 2: ドメインと設定

**Files:**
- Create: `src/config/index.ts`, `src/tasks/task.types.ts`, `src/utils/logger.ts`, `src/utils/redact.ts`, `src/utils/ids.ts`
- Test: `tests/config.test.ts`, `tests/redact.test.ts`, `tests/logger.test.ts`

- [x] 環境変数を Zod で検証し、失敗時は変数名だけを出す
- [x] Task の Status / agentType / priority を定義する
- [x] 構造化ログから token を redact する

### Task 3: 計画の構造化

**Files:**
- Create: `src/orchestrator/plan.schema.ts`, `src/orchestrator/planner.prompt.ts`, `src/orchestrator/planner.service.ts`, `src/orchestrator/approval.service.ts`, `src/llm/llm.client.ts`, `src/llm/openai.client.ts`, `src/llm/anthropic.client.ts`, `src/llm/llm.factory.ts`
- Test: `tests/planner.test.ts`, `tests/approval.test.ts`, `tests/plan-schema.test.ts`

**Interfaces:**
- Produces: `DevelopmentPlan`, `Planner.plan(text: string): Promise<DevelopmentPlan>`, `decideApproval(plan, threshold, options): ApprovalDecision`

- [x] LLM には JSON Schema を渡す
- [x] 低 confidence、秘密情報、危険操作は TypeScript が `NEEDS_HUMAN` に倒す

### Task 4: Notion Task 作成

**Files:**
- Create: `src/notion/notion.properties.ts`, `src/notion/notion.mapper.ts`, `src/notion/notion.service.ts`, `src/notion/setup-database.ts`, `src/tasks/task.store.ts`, `src/tasks/task.service.ts`
- Test: `tests/notion-mapper.test.ts`, `tests/task.service.test.ts`

**Interfaces:**
- Produces: `TaskStore.insert`, `TaskStore.findBySourceMessage`, `TaskService.create`

- [x] 指定の Task 項目を Notion プロパティに対応させる
- [x] `npm run notion:setup` でデータベースを作成できるようにする

### Task 5: Slack と Orchestrator

**Files:**
- Create: `src/slack/slack.types.ts`, `src/slack/extract-message.ts`, `src/slack/slack.service.ts`, `src/slack/slack.listener.ts`, `src/notifications/notification.service.ts`, `src/orchestrator/orchestrator.service.ts`, `src/app.ts`, `src/health/health.server.ts`, `src/index.ts`, `src/cli/simulate.ts`
- Test: `tests/extract-message.test.ts`, `tests/notification.test.ts`, `tests/phase1-flow.test.ts`, `tests/health.test.ts`

**Interfaces:**
- Consumes: `Planner`, `TaskService`, `Notifier`
- Produces: `OrchestratorService.handle(message)`

- [x] 人間のメッセージだけを受け、同一メッセージの再入を防ぎ、Task ID をスレッドに返す
- [x] 計画または Notion の失敗は Slack に短い失敗通知を出し、プロセスは継続する

### Task 6: 確認

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] README に Phase 1 の起動手順と、Phase 2 以降をまだ実装していないことを書く
