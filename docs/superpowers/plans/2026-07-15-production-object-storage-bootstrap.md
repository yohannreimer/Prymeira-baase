# Production Object Storage Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Restore the production API by giving MinIO a valid internal hostname and making the required bucket/lifecycle setup deterministic and idempotent.

**Architecture:** Extract the lifecycle safety predicate so runtime verification and deployment bootstrap share one contract. A dedicated bootstrap job in the API image creates the bucket, merges the managed lifecycle rule, and verifies it; production API startup retries readiness for a bounded period because Swarm starts services concurrently. A hostname guard and compose contract test prevent the invalid underscore address from returning.

**Tech Stack:** TypeScript, Node.js 22, AWS SDK v3 S3 client, Vitest, Docker Compose/Swarm, MinIO

---

## File map

- Create apps/api/src/storage/s3-lifecycle-policy.ts for the shared safety predicate and managed rule.
- Create apps/api/src/storage/s3-lifecycle-policy.test.ts for policy tests.
- Modify apps/api/src/storage/s3-object-storage.ts to consume the shared predicate.
- Create apps/api/src/storage/s3-object-storage-bootstrap.ts for bucket creation and lifecycle merge.
- Create apps/api/src/storage/s3-object-storage-bootstrap.test.ts for bootstrap tests.
- Create apps/api/src/jobs/bootstrap-object-storage.ts as the one-shot entrypoint.
- Modify apps/api/package.json to expose the bootstrap command.
- Modify apps/api/src/server-initialization.ts for endpoint validation and bounded readiness retry.
- Modify apps/api/src/server-initialization.test.ts for guard and retry tests.
- Modify apps/api/src/config/runtime.test.ts for the canonical valid endpoint.
- Create apps/api/src/config/production-compose.test.ts for the production deployment contract.
- Modify docker-compose.prod.yml for the valid alias and bootstrap service.
- Modify .env.production.example, README.md, and docs/deployment-operational-migration.md for corrected configuration and rollout.

### Task 1: Share the lifecycle safety contract

**Files:**
- Create: apps/api/src/storage/s3-lifecycle-policy.ts
- Create: apps/api/src/storage/s3-lifecycle-policy.test.ts
- Modify: apps/api/src/storage/s3-object-storage.ts
- Test: apps/api/src/storage/s3-object-storage.test.ts

- [ ] **Step 1: Write the failing policy tests**

Create table-driven tests proving that an enabled one-day abort rule covering
workspaces/ or the whole bucket is safe, while disabled, tag-restricted,
wrong-prefix, or two-day rules are unsafe. Also assert the managed rule shape:

~~~ts
import { describe, expect, it } from "vitest";
import {
  BAASE_MULTIPART_LIFECYCLE_RULE_ID,
  createBaaseMultipartLifecycleRule,
  hasSafeMultipartLifecycle
} from "./s3-lifecycle-policy";

