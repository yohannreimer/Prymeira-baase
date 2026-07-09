# Baase AI Runtime Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the AI Runtime to the onboarding flow so owner answers generate a structured company suggestion, the review screen renders that suggestion, and accepted items persist through `/onboarding/setup`.

**Architecture:** Add a dedicated backend route `POST /ai/onboarding/suggestions` that uses `AiHarness` with `onboardingSetupSuggestionSchema`. Add web API functions to generate suggestions and convert accepted suggestions into the existing onboarding setup payload. Keep fallback behavior for local/demo mode by reusing the existing static starter setup when no AI suggestion exists.

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, React/Vite, existing Baase API client helpers.

---

### Task 1: Backend Onboarding Suggestion Route

**Files:**
- Modify: `apps/api/src/modules/ai/ai.routes.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.test.ts`

- [x] Write failing route tests for `POST /ai/onboarding/suggestions`.
- [x] Run `pnpm --filter @prymeira/baase-api test -- ai.routes.test.ts` and verify failure.
- [x] Implement the route using `AiHarness.runStructured` with `source: "onboarding"`, `taskKind: "onboarding_setup"`, `agentKey: "onboarding_architect"`, and `onboardingSetupSuggestionSchema`.
- [x] Run the focused test and verify pass.

### Task 2: Web API Client And Conversion

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [x] Write failing tests for `generateOnboardingSuggestion` and saving a suggestion through `/api/onboarding/setup`.
- [x] Run `pnpm --filter @prymeira/baase-web test -- api.test.ts` and verify failure.
- [x] Add web types for onboarding answers/suggestion.
- [x] Add `generateOnboardingSuggestion`.
- [x] Add `saveOnboardingSuggestionWorkspace`.
- [x] Run focused web API tests and verify pass.

### Task 3: React Onboarding Flow

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [x] Write failing UI test: fill onboarding answers, click generate, assert `/api/ai/onboarding/suggestions` called and review screen renders suggested items.
- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx` and verify failure.
- [x] Store onboarding answers in React state.
- [x] Generate suggestion before navigating to review.
- [x] Render review categories from the suggestion when present.
- [x] Persist suggestion on “Criar minha empresa”.
- [x] Run focused UI tests and verify pass.

### Task 4: Full Verification

- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Update `docs/ai-operations.md` with `/ai/onboarding/suggestions`.
