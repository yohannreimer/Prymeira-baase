# Baase Operational AI Phase 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the AI harness to real product actions and add proactive operational suggestions.

**Architecture:** Extend the AI module with announcement drafts and a deterministic proactive signal scanner that reads company, process, routine, and training repositories. Then expose suggestions and generated drafts through the web API layer and owner/create-with-AI screens.

**Tech Stack:** Fastify, Zod, TypeScript, React, Vite, Vitest, Testing Library.

---

### Task 1: Backend AI Drafts And Proactive Suggestions

**Files:**
- Modify: `apps/api/src/modules/ai/schema-registry.ts`
- Modify: `apps/api/src/modules/ai/prompt-registry.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/modules/ai/proactive-suggestions.ts`

- [x] Add failing route tests for `type: "announcement"` on `/ai/drafts`.
- [x] Add failing route test for `GET /ai/proactive-suggestions`.
- [x] Add `announcement_draft` schema and prompt.
- [x] Add proactive suggestion builder from repository data.
- [x] Register AI routes with operational repositories.

### Task 2: Web API Contract

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [x] Add failing tests for loading proactive suggestions in the workspace bundle.
- [x] Add failing tests for `generateAiDraft`.
- [x] Add web types and helpers.

### Task 3: Web Product Flow

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Add failing UI test for dashboard suggestions from the API.
- [x] Add failing UI test for `Criar com IA` using `/ai/drafts`.
- [x] Render proactive suggestions in the owner dashboard.
- [x] Map generated drafts into existing process/routine/training/announcement creation flows.

### Task 4: Demo Mode Provider Hardening

**Files:**
- Modify: `apps/api/src/modules/ai/providers/mock-ai.provider.ts`
- Modify: `apps/api/src/modules/ai/ai-providers.test.ts`

- [x] Add failing provider test for schema-valid default mock outputs.
- [x] Return valid onboarding, process, routine, training, and announcement outputs in demo mode.

### Task 5: Verification

- [x] Run focused API tests.
- [x] Run focused web tests.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Smoke test live `/ai/proactive-suggestions`, `/ai/drafts`, and onboarding suggestion endpoints.

## Self Review

- Plan covers the Phase 10 spec.
- No autonomous publishing is introduced.
- The phase remains testable without OpenAI keys through the mock provider.
