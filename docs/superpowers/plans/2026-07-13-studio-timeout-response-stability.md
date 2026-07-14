# Studio Timeout Response Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee a structured live HTTP timeout response for stalled multipart uploads and make post-Complete finalization coverage deterministic.

**Architecture:** The upload abort binding stops the active file stream immediately but defers raw request destruction until the server response finishes or closes. A real listening-server regression verifies wire behavior, while fake timers prove the storage deadline stays disarmed during gated durable finalization.

**Tech Stack:** TypeScript, Fastify, Node HTTP/streams, Vitest

---

### Task 1: Live response-first teardown

**Files:**
- Modify: `apps/api/src/modules/studio/studio-assets.routes.ts`
- Test: `apps/api/src/modules/studio/studio-assets.routes.test.ts`

- [x] Add a listening-server test using `node:http` that writes an incomplete chunked multipart header and does not end the request. Assert status 503, `OBJECT_STORAGE_UNAVAILABLE`, `{ upload_timeout: true }`, no client `ECONNRESET`, response completion, connection closure, and semaphore reacquisition.
- [x] Run the test against the current route and confirm it fails at the client connection boundary.
- [x] Pass the reply lifecycle into `bindMultipartReceiveAbort`. On signal abort, destroy an active file stream, register raw-request destruction on response `finish` and `close`, and never destroy the raw request before response completion.
- [x] Preserve observed owner settlement and remove every response listener in `unbind()`.
- [x] Run the live regression and existing stalled-inject regression; require both to pass without unhandled rejection output.

### Task 2: Deterministic post-Complete finalization

**Files:**
- Test: `apps/api/src/modules/studio/studio-assets.routes.test.ts`

- [x] Replace the real 30 ms sleep with `vi.useFakeTimers()` around the test.
- [x] Wrap `completeAtomicUploadFromStream` to append `complete` only after the in-memory Complete succeeds; append `finalize` when gated finalization begins.
- [x] Start upload without advancing time, await gated finalization, assert the order is `complete`, then `finalize`, advance virtual time past the 15 ms deadline, release finalization, and assert one 201 response, one finalization call, one object, and one durable asset.
- [x] Restore real timers in `finally` and run the test twenty times in isolated processes.

### Task 3: Verification and delivery

**Files:**
- Verify all modified files.

- [x] Run focused Studio route/upload tests.
- [x] Run `pnpm test`, `pnpm typecheck`, and `git diff --check`.
- [x] Commit code, tests, and this plan with exactly `test: stabilize studio upload lifecycle`.