describe("S3 multipart lifecycle policy", () => {
  it("accepts an enabled one-day rule covering workspaces", () => {
    expect(hasSafeMultipartLifecycle([{
      Status: "Enabled",
      Filter: { Prefix: "workspaces/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
    }])).toBe(true);
  });

  it("rejects a rule that does not cover workspaces", () => {
    expect(hasSafeMultipartLifecycle([{
      Status: "Enabled",
      Filter: { Prefix: "other/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
    }])).toBe(false);
  });

  it("builds the stable managed rule", () => {
    expect(createBaaseMultipartLifecycleRule()).toEqual({
      ID: BAASE_MULTIPART_LIFECYCLE_RULE_ID,
      Status: "Enabled",
      Filter: { Prefix: "workspaces/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
    });
  });
});
~~~

- [ ] **Step 2: Run the policy test and verify RED**

Run:

~~~bash
pnpm --filter @prymeira/baase-api test -- src/storage/s3-lifecycle-policy.test.ts
~~~

Expected: FAIL because s3-lifecycle-policy.ts does not exist.

- [ ] **Step 3: Implement the shared predicate and managed rule**

Create the focused module:

~~~ts
import type { LifecycleRule } from "@aws-sdk/client-s3";

export const BAASE_MULTIPART_LIFECYCLE_RULE_ID =
  "baase-abort-incomplete-workspace-uploads";

export function createBaaseMultipartLifecycleRule(): LifecycleRule {
  return {
    ID: BAASE_MULTIPART_LIFECYCLE_RULE_ID,
    Status: "Enabled",
    Filter: { Prefix: "workspaces/" },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
  };
}

export function hasSafeMultipartLifecycle(
  rules: LifecycleRule[] | undefined
): boolean {
  return rules?.some((rule) => {
    if (rule.Status !== "Enabled") return false;
    const days = rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation;
    if (typeof days !== "number" || days > 1) return false;
    const prefix = unrestrictedLifecyclePrefix(rule);
    return prefix !== null && "workspaces/".startsWith(prefix);
  }) ?? false;
}
~~~

Move the existing prefix/filter inspection into the same file unchanged. Replace
the inline predicate in createS3ObjectStorage().ensureReady() with
hasSafeMultipartLifecycle(response.Rules).

- [ ] **Step 4: Run focused storage tests and verify GREEN**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/storage/s3-lifecycle-policy.test.ts src/storage/s3-object-storage.test.ts
~~~

Expected: both test files PASS.

- [ ] **Step 5: Commit the shared contract**

~~~bash
git add apps/api/src/storage/s3-lifecycle-policy.ts apps/api/src/storage/s3-lifecycle-policy.test.ts apps/api/src/storage/s3-object-storage.ts apps/api/src/storage/s3-object-storage.test.ts
git commit -m "refactor: share object storage lifecycle policy"
~~~

### Task 2: Build the idempotent storage bootstrap

**Files:**
- Create: apps/api/src/storage/s3-object-storage-bootstrap.ts
- Create: apps/api/src/storage/s3-object-storage-bootstrap.test.ts
- Create: apps/api/src/jobs/bootstrap-object-storage.ts
- Modify: apps/api/package.json

- [ ] **Step 1: Write failing bootstrap tests**

Use an injected client with send: vi.fn() and cover:

~~~ts
it("creates a missing bucket and installs the managed rule", async () => {
  await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
    bucketCreated: true,
    lifecycleUpdated: true
  });
});

it("does not write when an existing lifecycle rule is safe", async () => {
  await bootstrapS3ObjectStorage(config, client);
  expect(sentCommands.some((command) =>
    command instanceof PutBucketLifecycleConfigurationCommand
  )).toBe(false);
});

it("preserves unrelated rules while replacing its unsafe managed rule", async () => {
  await bootstrapS3ObjectStorage(config, client);
  expect(put.input.LifecycleConfiguration?.Rules).toEqual([
    unrelatedRule,
    createBaaseMultipartLifecycleRule()
  ]);
});

it("fails when post-write verification remains unsafe", async () => {
  await expect(bootstrapS3ObjectStorage(config, client))
    .rejects.toThrow("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED");
});
~~~

Add a fifth test that runs bootstrap twice against mutable fake lifecycle state
and proves there is only one managed rule.

- [ ] **Step 2: Run the bootstrap tests and verify RED**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/storage/s3-object-storage-bootstrap.test.ts
~~~

Expected: FAIL because the bootstrap module does not exist.

- [ ] **Step 3: Implement bucket creation and lifecycle merge**

Create bootstrapS3ObjectStorage(config, clientOverride?) with
HeadBucketCommand, CreateBucketCommand, GetBucketLifecycleConfigurationCommand,
and PutBucketLifecycleConfigurationCommand. Merge without destroying policy:

~~~ts
const existingRules = await readLifecycleRules(client, config.bucket);
if (!hasSafeMultipartLifecycle(existingRules)) {
  const preservedRules = existingRules.filter(
    (rule) => rule.ID !== BAASE_MULTIPART_LIFECYCLE_RULE_ID
  );
  await client.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: config.bucket,
    LifecycleConfiguration: {
      Rules: [...preservedRules, createBaaseMultipartLifecycleRule()]
    }
  }));
}

const verifiedRules = await readLifecycleRules(client, config.bucket);
if (!hasSafeMultipartLifecycle(verifiedRules)) {
  throw new Error("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED");
}
~~~

Treat HeadBucket HTTP 404, NotFound, and NoSuchBucket as missing. Treat
NoSuchLifecycleConfiguration as an empty rules list. Propagate every other
error unchanged.

- [ ] **Step 4: Add the one-shot job entrypoint**

Create apps/api/src/jobs/bootstrap-object-storage.ts:

~~~ts
import "dotenv/config";
import { readRuntimeConfig } from "../config/runtime";
import { assertRuntimeStoragePolicy } from "../server-initialization";
import { bootstrapS3ObjectStorage } from "../storage/s3-object-storage-bootstrap";

