# Baase Company Team Phase 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mapa da Empresa and Equipe use real company/team API data, including role/person creation and invite acceptance.

**Architecture:** Extend the existing company module and JSONB repository pattern. Then extend the React API bundle and wire the current screens to real areas, roles, people, and invites without redesigning the visual shell.

**Tech Stack:** Fastify, Zod, TypeScript, Postgres JSONB repository, React, Vite, Vitest, Testing Library.

---

### Task 1: Backend Invite Acceptance

**Files:**
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/company.service.ts`
- Modify: `apps/api/src/modules/company/in-memory-company.repository.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/modules/company/company.routes.test.ts`

- [x] Add failing route tests for `GET /invites/:code` and `POST /invites/:code/accept`.
- [x] Implement repository lookup/update for invite codes.
- [x] Implement service accept flow that creates a team member and marks invite accepted.
- [x] Add route schemas and responses.

### Task 2: Web API Bundle

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [x] Add failing API tests for loading company data and new helpers.
- [x] Extend `BaaseWorkspaceBundle` with areas, role templates, people, and invites.
- [x] Add helper functions for roles, people, invite preview, and invite accept.

### Task 3: Web Screens

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Add failing UI tests for real map/team data, role/person creation, and invite acceptance.
- [x] Wire CompanyMap and TeamPage to loaded API data.
- [x] Add role/person modal forms with area/role selectors.
- [x] Add invite accept panel.

### Task 4: Verification

- [x] Run `pnpm --filter @prymeira/baase-api test -- src/modules/company/company.routes.test.ts`.
- [x] Run `pnpm --filter @prymeira/baase-web test -- api.test.ts App.test.tsx`.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.

## Self Review

- Plan covers the Phase 9 spec.
- The phase is testable without Clerk.
- Later production auth remains out of scope.
