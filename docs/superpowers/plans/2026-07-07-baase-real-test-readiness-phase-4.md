# Baase Real Test Readiness Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Baase app reliable enough for real internal tests with persistent data and real AI provider readiness checks.

**Architecture:** Add a pure runtime config module, expose it through `GET /readiness`, and add a Postgres workspace reset utility for repeatable pilot testing. Keep existing product behavior intact; this phase is environment hardening and observability.

**Tech Stack:** Fastify, TypeScript, Vitest, PostgreSQL via `pg`, existing Baase monorepo scripts.

---

### Task 1: Runtime Config

**Files:**
- Create: `apps/api/src/config/runtime.ts`
- Create: `apps/api/src/config/runtime.test.ts`

- [x] Write failing tests for memory/demo mode, postgres/pilot mode, and missing pilot providers.
- [x] Run `pnpm --filter @prymeira/baase-api test -- runtime.test.ts` and verify failure.
- [x] Implement `readRuntimeConfig(env)`.
- [x] Run focused runtime tests and verify pass.

### Task 2: Readiness Endpoint

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/app.test.ts`

- [x] Write failing test for `GET /readiness`.
- [x] Run `pnpm --filter @prymeira/baase-api test -- app.test.ts` and verify failure.
- [x] Add `runtimeConfig` to `BuildAppOptions`.
- [x] Register `GET /readiness`.
- [x] Use `readRuntimeConfig(process.env)` in server startup.
- [x] Run focused app tests and verify pass.

### Task 3: Workspace Reset Utility

**Files:**
- Modify: `apps/api/src/db/postgres.ts`
- Create: `apps/api/src/db/reset-workspace.ts`
- Modify: `apps/api/src/db/postgres.repositories.test.ts`
- Modify: `apps/api/package.json`

- [x] Write failing test proving reset deletes only one workspace.
- [x] Run `pnpm --filter @prymeira/baase-api test -- postgres.repositories.test.ts` and verify failure.
- [x] Add `deleteWorkspaceRecords(db, workspaceId)`.
- [x] Add CLI script `reset-workspace.ts`.
- [x] Add package script `db:reset:workspace`.
- [x] Run focused postgres tests and verify pass.

### Task 4: Env And Pilot Docs

**Files:**
- Modify: `apps/api/.env.example`
- Create: `apps/web/.env.example`
- Modify: `docs/technical-architecture.md`
- Modify: `docs/database-schema.md`

- [x] Expand env examples with runtime, database, OpenAI and Deepgram variables.
- [x] Document local pilot runbook.
- [x] Mark plan checklist complete as tasks finish.

### Task 5: Full Verification

- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