const runtimeConfig = readRuntimeConfig(process.env);
assertRuntimeStoragePolicy(runtimeConfig);
const config = runtimeConfig.objectStorage.s3;
if (!config) throw new Error("PRODUCTION_OBJECT_STORAGE_REQUIRED");

const result = await bootstrapS3ObjectStorage(config);
console.info(JSON.stringify({
  event: "object-storage-bootstrap-complete",
  ...result
}));
~~~

Expose "storage:bootstrap": "tsx src/jobs/bootstrap-object-storage.ts" in
apps/api/package.json.

- [ ] **Step 5: Run bootstrap tests and typecheck**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/storage/s3-object-storage-bootstrap.test.ts
pnpm --filter @prymeira/baase-api typecheck
~~~

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the bootstrap**

~~~bash
git add apps/api/src/storage/s3-object-storage-bootstrap.ts apps/api/src/storage/s3-object-storage-bootstrap.test.ts apps/api/src/jobs/bootstrap-object-storage.ts apps/api/package.json
git commit -m "feat: bootstrap production object storage"
~~~

### Task 3: Reject invalid endpoints and tolerate the Swarm startup race

**Files:**
- Modify: apps/api/src/server-initialization.ts
- Modify: apps/api/src/server-initialization.test.ts
- Modify: apps/api/src/config/runtime.test.ts

- [ ] **Step 1: Write failing endpoint guard tests**

~~~ts
it("rejects an S3 endpoint whose hostname contains underscores", () => {
  const config = productionS3Runtime("http://prymeira_baase_minio:9000");
  expect(() => assertRuntimeStoragePolicy(config))
    .toThrow("S3_ENDPOINT_HOSTNAME_INVALID");
});

it.each([
  "http://minio:9000",
  "http://localhost:9000",
  "http://127.0.0.1:9000",
  "https://objects.example.com"
])("accepts a valid S3 endpoint %s", (endpoint) => {
  expect(() => assertRuntimeStoragePolicy(productionS3Runtime(endpoint)))
    .not.toThrow();
});
~~~

- [ ] **Step 2: Write failing bounded-retry tests**

Inject a zero-cost sleep through storage dependencies. Assert that production
succeeds after two readiness failures, exhausts exactly the maximum attempts,
and demo memory storage checks once:

~~~ts
expect(events).toEqual([
  "storage-ready-1", "sleep-1000",
  "storage-ready-2", "sleep-1000",
  "storage-ready-3"
]);
~~~

- [ ] **Step 3: Run initialization tests and verify RED**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/server-initialization.test.ts
~~~

Expected: FAIL because the guard and retry dependencies do not exist.

- [ ] **Step 4: Implement hostname validation**

Import isIP from node:net. Parse the URL, strip IPv6 brackets, and allow IP,
localhost, or valid DNS labels:

~~~ts
function isValidS3EndpointHostname(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || isIP(hostname) !== 0) return true;
    if (hostname.length === 0 || hostname.length > 253) return false;
    return hostname.split(".").every((label) =>
      label.length > 0
      && label.length <= 63
      && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
    );
  } catch {
    return false;
  }
}
~~~

For an invalid production S3 endpoint, throw S3_ENDPOINT_HOSTNAME_INVALID before
constructing the SDK client.

- [ ] **Step 5: Implement bounded production readiness retries**

Extend dependencies with optional sleep and use 30 attempts with a one-second
delay only for production. Keep direct callers at one attempt:

~~~ts
export async function ensureObjectStorageReady(
  objectStorage: ObjectStorage,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 1);
  const sleep = options.sleep
    ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await objectStorage.ensureReady();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(options.delayMs ?? 0);
    }
  }
}
~~~

- [ ] **Step 6: Update the canonical runtime test**

Replace http://prymeira_baase_minio:9000 with http://minio:9000 in
apps/api/src/config/runtime.test.ts and its expectation.

- [ ] **Step 7: Run focused tests and typecheck**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/server-initialization.test.ts src/config/runtime.test.ts
pnpm --filter @prymeira/baase-api typecheck
~~~

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit startup hardening**

~~~bash
git add apps/api/src/server-initialization.ts apps/api/src/server-initialization.test.ts apps/api/src/config/runtime.test.ts
git commit -m "fix: harden production storage startup"
~~~

### Task 4: Correct and test the production deployment contract

**Files:**
- Modify: docker-compose.prod.yml
- Create: apps/api/src/config/production-compose.test.ts
- Modify: .env.production.example
- Modify: README.md
- Modify: docs/deployment-operational-migration.md

