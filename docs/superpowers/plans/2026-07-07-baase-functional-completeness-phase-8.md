# Baase Functional Completeness Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the main passive controls in the Baase internal app so the owner can test realistic page and card behavior.

**Architecture:** Keep the existing Vite React shell and API helper layer. Add focused tests first, then implement stateful UI actions and API calls inside `apps/web/src/App.tsx`, with light styling additions in `apps/web/src/styles.css`.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, Fastify API helpers already exposed through `apps/web/src/api.ts`.

---

### Task 1: Web Behavior Tests

**Files:**
- Modify: `apps/web/src/App.test.tsx`

- [x] Add tests for search/notifications, map area creation, invite copy, side-list selection, template actions, create-with-AI modes, and process-change announcement.
- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx` and confirm the new tests fail before implementation.

### Task 2: App State and Actions

**Files:**
- Modify: `apps/web/src/App.tsx`

- [x] Import `createArea` and `ApiArea`.
- [x] Add notice state, custom area state, create-with-AI mode state, selected side-list state, and area modal support.
- [x] Add handlers for topbar panels, area creation, invite copy, template use/adapt, AI content creation by mode, and process-change announcements.

### Task 3: UI Wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Pass the new handlers into `OwnerDashboard`, `CompanyMap`, `TeamPage`, `ProcessesPage`, `TemplatesPage`, and `CreateWithAiPage`.
- [x] Convert inert cards/buttons into actionable buttons while preserving the existing visual language.
- [x] Add compact notice/search/notification/area modal styles.

### Task 4: Verification

**Files:**
- Modify only as needed after failures.

- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx`.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Report exact verification status.

## Self Review

- The plan is scoped to the approved Phase 8 product behavior.
- No production auth, file storage, or deployment work is mixed into this phase.
- Every task has a clear verification path.
