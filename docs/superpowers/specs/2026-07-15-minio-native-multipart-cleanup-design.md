# MinIO Native Multipart Cleanup Design

**Date:** 2026-07-15

## Problem

The production stack runs MinIO `RELEASE.2025-04-22T22-12-26Z`. The current
bootstrap sends an S3 lifecycle rule containing
`AbortIncompleteMultipartUpload`. That MinIO release does not parse or support
this action in `PutBucketLifecycleConfiguration`, so the request fails with
`InvalidArgument` before the API can start.

MinIO already owns stale multipart cleanup as a server-level API setting. The
same release defaults stale upload expiry to 24 hours and periodically removes
uploads older than that threshold. Production should use this native mechanism
instead of attempting to install an unsupported bucket lifecycle action.

The Baase S3 adapter must remain usable with providers that do support the S3
lifecycle action. The fix therefore cannot remove lifecycle verification from
all deployments.

## Decision

Introduce an explicit multipart cleanup mode with two supported values:

- `lifecycle`: the default. The storage bootstrap and runtime continue to
  require an enabled S3 lifecycle rule that aborts incomplete multipart uploads
  for `workspaces/` within one day.
- `minio-native`: the production MinIO mode. The storage bootstrap creates or
  verifies the bucket but never reads or writes bucket lifecycle configuration.
  Runtime readiness verifies the bucket with `HeadBucket`.

The mode is configuration, not endpoint inference. This keeps the behavior
auditable and prevents a hostname change from silently weakening readiness.
Unknown or empty explicit values fail configuration parsing.

## Production Stack

The production compose sets the following values:

- API and bootstrap: `S3_MULTIPART_CLEANUP_MODE=minio-native`.
- MinIO: `MINIO_API_STALE_UPLOADS_EXPIRY=24h`.
- MinIO: `MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL=1h`.

The one-hour scan interval bounds the delay after an upload becomes stale while
avoiding a separate cleanup service. MinIO remains private on the internal
network and retains the existing persistent volume.

The bootstrap service remains responsible for deterministic bucket creation.
It is idempotent in both modes and returns successfully when the bucket already
exists. The API retains bounded startup retries because Docker Swarm does not
guarantee startup ordering.

## Components and Data Flow

1. Runtime configuration parses the cleanup mode, defaulting to `lifecycle`.
2. Server initialization passes the complete S3 configuration to the object
   storage adapter.
3. In `minio-native` mode, adapter readiness sends `HeadBucket` only.
4. The bootstrap uses the same mode. It creates a missing bucket and performs
   no lifecycle requests in `minio-native` mode.
5. In `lifecycle` mode, the existing lifecycle merge and verification path is
   preserved.
6. MinIO performs stale multipart cleanup internally using the explicit server
   environment settings.

## Error Handling

- Invalid cleanup mode: fail before server startup with an actionable
  configuration error.
- Missing or inaccessible bucket in `minio-native` runtime readiness: surface
  the storage readiness error and let the existing bounded retry policy handle
  temporary MinIO startup races.
- Missing bucket in bootstrap: create it; tolerate only the existing
  `BucketAlreadyOwnedByYou` race.
- Missing or unsafe lifecycle in `lifecycle` mode: retain
  `STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED`.
- Lifecycle access errors in `lifecycle` mode: remain fail-closed.

## Tests

Unit and contract tests must prove:

- configuration defaults to `lifecycle` and accepts `minio-native`;
- invalid cleanup modes are rejected;
- `minio-native` readiness sends `HeadBucket` and no lifecycle command;
- `lifecycle` readiness retains the current safety predicate;
- `minio-native` bootstrap creates a missing bucket without lifecycle reads or
  writes and is idempotent;
- `lifecycle` bootstrap retains merge, preservation, and verification behavior;
- production compose assigns `minio-native` to both API and bootstrap;
- production compose explicitly configures MinIO stale upload expiry and scan
  interval;
- MinIO and its credentials remain private from the public web service.

Focused storage/config tests, API typechecking, the complete API suite, compose
rendering, and diff checks are required before release.

## Deployment

Publish the rebuilt API image, then redeploy the updated compose stack. No MinIO
data migration or volume replacement is required. The bootstrap should finish
after bucket verification, and the API should become healthy after its normal
readiness retry window.

Rollback must restore both the prior API image and compose contract together;
mixing the prior lifecycle-only API with MinIO will reproduce the rejected XML
request.
