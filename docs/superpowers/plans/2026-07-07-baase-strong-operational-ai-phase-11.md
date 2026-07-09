# Baase Strong Operational AI Phase 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make audio, text, and PDF/material inputs generate real editable operational drafts through the AI harness.

**Architecture:** Extend `/ai/drafts` with attachment extraction, then expose attachments/input mode in the web API client. The React create-with-AI screen owns transient audio/file state and still saves generated content through existing CRUD endpoints.

**Tech Stack:** Fastify, Zod, pdf-parse, TypeScript, React, Vite, Vitest, Testing Library.

---

### Task 1: Backend Draft Attachments

**Files:**
- Modify: `apps/api/src/modules/ai/ai.routes.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.test.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

- [x] Add failing route test for `/ai/drafts` with a text attachment.
- [x] Add attachment schema and extractor.
- [x] Pass extracted attachments into `harness.runStructured`.
- [x] Verify focused AI route tests.

### Task 2: Web API Attachment Contract

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [x] Add failing client test for `generateAiDraft` with `inputMode: "pdf"` and attachments.
- [x] Add attachment type and serialization.
- [x] Verify focused web API tests.

### Task 3: Create With AI Audio And Material UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Add failing UI test for material upload generating a training draft.
- [x] Add failing UI test for audio transcription feeding generation.
- [x] Add create-AI audio recording/transcription handlers.
- [x] Add material file picker and selected file state.
- [x] Pass `inputMode` and attachments into draft generation.
- [x] Verify focused UI tests.

### Task 4: Verification

- [x] Run `pnpm --filter @prymeira/baase-api test -- src/modules/ai/ai.routes.test.ts --reporter=basic`.
- [x] Run `pnpm --filter @prymeira/baase-web test -- api.test.ts App.test.tsx --reporter=basic`.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Smoke test local API/web paths for text attachment and audio transcription mocks.

## Self Review

- The phase uses existing draft CRUD instead of adding another review system.
- File storage is deliberately left for production/VPS phase.
- PDF content is extracted server-side before model execution.
- There are no fake "next phase" buttons left in the create-with-AI input path.
