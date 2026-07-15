# Production object-storage bootstrap design

**Date:** 2026-07-15
**Status:** Approved for implementation

## Incident

The production API exits before listening because its internal S3 endpoint is
`http://prymeira_baase_minio:9000`. The underscore makes the host invalid for
MinIO's S3 API, so the lifecycle readiness request is rejected with
`InvalidRequest (invalid hostname)`. Every web request to `/api/*` then receives
502 from the reverse proxy because no API replica is available.

The deployment also has no bootstrap step for the `prymeira-baase` bucket or the
multipart lifecycle rule that the API intentionally requires. Fixing only the
hostname can therefore expose a second startup failure when the bucket or rule
has not been configured manually.

## Desired outcome

- The internal MinIO address is DNS-valid and stable.
- A fresh or existing production volume is prepared idempotently before normal
  traffic depends on it.
- Existing lifecycle rules are preserved.
- The API remains fail-closed when object storage cannot satisfy the safety
  contract, but tolerates the short race between parallel Swarm services.
- Configuration tests prevent the invalid-hostname regression.

## Deployment design

### Stable internal address

The MinIO service keeps its current service name for stack compatibility but
receives the network alias `minio`. The API and bootstrap process use
`http://minio:9000`. Documentation, production examples, and tests use the same
address.

### Dedicated bootstrap process

A one-shot `prymeira_baase_minio_bootstrap` service runs from the API image on
the internal overlay network. It uses the same explicit S3 configuration as the
API and performs these idempotent steps:

1. Wait until MinIO accepts signed S3 requests.
2. Create `prymeira-baase` only when it does not already exist.
3. Read the current lifecycle configuration.
4. If no enabled rule already aborts incomplete multipart uploads for
   `workspaces/` within one day, append a named Baase rule.
5. Write the merged configuration, preserving every unrelated existing rule.
6. Read the lifecycle configuration again and validate the same predicate used
   by the runtime.

The bootstrap exits successfully after verification. Re-running it is safe and
does not duplicate its managed rule. It must never delete bucket contents or
replace unrelated lifecycle policy.

The implementation uses the AWS S3 SDK already present in the API image instead
of importing a complete lifecycle document through `mc`; MinIO documents that
`mc ilm rule import` replaces all rules, which would make a generic production
bootstrap destructive to pre-existing policy.

### Startup race handling

Docker Swarm starts services concurrently and does not provide Compose-style
health dependency ordering. Production API initialization therefore retries the
existing storage readiness check for a short, bounded window with a small delay.
It listens only after the lifecycle contract passes. If the bootstrap cannot
prepare storage, the final readiness error is still fatal and the existing
restart policy remains the recovery mechanism.

Demo and pilot behavior does not change. Unit tests inject the delay so the
retry path remains deterministic and fast.

## Runtime guardrail

Production initialization validates the configured S3 endpoint hostname before
constructing the SDK client. It accepts DNS hostnames, `localhost`, and IP
addresses, while rejecting labels containing underscores or other invalid DNS
characters with an actionable error. This turns the current remote MinIO error
into an immediate local configuration error.

## Failure and observability behavior

- Invalid endpoint: fail with a dedicated configuration error naming
  `S3_ENDPOINT`.
- MinIO not ready yet: retry within the bounded startup window.
- Bucket missing: bootstrap creates it; API continues waiting.
- Lifecycle missing or unsafe: bootstrap merges the required rule; API continues
  waiting.
- Credentials or network permanently invalid: bootstrap and API fail visibly;
  the API never claims readiness.
- Existing safe rule: bootstrap performs no lifecycle write.

## Verification

- Runtime configuration test rejects the underscore hostname and accepts the
  `minio` alias.
- Bootstrap unit tests cover fresh bucket, existing bucket, safe existing rule,
  rule merge without data loss, idempotency, and verification failure.
- Initialization tests cover retry success, retry exhaustion, and no retry for
  in-memory modes.
- Compose/config contract test or static assertion confirms both API and
  bootstrap use `http://minio:9000` and the MinIO service exposes the alias.
- API test suite, typecheck, and production compose rendering must pass.

## Rollout

Deploy the updated stack with the rebuilt API image. The MinIO data volume and
bucket contents remain untouched. Observe the bootstrap task complete, then
confirm the API replica is healthy and `/api/me` no longer returns 502. If the
stack must be rolled back, retain the lifecycle rule: it is safe and prevents
orphaned multipart data.
