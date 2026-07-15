# MinIO Native Multipart Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the production MinIO bootstrap by using MinIO's native stale multipart cleanup while preserving lifecycle enforcement for generic S3 providers.

**Architecture:** Add an explicit cleanup mode to the shared S3 configuration. The default `lifecycle` path retains the existing bucket lifecycle checks; production selects `minio-native`, where runtime readiness uses `HeadBucket` and bootstrap only creates/verifies the bucket. The production compose explicitly configures MinIO's stale upload expiry and scan interval.

**Tech Stack:** TypeScript 5.8, Node.js 22, AWS SDK v3, Vitest, Docker Compose/Swarm, MinIO

---

## File Structure

- Modify `apps/api/src/config/runtime.ts`: define and parse the cleanup mode in the shared S3 configuration.
- Modify `apps/api/src/config/runtime.test.ts`: protect the default, MinIO selection, and invalid-value warning.
- Modify `apps/api/src/storage/s3-object-storage.ts`: select readiness by cleanup mode.
- Modify `apps/api/src/storage/s3-object-storage.test.ts`: prove MinIO uses `HeadBucket` only and lifecycle remains fail-closed.
- Modify `apps/api/src/modules/studio/studio-assets.routes.test.ts`: keep the direct S3 adapter fixture explicit about lifecycle mode.
- Modify `apps/api/src/storage/s3-object-storage-bootstrap.ts`: skip lifecycle operations only in native MinIO mode.
- Modify `apps/api/src/storage/s3-object-storage-bootstrap.test.ts`: prove native bootstrap creation and idempotence.
- Create `apps/api/src/jobs/bootstrap-object-storage.test.ts`: ensure the parsed mode reaches bootstrap.
- Modify `docker-compose.prod.yml`: set the cleanup mode and MinIO cleanup settings.
- Modify `apps/api/src/config/production-compose.test.ts`: enforce the compose storage contract.
- Modify `README.md` and `docs/deployment-operational-migration.md`: replace the incorrect lifecycle instructions with the native MinIO contract.

### Task 1: Parse an explicit multipart cleanup mode

**Files:**
- Modify: `apps/api/src/config/runtime.ts`
- Test: `apps/api/src/config/runtime.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Add assertions that the generic S3 default is `lifecycle`, that
`S3_MULTIPART_CLEANUP_MODE=minio-native` is preserved, and that an unsupported
explicit value makes the runtime unhealthy:

```ts
expect(config.objectStorage.s3?.multipartCleanupMode).toBe("lifecycle");

const minioConfig = readRuntimeConfig({
  S3_BUCKET: "prymeira-baase",
  S3_ACCESS_KEY: "minio-user",
  S3_SECRET_KEY: "minio-secret",
  S3_MULTIPART_CLEANUP_MODE: "minio-native"
});
expect(minioConfig.objectStorage.s3?.multipartCleanupMode).toBe("minio-native");

const invalidConfig = readRuntimeConfig({
  S3_BUCKET: "prymeira-baase",
  S3_ACCESS_KEY: "minio-user",
  S3_SECRET_KEY: "minio-secret",
  S3_MULTIPART_CLEANUP_MODE: "disabled"
});
expect(invalidConfig.ok).toBe(false);
expect(invalidConfig.warnings).toContain(
  "S3_MULTIPART_CLEANUP_MODE deve ser lifecycle ou minio-native."
);
```

Run the invalid assertion for both `"disabled"` and an explicitly empty `""`;
an absent variable is the only case that defaults silently to `lifecycle`.

- [ ] **Step 2: Run the focused test and observe the failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/config/runtime.test.ts
```

Expected: FAIL because `multipartCleanupMode` is absent and invalid values do
not produce a warning.

- [ ] **Step 3: Implement cleanup mode parsing**

Add the type and field:

```ts
export type BaaseMultipartCleanupMode = "lifecycle" | "minio-native";

export type BaaseS3Config = {
  // existing fields
  multipartCleanupMode: BaaseMultipartCleanupMode;
};
```

Parse the setting while retaining a valid runtime value for diagnostics:

```ts
function readMultipartCleanupMode(input: string | undefined): BaaseMultipartCleanupMode {
  return input?.trim() === "minio-native" ? "minio-native" : "lifecycle";
}

function hasInvalidMultipartCleanupMode(input: string | undefined): boolean {
  if (input === undefined) return false;
  const value = input.trim();
  return value !== "lifecycle" && value !== "minio-native";
}
```

Set `multipartCleanupMode` in `readS3Config` and pass the raw input into
`readRuntimeWarnings`. Append this warning when invalid:

```ts
if (hasInvalidMultipartCleanupMode(input.multipartCleanupModeInput)) {
  warnings.push("S3_MULTIPART_CLEANUP_MODE deve ser lifecycle ou minio-native.");
}
```

- [ ] **Step 4: Run the configuration tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/config/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the configuration contract**

