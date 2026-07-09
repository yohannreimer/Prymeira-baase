# Baase Real Dashboards Phase 13 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real dashboard metrics for owner, manager, and employee surfaces.

**Architecture:** Add a backend dashboard module that aggregates existing repository data, then load it in the web bundle and render it in the current dashboard components. Keep the UI layout intact and replace hardcoded counts only when dashboard data exists.

**Tech Stack:** Fastify, TypeScript, Vitest, React, Vite.

---

### Task 1: Backend Dashboard Endpoint

**Files:**
- Create: `apps/api/src/modules/dashboard/dashboard.types.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.routes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] Write a failing route test for `GET /dashboard?date=2026-07-07` using seeded demo data.
- [ ] Verify the test fails with `404`.
- [ ] Implement dashboard types, aggregation service, route registration, and app registration.
- [ ] Verify the focused API test passes.

### Task 2: Web API Bundle

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] Write a failing web API test that expects `loadBaaseWorkspace` to include `dashboard`.
- [ ] Verify the test fails because dashboard is not loaded.
- [ ] Add `ApiDashboard` types and fetch `/api/dashboard?date=...`.
- [ ] Verify the focused web API test passes.

### Task 3: Dashboard Rendering

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] Write a failing app test where `/api/dashboard` returns real owner metrics and the owner home renders them.
- [ ] Verify the test fails.
- [ ] Pass dashboard data into owner and manager dashboard components.
- [ ] Replace hardcoded metric cards and owner attention list when dashboard data exists.
- [ ] Verify the focused app test passes.

### Task 4: Final Verification

**Files:**
- No production files expected.

- [ ] Run `pnpm --filter @prymeira/baase-api typecheck`.
- [ ] Run `pnpm --filter @prymeira/baase-web typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.

