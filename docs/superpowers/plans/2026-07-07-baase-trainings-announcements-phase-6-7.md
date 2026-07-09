# Baase Trainings And Announcements Phase 6/7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make trainings and announcements operational for real VPS testing, including assignments, employee completion, confirmations, and Today pendencies.

**Architecture:** Extend the existing JSONB repository pattern with training assignments and announcement receipts. Keep `GET /today` as the employee operational inbox by returning tasks, training assignments, and announcement pendencies. Preserve the current React visual shell while replacing mock/local announcement and training completion behavior with API calls.

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, React, Vite, PostgreSQL via `pg`, existing Baase monorepo.

---

### Task 1: Training Assignments Backend

**Files:**
- Modify: `apps/api/src/modules/trainings/training.types.ts`
- Modify: `apps/api/src/modules/trainings/training.service.ts`
- Modify: `apps/api/src/modules/trainings/training.routes.ts`
- Modify: `apps/api/src/modules/trainings/in-memory-training.repository.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Modify: `apps/api/src/modules/trainings/training.service.test.ts`
- Modify: `apps/api/src/modules/trainings/training.routes.test.ts`

- [x] Write failing service tests for assignment creation and progress becoming completed after a passing quiz attempt.
- [x] Run `pnpm --filter @prymeira/baase-api test -- training.service.test.ts` and verify failure.
- [x] Add `TrainingAudience`, `TrainingAssignment`, `TrainingProgress`, repository methods, and service methods.
- [x] Run focused service tests and verify pass.
- [x] Write failing route tests for `POST /trainings/:id/assignments` and `GET /training-assignments`.
- [x] Run `pnpm --filter @prymeira/baase-api test -- training.routes.test.ts` and verify failure.
- [x] Implement route schemas and route handlers.
- [x] Run focused route tests and verify pass.

### Task 2: Announcements Backend

**Files:**
- Create: `apps/api/src/modules/announcements/announcement.types.ts`
- Create: `apps/api/src/modules/announcements/in-memory-announcement.repository.ts`
- Create: `apps/api/src/modules/announcements/announcement.service.ts`
- Create: `apps/api/src/modules/announcements/announcement.routes.ts`
- Create: `apps/api/src/modules/announcements/announcement.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/db/postgres.ts`

- [x] Write failing route tests for creating, publishing, listing, and confirming an announcement.
- [x] Run `pnpm --filter @prymeira/baase-api test -- announcement.routes.test.ts` and verify failure.
- [x] Implement announcement types, in-memory repository, service, and routes.
- [x] Register the announcement repository in `buildApp`.
- [x] Add Postgres repository support for `announcement` and `announcement_receipt`.
- [x] Run focused announcement tests and verify pass.

### Task 3: Today Operational Inbox

**Files:**
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [x] Write failing app test proving `GET /today` returns `tasks`, `training_assignments`, and `announcements`.
- [x] Run `pnpm --filter @prymeira/baase-api test -- app.test.ts` and verify failure.
- [x] Pass training and announcement providers into `registerRoutineRoutes`.
- [x] Enrich `GET /today` without breaking existing task behavior.
- [x] Run focused app tests and verify pass.

### Task 4: Postgres Persistence Coverage

**Files:**
- Modify: `apps/api/src/db/postgres.repositories.test.ts`

- [x] Write failing persistence test for training assignments and announcements across app instances.
- [x] Run `pnpm --filter @prymeira/baase-api test -- postgres.repositories.test.ts` and verify failure.
- [x] Complete any missing Postgres repository methods.
- [x] Run focused Postgres tests and verify pass.

### Task 5: Web API Client

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [x] Write failing web API tests for loading Today pendencies, assigning training, submitting quiz, creating/publishing announcement, and confirming announcement.
- [x] Run `pnpm --filter @prymeira/baase-web test -- api.test.ts` and verify failure.
- [x] Add types and client functions.
- [x] Run focused web API tests and verify pass.

### Task 6: Web UI Wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css` only if necessary for existing components to fit new states.

- [x] Write failing UI tests for employee seeing Today pendencies and confirming an announcement.
- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx` and verify failure.
- [x] Wire Today pendencies to API bundle.
- [x] Wire TrainingPage quiz completion to API.
- [x] Add announcement create modal and confirmation action.
- [x] Run focused UI tests and verify pass.

### Task 7: Docs And Verification

**Files:**
- Modify: `docs/api-contract.md`
- Modify: `docs/database-schema.md`
- Modify: `docs/full-product-plan.md`
- Modify: `docs/superpowers/plans/2026-07-07-baase-trainings-announcements-phase-6-7.md`

- [x] Document new training assignment and announcement endpoints.
- [x] Update database docs with new JSONB kinds.
- [x] Mark plan checklist items complete.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
