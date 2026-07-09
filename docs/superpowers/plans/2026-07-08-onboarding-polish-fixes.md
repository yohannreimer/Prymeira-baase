# Onboarding Polish Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix owner identity, company map hierarchy, process area labels, process step parsing, routine display, template card layout, and owner navigation after onboarding.

**Architecture:** Keep changes scoped to existing API/session and React shell files. Backend session reads the actual owner person when available; frontend derives area/role labels from already-loaded workspace bundle and renders stable card layouts.

**Tech Stack:** Fastify API, React 19, Vite, Vitest, Testing Library, CSS.

---

### Task 1: Owner Identity From Workspace Data

**Files:**
- Modify: `apps/api/src/modules/session/session.routes.ts`
- Test: `apps/api/src/modules/session/session.routes.test.ts`

- [ ] **Step 1: Write failing test**

Add a test that creates an owner team member named `Yohann Reimer` in `workspace_a`, calls `GET /me` as owner, and expects `profile.display_name` to be `Yohann Reimer` and `initials` to be `YR`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/session/session.routes.test.ts`

- [ ] **Step 3: Implement minimal backend lookup**

Allow `registerSessionRoutes` to receive the company repository/service or a lookup function, find the active owner member for the current workspace, and fall back to the current demo identity when not found.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/session/session.routes.test.ts`

### Task 2: Frontend Data Labels And Card Hierarchy

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests for:
- owner nav no longer shows `Onboarding IA` or `Revisão sugerida`.
- company map displays `Técnico Sênior CAD/CAM` with `Peterson` and `Técnico de Implantação e Treinamento` with `André`.
- process list/detail show area names instead of `area_2`/`area_4`.
- process step parser splits same-line numbered text into separate steps.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

- [ ] **Step 3: Implement minimal frontend changes**

Introduce display helpers for area names, area memberships, and process steps. Update map, process, routine, and nav rendering without changing unrelated flows.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

### Task 3: Template And Routine Visual Polish

**Files:**
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write/adjust test expectation**

Keep the existing template stable action group test and add coverage that a long template kind/title remains inside the card structure.

- [ ] **Step 2: Implement CSS-only polish**

Set stable card heights, prevent badge/action overflow, make template actions wrap predictably, and align area cards.

- [ ] **Step 3: Verify visually and with tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

### Task 4: Full Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused API tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/session/session.routes.test.ts src/modules/onboarding/onboarding-session.routes.test.ts`

- [ ] **Step 2: Run focused web tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx src/api.test.ts`

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Browser smoke**

Open the running app on `http://localhost:5190`, confirm owner name, map hierarchy, process area labels/steps, models, and sidebar.
