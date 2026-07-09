# Baase Audio Onboarding Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real browser audio capture for onboarding answers and route those recordings through the existing Baase AI transcription harness.

**Architecture:** Extend `/ai/transcriptions` to accept `audio_base64` alongside `audio_url`, decode it to `Buffer`, and reuse the existing Deepgram Nova 3 provider path. Add a web API helper that converts `Blob` to base64, then wire `MediaRecorder` into onboarding question fields with safe UI states and text fallback.

**Tech Stack:** Fastify, Zod, TypeScript, React, MediaRecorder, Vitest, existing Baase AI harness.

---

### Task 1: Backend Base64 Audio Transcription

**Files:**
- Modify: `apps/api/src/modules/ai/ai.routes.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.test.ts`

- [x] Write a failing test that posts `audio_base64` and asserts the provider receives an audio buffer.
- [x] Run `pnpm --filter @prymeira/baase-api test -- ai.routes.test.ts` and verify failure.
- [x] Extend the transcription schema to accept either `audio_url` or `audio_base64` plus `mime_type`.
- [x] Decode base64 before calling `harness.transcribeAudio`.
- [x] Run the focused API test and verify pass.

### Task 2: Web API Blob Transcription Client

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [x] Write a failing test for `transcribeAudioBlob`.
- [x] Run `pnpm --filter @prymeira/baase-web test -- api.test.ts` and verify failure.
- [x] Add transcript result types and `blobToBase64`.
- [x] Add `transcribeAudioBlob`.
- [x] Run focused web API tests and verify pass.

### Task 3: React MediaRecorder Onboarding Flow

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [x] Write a failing UI test with mocked `MediaRecorder` that records, stops, transcribes, and fills a question answer.
- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx` and verify failure.
- [x] Add recording state per question.
- [x] Start/stop `MediaRecorder` from `QuestionField`.
- [x] Send recorded `Blob` through `transcribeAudioBlob`.
- [x] Render recording/transcribing/error states without blocking text fallback.
- [x] Run focused UI tests and verify pass.

### Task 4: Documentation And Verification

- [x] Update `docs/ai-operations.md`.
- [x] Update `docs/api-contract.md`.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