- [ ] **Step 1: Write the failing compose contract test**

~~~ts
const compose = readFileSync(
  resolve(import.meta.dirname, "../../../../docker-compose.prod.yml"),
  "utf8"
);

expect(compose).not.toContain("http://prymeira_baase_minio:9000");
expect(compose.match(/S3_ENDPOINT: http:\/\/minio:9000/g)).toHaveLength(2);
expect(compose).toContain("prymeira_baase_minio_bootstrap:");
expect(compose).toContain("storage:bootstrap");
expect(compose).toMatch(/aliases:\s*\n\s*- minio/);
~~~

- [ ] **Step 2: Run the compose test and verify RED**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/config/production-compose.test.ts
~~~

Expected: FAIL because compose has the invalid endpoint and no bootstrap service.

- [ ] **Step 3: Correct networking and add the bootstrap service**

Use http://minio:9000 for the API, add minio to the MinIO aliases, and add:

~~~yaml
prymeira_baase_minio_bootstrap:
  image: ghcr.io/yohannreimer/prymeira-baase-api:latest
  command: pnpm --filter @prymeira/baase-api storage:bootstrap
  networks:
    - prymeira_baase_internal
  environment:
    BAASE_RUNTIME_MODE: production
    S3_ENDPOINT: http://minio:9000
    S3_REGION: us-east-1
    S3_BUCKET: prymeira-baase
    S3_ACCESS_KEY: \${BAASE_MINIO_ACCESS_KEY}
    S3_SECRET_KEY: \${BAASE_MINIO_SECRET_KEY}
    S3_FORCE_PATH_STYLE: "true"
  deploy:
    mode: replicated
    replicas: 1
    placement:
      constraints:
        - node.role == manager
        - node.hostname == manager01
    restart_policy:
      condition: on-failure
~~~

Keep the current MinIO service name and external data volume unchanged.

- [ ] **Step 4: Update production documentation**

Change every active example to http://minio:9000. Document that bootstrap creates
the bucket, merges the one-day workspaces/ multipart rule, exits after
verification, and never requires deleting the data volume.

- [ ] **Step 5: Run deployment contract and render compose**

~~~bash
pnpm --filter @prymeira/baase-api test -- src/config/production-compose.test.ts
BAASE_POSTGRES_PASSWORD=test BAASE_MINIO_ACCESS_KEY=minio-user BAASE_MINIO_SECRET_KEY=minio-secret OPENAI_API_KEY=test DEEPGRAM_API_KEY=test VITE_CLERK_PUBLISHABLE_KEY=test docker compose -f docker-compose.prod.yml config >/tmp/baase-compose-rendered.yml
~~~

Expected: Vitest PASS and compose rendering exits 0.

- [ ] **Step 6: Commit the deployment fix**

~~~bash
git add docker-compose.prod.yml .env.production.example README.md docs/deployment-operational-migration.md apps/api/src/config/production-compose.test.ts
git commit -m "fix: bootstrap minio in production"
~~~

### Task 5: Verify the complete hotfix

**Files:**
- Modify only if verification exposes a defect in the files above.

- [ ] **Step 1: Run all API tests**

~~~bash
pnpm --filter @prymeira/baase-api test
~~~

Expected: all API tests PASS with zero failures.

- [ ] **Step 2: Run workspace typechecks**

~~~bash
pnpm --filter @prymeira/baase-shared typecheck
pnpm --filter @prymeira/baase-api typecheck
~~~

Expected: both commands exit 0.

- [ ] **Step 3: Run production deploy static checks**

~~~bash
rg -n "http://prymeira_baase_minio:9000" docker-compose.prod.yml .env.production.example README.md docs/deployment-operational-migration.md apps/api/src
rg -n "S3_ENDPOINT: http://minio:9000|prymeira_baase_minio_bootstrap|storage:bootstrap" docker-compose.prod.yml apps/api/package.json
~~~

Expected: the first command has no matches and the second finds both endpoints,
the bootstrap service, and the package command.

- [ ] **Step 4: Inspect final diff and repository state**

~~~bash
git status --short
git diff HEAD~4 --check
git log -4 --oneline
~~~

Expected: no unstaged files, no whitespace errors, and four focused implementation
commits after the design/plan commits.

- [ ] **Step 5: Provide rollout handoff**

Report the verified commands and explain that recovery requires deploying the
rebuilt API image and updated stack. Verify bootstrap completion, a running API
replica, and HTTP 200/401 rather than 502 from /api/me.
