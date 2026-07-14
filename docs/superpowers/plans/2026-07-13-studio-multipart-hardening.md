# Studio Multipart Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a safe incomplete-multipart lifecycle, verify abort completion durably, and enforce an HTTP deadline without releasing upload resources while ignored storage/database operations are still running.

**Architecture:** `ObjectStorage` owns provider-neutral readiness and atomic-session inspection. The Studio route races a supervised owner promise against one deadline; when the response times out, the owner promise retains the semaphore and temporary file until late begin/attach/part work settles and is reconciled. Migration 13 already contains the durable upload ID and needs no schema change.

**Tech Stack:** TypeScript, Fastify, AWS SDK v3 S3 commands, PostgreSQL repositories, Vitest.

---

### Task 1: Storage readiness and abort inspection contracts

**Files:**
- Modify: `apps/api/src/storage/object-storage.ts`
- Modify: `apps/api/src/storage/in-memory-object-storage.ts`
- Modify: `apps/api/src/storage/object-storage.test.ts`
- Modify: `apps/api/src/storage/s3-object-storage.ts`
- Modify: `apps/api/src/storage/s3-object-storage.test.ts`

- [ ] Add failing tests for lifecycle rules that are enabled, cover `workspaces/`, and abort incomplete multipart uploads within one day; reject disabled, missing, overly broad-in-the-wrong-direction, too-long, and access-error responses with `STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED`.
- [ ] Add `ensureReady()` and `inspectAtomicUpload()` to `ObjectStorage`; memory readiness is a no-op and inspection reports active only while the matching hidden session exists.
- [ ] Implement S3 readiness with `GetBucketLifecycleConfigurationCommand` and inspection with `ListPartsCommand`; treat `NoSuchUpload` as inactive and all successful list responses as active.
- [ ] Run `pnpm --filter @prymeira/baase-api test -- src/storage/object-storage.test.ts src/storage/s3-object-storage.test.ts` and require zero failures.

### Task 2: Startup readiness gate and operations documentation

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server-initialization.ts`
- Modify: `apps/api/src/server-initialization.test.ts`
- Modify: `README.md`
- Modify: `apps/api/.env.example`

- [ ] Add failing server-initialization tests proving readiness runs before application listen/maintenance eligibility and readiness failure prevents startup.
- [ ] Create one storage adapter in `server.ts`, await `ensureObjectStorageReady(storage)` before building/listening, and propagate the clear lifecycle error unchanged.
- [ ] Document an enabled `workspaces/` lifecycle rule with `AbortIncompleteMultipartUpload` set to one day and note that the API validates but never mutates bucket policy.
- [ ] Run the server/config/storage focused tests and require zero failures.

### Task 3: Verified cleanup protocol

**Files:**
- Modify: `apps/api/src/modules/studio/studio-asset-upload-cleanup.ts`
- Modify: `apps/api/src/modules/studio/studio-asset-upload-cleanup.test.ts`
- Modify: `apps/api/src/storage/s3-object-storage.test.ts`

- [ ] Add failing tests where the first abort leaves an active multipart session, so cleanup persists the intent/upload ID, and the next Abort plus inspection reports inactive and completes cleanup.
- [ ] After every abort, call `inspectAtomicUpload`; throw `STUDIO_ASSET_UPLOAD_ABORT_UNCONFIRMED` while active so the existing durable retry path retains the intent.
- [ ] Verify final-key deletion and intent completion occur only after the session is confirmed inactive.
- [ ] Run cleanup and S3 command tests and require zero failures.

### Task 4: Supervised end-to-end upload deadline

**Files:**
- Modify: `apps/api/src/modules/studio/studio-asset-upload.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.test.ts`

- [ ] Add failing tests for stalled abort-ignoring begin and attach calls: the HTTP response times out at the configured deadline, the semaphore stays occupied, and late settlement attaches/aborts/reconciles without an unhandled rejection.
- [ ] Split upload spooling into an owned temporary-file handle with idempotent cleanup; keep the existing callback helper as a wrapper for current callers/tests.
- [ ] Start the controller/timer before `beginAtomicUpload`, normalize the lifecycle owner promise into a caught settlement, and race only the HTTP response against deadline/lease-loss.
- [ ] Transfer semaphore and temp-file cleanup to the owner settlement after timeout; check the signal after every late begin/attach resolution and never enter completion after abort.
- [ ] Return `503 STUDIO_ASSET_UPLOAD_BUSY` while both configured owners remain occupied.

### Task 5: Explicit multipart memory bound

**Files:**
- Modify: `apps/api/src/storage/s3-object-storage.test.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.test.ts`

- [ ] Stall one ignored `UploadPart` per concurrent upload and assert each retained `Body` is at most five MiB.
- [ ] With concurrency two, assert exactly two part buffers/temporary owners are retained and a third request returns 503.
- [ ] Resolve both parts and assert buffers, semaphores, temporary paths, and durable intents become releasable without publishing aborted objects.

### Task 6: Verification and delivery

**Files:**
- Verify all modified files.

- [ ] Run focused storage/server/Studio tests.
- [ ] Run `pnpm --filter @prymeira/baase-api test` and `pnpm typecheck`.
- [ ] Run PostgreSQL 16 schema/repository/routes tests with the local test URL.
- [ ] Run `git diff --check`, inspect the final diff, and commit exactly `fix: verify studio multipart cleanup`.
