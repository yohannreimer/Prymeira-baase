# Baase Template Library Phase 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real curated template library with filters, real content creation, and AI adaptation context.

**Architecture:** Add a backend template catalog module and register routes in the app. Extend the web API bundle and React templates screen to consume templates from the API, then reuse existing CRUD and AI generation paths.

**Tech Stack:** Fastify, Zod, TypeScript, React, Vite, Vitest, Testing Library.

---

### Task 1: Backend Template Catalog

**Files:**
- Create: `apps/api/src/modules/templates/template.types.ts`
- Create: `apps/api/src/modules/templates/template-library.ts`
- Create: `apps/api/src/modules/templates/template.routes.ts`
- Create: `apps/api/src/modules/templates/template.routes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] Add failing tests for `GET /templates` filters.
- [ ] Add failing tests for `POST /templates/:id/use` creating process, routine, and training.
- [ ] Implement curated templates and filter helpers.
- [ ] Implement routes with permissions and service calls.
- [ ] Register routes in `buildApp`.

### Task 2: Web API Contract

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] Add failing test for templates in `loadBaaseWorkspace`.
- [ ] Add failing test for `useTemplate`.
- [ ] Add API template types and client helpers.

### Task 3: React Template Library

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] Add failing UI test for API template filters.
- [ ] Add failing UI test for using a backend template.
- [ ] Add failing UI test for adapting a backend template with AI context.
- [ ] Replace frontend hardcoded templates with API/fallback templates.
- [ ] Add segment, area, and kind filters.
- [ ] Wire use/adapt handlers to API/helpers.

### Task 4: Verification

- [ ] Run focused backend template tests.
- [ ] Run focused web API tests.
- [ ] Run focused template UI tests.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Smoke test `/api/templates` and `/api/templates/:id/use` locally.

## Self Review

- Scope matches Phase 12 and does not add marketplace/custom templates.
- Existing services remain source of truth for created content.
- Adaptation uses the Phase 11 AI path instead of a parallel flow.