```bash
git add apps/api/src/config/runtime.ts apps/api/src/config/runtime.test.ts
git commit -m "feat: configure multipart cleanup mode"
```

### Task 2: Make S3 readiness provider-aware

**Files:**
- Modify: `apps/api/src/storage/s3-object-storage.ts`
- Test: `apps/api/src/storage/s3-object-storage.test.ts`
- Test: `apps/api/src/modules/studio/studio-assets.routes.test.ts`

- [ ] **Step 1: Write failing native MinIO readiness tests**

Add a test with `multipartCleanupMode: "minio-native"` that records commands,
returns success for `HeadBucketCommand`, and asserts exactly one `HeadBucket`
and no `GetBucketLifecycleConfigurationCommand`:

```ts
const commands: unknown[] = [];
const storage = createS3ObjectStorage({
  ...s3Config,
  multipartCleanupMode: "minio-native"
}, {
  async send(command) {
    commands.push(command);
    if (command instanceof HeadBucketCommand) return {};
    throw new Error("unexpected command");
  }
});

await expect(storage.ensureReady()).resolves.toBeUndefined();
expect(commands).toHaveLength(1);
expect(commands[0]).toBeInstanceOf(HeadBucketCommand);
```

Add a second test that makes `HeadBucketCommand` reject with the exact error
object and asserts that the same error propagates.

- [ ] **Step 2: Run the focused readiness test and observe the failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/storage/s3-object-storage.test.ts
```

Expected: FAIL because readiness always requests lifecycle configuration.

- [ ] **Step 3: Select readiness by cleanup mode**

Update `S3ObjectStorageConfig` with the shared cleanup mode and branch at the
start of `ensureReady`:

```ts
async ensureReady() {
  if (config.multipartCleanupMode === "minio-native") {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return;
  }
  try {
    const response = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: config.bucket })
    ) as GetBucketLifecycleConfigurationCommandOutput;
    if (!hasSafeMultipartLifecycle(response.Rules)) throw multipartLifecycleRequired();
  } catch (error) {
    if (error instanceof Error && error.message === "STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED") {
      throw error;
    }
    throw multipartLifecycleRequired(error);
  }
}
```

Import `BaaseMultipartCleanupMode` as a type and use it for the config field.
Update existing test fixtures, including the direct adapter fixture in
`studio-assets.routes.test.ts`, to set `multipartCleanupMode: "lifecycle"`.

- [ ] **Step 4: Run storage readiness and initialization tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- \
  src/storage/s3-object-storage.test.ts \
  src/modules/studio/studio-assets.routes.test.ts \
  src/server-initialization.test.ts
```

Expected: PASS, including the unchanged lifecycle failure cases.

- [ ] **Step 5: Commit provider-aware readiness**

```bash
git add apps/api/src/storage/s3-object-storage.ts \
  apps/api/src/storage/s3-object-storage.test.ts \
  apps/api/src/modules/studio/studio-assets.routes.test.ts \
  apps/api/src/server-initialization.test.ts
git commit -m "fix: use native minio storage readiness"
```

### Task 3: Make object storage bootstrap provider-aware

**Files:**
- Modify: `apps/api/src/storage/s3-object-storage-bootstrap.ts`
- Test: `apps/api/src/storage/s3-object-storage-bootstrap.test.ts`
- Create: `apps/api/src/jobs/bootstrap-object-storage.test.ts`

- [ ] **Step 1: Write failing native bootstrap tests**

Add a test where the first `HeadBucketCommand` returns `NoSuchBucket`,
`CreateBucketCommand` succeeds, and any lifecycle command throws. Assert:

```ts
await expect(bootstrapS3ObjectStorage({
  ...s3Config,
  multipartCleanupMode: "minio-native"
}, client)).resolves.toEqual({
  bucketCreated: true,
  lifecycleUpdated: false
});
expect(commands.filter((command) =>
  command instanceof GetBucketLifecycleConfigurationCommand
  || command instanceof PutBucketLifecycleConfigurationCommand
)).toHaveLength(0);
```

Add an idempotence test where `HeadBucketCommand` succeeds on two runs and the
result is `{ bucketCreated: false, lifecycleUpdated: false }` both times.

Create a job test that mocks `bootstrapS3ObjectStorage`, supplies a complete
production environment with `S3_MULTIPART_CLEANUP_MODE=minio-native`, imports
`runObjectStorageBootstrap`, and asserts that the mock receives an S3 config
containing `multipartCleanupMode: "minio-native"`.

- [ ] **Step 2: Run bootstrap tests and observe the failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- \
  src/storage/s3-object-storage-bootstrap.test.ts \
  src/jobs/bootstrap-object-storage.test.ts
