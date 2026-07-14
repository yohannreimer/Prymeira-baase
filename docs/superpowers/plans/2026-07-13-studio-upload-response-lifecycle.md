# Studio Upload Response Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound multipart receive and storage work while guaranteeing that successful object completion is followed by durable finalization without a false storage-timeout response.

**Architecture:** A route-level owner begins immediately after semaphore acquisition and races its response against one receive/storage deadline. The deadline signal flows through multipart receive, temp spooling, session creation, attachment, part upload, and completion, then is permanently disarmed after successful completion while the same owner continues heartbeat and idempotent database finalization. Server startup uses an explicit production storage policy before adapter selection.

**Tech Stack:** TypeScript, Fastify, Node streams, AWS-compatible object storage, PostgreSQL repositories, Vitest.

---

### Task 1: Post-completion response semantics

**Files:**
- Modify: `apps/api/src/modules/studio/studio-assets.routes.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.test.ts`

- [x] Add a failing test where Complete succeeds before the storage deadline and `finalizeAssetUpload` resolves after it; assert the response waits and returns one 201 asset with no timeout and no duplicate.
- [x] Move deadline ownership to the outer multipart owner and add an idempotent `storageCompleted()` transition that clears the timer and prevents later timeout/lease interrupts.
- [x] Keep heartbeat active through finalization, await finalize/reconcile without a DB timeout, and release temp/semaphore only after owner settlement.
- [x] Run the focused route tests and require zero failures.

### Task 2: Production storage policy

**Files:**
- Modify: `apps/api/src/server-initialization.ts`
- Modify: `apps/api/src/server-initialization.test.ts`
- Modify: `apps/api/src/server.ts`

- [x] Add failing tests for production missing/partial S3, valid production S3 readiness, and demo memory readiness/order.
- [x] Implement `assertRuntimeStoragePolicy` with `PRODUCTION_OBJECT_STORAGE_REQUIRED` and `initializeRuntimeObjectStorage` with injectable factories.
- [x] Call the initializer before repository/app construction and listen.
- [x] Run server initialization and runtime config tests.

### Task 3: Slow multipart receive bound

**Files:**
- Modify: `apps/api/src/modules/studio/studio-asset-upload.ts`
- Modify: `apps/api/src/modules/studio/studio-asset-upload.test.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [x] Add failing stream tests proving abort propagates through the temp pipeline and cleanup waits for settlement.
- [x] Pass an AbortSignal into multipart stream destruction and Node pipeline; normalize late parser rejection.
- [x] Start the deadline immediately after semaphore acquisition and retain capacity for at most two slow receive owners.
- [x] Configure Fastify `requestTimeout` to 120 seconds by default with a test override and verify it is receive-side configuration.
- [x] Run upload, route, and app tests.

### Task 4: Verification and delivery

**Files:**
- Verify all modified files.

- [x] Run focused tests, full API tests, workspace typecheck, and real PostgreSQL schema/repository/routes tests.
- [x] Run `git diff --check`, audit every requested semantic, and commit exactly `fix: complete studio upload response lifecycle`.
