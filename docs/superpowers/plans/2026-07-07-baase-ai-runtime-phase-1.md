# Baase AI Runtime Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for the Baase AI Runtime: typed harness, prompt/schema registries, mock/OpenAI/Deepgram providers, `AiRun` logging, and API routes that can be tested without real provider keys.

**Architecture:** Add a focused `apps/api/src/modules/ai` module. Domain code talks to `AiHarness`, not directly to provider SDKs. Phase 1 exposes safe internal APIs and mockable providers; later phases can connect onboarding, audio upload, and real UI flows.

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, OpenAI SDK, Deepgram SDK, existing JSONB repository pattern.

---

### Task 1: Core Types, Repository, And Mock Harness

**Files:**
- Create: `apps/api/src/modules/ai/ai.types.ts`
- Create: `apps/api/src/modules/ai/in-memory-ai.repository.ts`
- Create: `apps/api/src/modules/ai/providers/mock-ai.provider.ts`
- Create: `apps/api/src/modules/ai/ai-harness.ts`
- Test: `apps/api/src/modules/ai/ai-harness.test.ts`

- [ ] **Step 1: Write failing tests**

Test that a structured run creates an `AiRun`, uses a registered mock provider, stores validation metadata, and returns typed output. Test that transcription uses the provider and logs an audio run.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @prymeira/baase-api test -- ai-harness.test.ts`

Expected: fail because `modules/ai` files do not exist.

- [ ] **Step 3: Implement minimal code**

Create the types, repository, mock provider, and harness needed by the tests. Keep provider calls injectable and deterministic.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @prymeira/baase-api test -- ai-harness.test.ts`

Expected: pass.

### Task 2: Prompt And Schema Registries

**Files:**
- Create: `apps/api/src/modules/ai/prompt-registry.ts`
- Create: `apps/api/src/modules/ai/schema-registry.ts`
- Test: `apps/api/src/modules/ai/ai-registries.test.ts`

- [ ] **Step 1: Write failing tests**

Test default prompt definitions for onboarding/process/routine/training/reviewer and Zod schemas for onboarding setup, process draft, routine draft, and training draft.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @prymeira/baase-api test -- ai-registries.test.ts`

Expected: fail because registries do not exist.

- [ ] **Step 3: Implement minimal code**

Create prompt definitions from the AI Runtime spec and schema registry exports.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @prymeira/baase-api test -- ai-registries.test.ts`

Expected: pass.

### Task 3: Provider Adapters

**Files:**
- Create: `apps/api/src/modules/ai/providers/openai.provider.ts`
- Create: `apps/api/src/modules/ai/providers/deepgram.provider.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/modules/ai/ai-providers.test.ts`

- [ ] **Step 1: Write failing tests**

Test that OpenAI provider builds a structured run request with model, reasoning effort, prompt text, and schema. Test that Deepgram provider accepts an audio URL/buffer request and returns normalized transcript metadata when its client is stubbed.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @prymeira/baase-api test -- ai-providers.test.ts`

Expected: fail because provider adapters do not exist.

- [ ] **Step 3: Install SDKs**

Run: `pnpm --filter @prymeira/baase-api add openai @deepgram/sdk`

- [ ] **Step 4: Implement minimal adapters**

Wrap SDK access behind small injected clients so tests do not call external services.

- [ ] **Step 5: Verify green**

Run: `pnpm --filter @prymeira/baase-api test -- ai-providers.test.ts`

Expected: pass.

### Task 4: API Routes And App Wiring

**Files:**
- Create: `apps/api/src/modules/ai/ai.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Test: `apps/api/src/modules/ai/ai.routes.test.ts`
- Test: `apps/api/src/db/postgres.repositories.test.ts`

- [ ] **Step 1: Write failing route tests**

Test `POST /ai/drafts`, `GET /ai/runs`, and `POST /ai/transcriptions` using the mock provider through `buildApp`.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @prymeira/baase-api test -- ai.routes.test.ts`

Expected: fail with 404/missing routes.

- [ ] **Step 3: Implement routes and repository wiring**

Add AI repository to `BuildAppOptions`, in-memory defaults, Postgres JSONB support, and route registration.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @prymeira/baase-api test -- ai.routes.test.ts postgres.repositories.test.ts`

Expected: pass.

### Task 5: Full Verification

- [ ] Run `pnpm test`
- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm build`
- [ ] Update `docs/ai-operations.md` if route names or Phase 1 shape changed.

