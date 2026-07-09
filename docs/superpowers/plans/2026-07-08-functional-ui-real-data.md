# Baase Functional UI Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the main internal Baase screens from visual/demo surfaces into clickable, API-backed product flows.

**Architecture:** Keep the existing React single-file app structure for now, but remove hardcoded state from the affected screens. Backend company editing will follow the current repository/service/routes pattern and work in memory and Postgres JSONB storage.

**Tech Stack:** React, Vite, Vitest, Testing Library, Fastify, Zod, Postgres JSONB repository.

---

### Task 1: Process Version Interaction

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] Add `versions` to `ApiProcess`.
- [ ] Add a failing UI test that clicks an older process version and expects the detail header/body to change.
- [ ] Render real versions from `process.versions`, sorted newest first.
- [ ] Keep current version selected by default and make historical versions clickable.
- [ ] Run `pnpm --filter @prymeira/baase-web test src/App.test.tsx`.

### Task 2: Editable Team Members

**Files:**
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/company.service.ts`
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/modules/company/in-memory-company.repository.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Test: `apps/api/src/modules/company/company.routes.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] Add a failing API test for `PATCH /people/:id`.
- [ ] Implement `updateTeamMember` in company repository/service/routes for role, area, role template, email, name and status.
- [ ] Add a web API helper `updatePerson`.
- [ ] Add a failing UI test that opens a person, changes role/area/cargo, and calls `PATCH /api/people/:id`.
- [ ] Reuse `PersonForm` for create/edit.
- [ ] Run API and web targeted tests.

### Task 3: Real Routine Form Data

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] Add a failing UI test that opens a routine modal and sees company area/person options instead of fixed fallback ids.
- [ ] Pass areas and people into `RoutineForm`.
- [ ] Use a select for area and assignee.
- [ ] Render checklist from the selected routine's `taskTemplates`.
- [ ] Run targeted web tests.

### Task 4: Template Card Layout

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] Add a failing UI test for template cards exposing clean action labels.
- [ ] Make card headers stable and prevent long type labels from overflowing.
- [ ] Move `Adaptar` and `Usar` into a stable action row.
- [ ] Run targeted web tests and typecheck.

### Task 5: Verification

**Files:**
- All touched files.

- [ ] Run `pnpm --filter @prymeira/baase-api typecheck`.
- [ ] Run `pnpm --filter @prymeira/baase-web typecheck`.
- [ ] Run targeted API/web tests.
- [ ] If localhost is running, verify `http://localhost:5190/api/readiness`.
