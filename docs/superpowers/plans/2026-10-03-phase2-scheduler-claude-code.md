# Phase 2 Scheduler and Claude Code Implementation Plan

**Goal:** Notion の `READY` タスクを、ローカルの Claude Code CLI が Git worktree 上で実装し、Orchestrator が commit して `DONE` にする。

**Architecture:** Scheduler は通常の TypeScript である。コード生成は Anthropic API を呼ばず、インストール済みの `claude -p` を worktree で起動する。タスク状態の更新は Notion だけが持つ。GitHub PR は作らない。

**Tech Stack:** 既存の Node.js / TypeScript。Claude Code CLI 2.1.287 の実在オプションだけを使う。

## Global Constraints

- Phase 1 の Slack → LLM → Notion 作成は変えない
- `claude` の help にある `-p`、`--output-format text`、`--permission-mode acceptEdits`、`--permission-prompts none`、`--disallowed-tools` だけを使う
- `--dangerously-skip-permissions` と `bypassPermissions` は使わない
- commit は Orchestrator が行い、Claude Code には commit も push もさせない
- 1 タスクの失敗で Scheduler プロセスは止めない
- 自動 retry は Phase 2 ではしない
- Docker コンテナからは Claude Code を起動しない

## Tasks

- [x] Agent interface、Claude Code runner、factory
- [x] Git worktree と commit
- [x] Notion の Status 取得と更新
- [x] Scheduler（READY → ASSIGNED → CODING → DONE / FAILED）
- [x] テスト、README、`.env.example`