```

Expected: FAIL because bootstrap still requests lifecycle configuration.

- [ ] **Step 3: Skip lifecycle operations in native mode**

Return immediately after bucket creation when the explicit mode is native:

```ts
const bucketCreated = await ensureBucket(client, config.bucket);
if (config.multipartCleanupMode === "minio-native") {
  return { bucketCreated, lifecycleUpdated: false };
}
```

Leave the lifecycle merge, preservation, and post-write verification code
unchanged for `lifecycle` mode. Update all generic S3 fixtures to specify
`multipartCleanupMode: "lifecycle"`.

- [ ] **Step 4: Run all storage bootstrap tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- \
  src/storage/s3-object-storage-bootstrap.test.ts \
  src/jobs/bootstrap-object-storage.test.ts \
  src/storage/s3-lifecycle-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit native bootstrap behavior**

```bash
git add apps/api/src/storage/s3-object-storage-bootstrap.ts \
  apps/api/src/storage/s3-object-storage-bootstrap.test.ts \
  apps/api/src/jobs/bootstrap-object-storage.test.ts
git commit -m "fix: bootstrap minio without s3 lifecycle"
```

### Task 4: Protect the production MinIO contract

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `apps/api/src/config/production-compose.test.ts`
- Modify: `README.md`
- Modify: `docs/deployment-operational-migration.md`

- [ ] **Step 1: Write failing compose contract assertions**

In `expectStorageContract`, assert both application services select native mode
and the MinIO service owns both cleanup settings:

```ts
expect(api).toContain("S3_MULTIPART_CLEANUP_MODE: minio-native");
expect(bootstrap).toContain("S3_MULTIPART_CLEANUP_MODE: minio-native");
expect(minio).toContain("MINIO_API_STALE_UPLOADS_EXPIRY: 24h");
expect(minio).toContain("MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL: 1h");
```

Add mutation tests that remove one native cleanup setting or replace one
application mode with `lifecycle`, and assert `expectStorageContract` throws.

- [ ] **Step 2: Run the compose test and observe the failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/config/production-compose.test.ts
```

Expected: FAIL because the production compose lacks the native cleanup contract.

- [ ] **Step 3: Configure the stack**

Add this to both API and bootstrap environments:

```yaml
S3_MULTIPART_CLEANUP_MODE: minio-native
```

Add this to the MinIO environment:

```yaml
MINIO_API_STALE_UPLOADS_EXPIRY: 24h
MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL: 1h
```

Keep the MinIO image, volume, aliases, placement, and private network unchanged.

- [ ] **Step 4: Correct operator documentation**

Update README and the deployment runbook to state that production MinIO uses
native stale multipart cleanup, the bootstrap only creates/verifies the bucket,
and generic S3 deployments still default to lifecycle enforcement. Remove every
claim that the production bootstrap installs a MinIO lifecycle rule.

- [ ] **Step 5: Run compose and documentation contract tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/config/production-compose.test.ts
docker compose -f docker-compose.prod.yml config --quiet
```

Expected: tests PASS and compose exits 0. If Docker Compose is unavailable,
record that environmental limitation and also parse the YAML with the workspace
Node YAML dependency instead of skipping structural validation.

- [ ] **Step 6: Commit the production contract**

```bash
git add docker-compose.prod.yml apps/api/src/config/production-compose.test.ts \
  README.md docs/deployment-operational-migration.md
git commit -m "fix: configure minio native multipart cleanup"
```

### Task 5: Full verification and release

**Files:**
- Verify all files changed by Tasks 1-4.

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- \
  src/config/runtime.test.ts \
  src/storage/s3-object-storage.test.ts \
  src/storage/s3-object-storage-bootstrap.test.ts \
  src/jobs/bootstrap-object-storage.test.ts \
  src/config/production-compose.test.ts \
  src/server-initialization.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run API typechecking and the full API suite**

Run:

```bash
pnpm --filter @prymeira/baase-api typecheck
pnpm --filter @prymeira/baase-api test
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect the final patch**

Run:

```bash
git diff --check
git status --short
git diff HEAD~4 --stat
git diff HEAD~4 -- docker-compose.prod.yml \
  apps/api/src/config/runtime.ts \
  apps/api/src/storage/s3-object-storage.ts \
  apps/api/src/storage/s3-object-storage-bootstrap.ts
```

Expected: no whitespace errors, only in-scope files changed, and native mode has
no lifecycle operation.

- [ ] **Step 4: Push the verified main branch**

```bash
git push origin main
```

Expected: push succeeds and the image publishing workflow starts for the new
main commit.

- [ ] **Step 5: Redeploy and verify production**

After the API image is published, update the Portainer stack with the committed
`docker-compose.prod.yml`. Verify:

```text
prymeira_baase_minio_bootstrap -> completed successfully
prymeira_baase_api             -> running
/api/readiness                 -> 200
/api/me                        -> 200 authenticated or 401 unauthenticated, never 502
```

Do not delete `prymeira_baase_minio_data`; this fix requires no storage data
migration.
