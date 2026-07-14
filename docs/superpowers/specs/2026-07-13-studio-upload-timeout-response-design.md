# Studio Upload Timeout Response Design

## Goal

Return the structured Studio upload timeout response over a real HTTP connection before terminating an incomplete multipart request, while retaining bounded ownership until the parser and temp pipeline settle.

## Response-first teardown

The receive/storage deadline remains the single owner deadline. When it expires, it aborts the active file-part pipeline immediately, but it does not destroy the raw request before Fastify serializes the timeout response. The receive-abort binding registers response lifecycle listeners and destroys the incomplete raw request only after the response emits `finish`. A response `close` listener provides the client-disconnect fallback. Destroying the request after either terminal response event forces a pending multipart iterator to reject, allowing temp cleanup and semaphore release without waiting for an unbounded slow body.

The route continues to normalize parser and pipeline rejection through the owner promise, so late failures are observed and cannot become unhandled rejections. The response race still returns `OBJECT_STORAGE_UNAVAILABLE` with `upload_timeout: true`.

## Deterministic finalization test

The slow-finalization regression uses fake timers from upload start. A wrapped object-storage completion records successful Complete before the repository enters a gated finalization. The test advances virtual time beyond the configured receive/storage deadline while finalization remains pending. It then releases finalization and asserts one 201 response, one finalization call, one object, and one idempotently addressable asset.

## Verification

An actual listening-server test sends a chunked multipart request that never completes its first part. It asserts a normal HTTP 503 JSON response rather than `ECONNRESET`, observes connection closure, and confirms semaphore recovery after owner settlement. The focused lifecycle test is repeated twenty times, followed by full workspace tests and typechecking.
