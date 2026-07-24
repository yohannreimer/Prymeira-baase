# Baase GlitchTip Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-preserving GlitchTip error and 1% performance monitoring to the already-running Baase web and API services without changing product behavior or making Baase depend on GlitchTip.

**Architecture:** The React and Fastify applications use Sentry-compatible SDKs pointed at separate GlitchTip projects. Runtime DSNs and release values come from the existing Portainer/runtime-config path. A shared pure sanitizer removes user and business data before every event. The API reports only unexpected failures and initializes monitoring before Fastify loads. The exact frontend build uploaded to GHCR receives injected debug IDs, uploads hidden source maps during CI, then omits `.map` files from the runtime image.

**Tech Stack:** React 19, Vite 7, Fastify 5, Node.js 22, TypeScript, Vitest, `@sentry/react@10.68.0`, `@sentry/node@10.68.0`, GlitchTip CLI 1.0.0, Docker BuildKit, GitHub Actions, Docker Swarm/Portainer

---

## Production safety invariants

- Baase is already live at `https://baase.prymeiradigital.com.br`; this is an incremental rollout.
- The current PostgreSQL, MinIO, Clerk, Traefik, healthcheck, and readiness behavior must not change.
- Monitoring is disabled when a DSN is absent, so the same code remains safe in development, tests, and rollback scenarios.
- SDK network failures never fail or delay an HTTP response.
- No public diagnostic HTTP endpoint is added.
- Expected `4xx`, `ApiError`, validation, authentication, authorization, conflicts, and payload-size failures are not captured.
- `sendDefaultPii` and session tracking remain false; Replay and log ingestion packages are not installed.
- Source-map authentication tokens exist only as a GitHub Actions secret and BuildKit secret mount.
- The production image tag is the exact Git SHA. `latest` is no longer a production fallback.
- The prior live image SHA is recorded before any Portainer update.
- The observability platform must pass its acceptance gate before this plan touches the Baase production stack.

## Task 1: Record the live production baseline and add SDK dependencies

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/glitchtip-rollout.md`

- [ ] **Step 1: Record the live stack before editing**

On `manager01`, record read-only evidence in the rollout notes:

```bash
docker service inspect prymeira_baase_prymeira_baase_web \
  --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
docker service inspect prymeira_baase_prymeira_baase_api \
  --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
docker service ps prymeira_baase_prymeira_baase_web --no-trunc
docker service ps prymeira_baase_prymeira_baase_api --no-trunc
curl --fail --show-error https://baase.prymeiradigital.com.br/health
curl --fail --show-error https://baase.prymeiradigital.com.br/api/health
curl --fail --show-error https://baase.prymeiradigital.com.br/api/readiness
```

Store only image digests, status, timestamp, and health result. Do not copy container environment or secrets.

- [ ] **Step 2: Create the rollout runbook shell**

Create `docs/glitchtip-rollout.md` with sections:

- preconditions;
- live image baseline;
- GlitchTip project/DSN setup;
- GitHub source-map token setup;
- staging verification;
- production rollout;
- synthetic verification;
- rollback;
- 24-hour observation.

State that the GlitchTip platform plan must be complete first.

- [ ] **Step 3: Add pinned-compatible SDK dependencies**

Run:

```bash
pnpm --filter @prymeira/baase-web add @sentry/react@10.68.0
pnpm --filter @prymeira/baase-api add @sentry/node@10.68.0
```

Expected: both package manifests and `pnpm-lock.yaml` change; no Replay package appears.

- [ ] **Step 4: Verify the dependency graph**

```bash
pnpm --filter @prymeira/baase-web list @sentry/react
pnpm --filter @prymeira/baase-api list @sentry/node
pnpm install --frozen-lockfile
```

Expected: version `10.68.0` for both SDKs and a frozen install succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/api/package.json pnpm-lock.yaml docs/glitchtip-rollout.md
git commit -m "chore: add GlitchTip-compatible SDK dependencies"
```

## Task 2: Create and test the shared privacy boundary

**Files:**

- Create: `packages/shared/src/observability.ts`
- Create: `packages/shared/src/observability.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing sanitizer tests**

Create tests around a fixture containing:

- `user.id`, `user.email`, `user.username`;
- request authorization/cookie headers, cookies, query string, body and fragment;
- `extra` with workspace, customer, prompt, transcript, PDF and API keys;
- breadcrumbs containing click text, fetch bodies and console content;
- contexts containing private values;
- tags containing employee/workspace values;
- transaction paths containing UUIDs, numeric IDs and query strings;
- exception type/value/stack trace;
- runtime/browser/os context;
- release and environment.

Assert the sanitized event:

- preserves only release, environment, exception, safe platform context and allowlisted technical tags;
- drops `user`, request headers/cookies/data/query, `extra`, breadcrumbs and attachments;
- strips query/hash from URLs;
- replaces numeric, UUID and long opaque path segments with `:id`;
- removes span data and normalizes span descriptions;
- does not mutate the original event;
- serializes without any fixture secret or personal value.

Run:

```bash
pnpm --filter @prymeira/baase-shared test -- observability.test.ts
```

Expected: failure because the module does not exist.

- [ ] **Step 2: Implement a framework-neutral sanitizer**

Export:

```ts
export type ObservabilityEvent = Record<string, unknown>;

export function sanitizeObservabilityEvent(event: ObservabilityEvent): ObservabilityEvent;
export function normalizeObservabilityPath(value: string): string;
```

Implementation rules:

1. Construct a new object; never recursively copy arbitrary input.
2. Allowlist top-level keys:
   `event_id`, `timestamp`, `platform`, `level`, `logger`, `server_name`,
   `release`, `environment`, `dist`, `exception`, `message`, `transaction`,
   `request`, `contexts`, `tags`, `spans`, `start_timestamp`.
3. `request` may contain only uppercase method and a URL with query/hash removed and path normalized.
4. `contexts` may contain only `browser`, `os`, `runtime`, `device` and `trace`;
   within those contexts allow only primitive technical values and remove IDs/names.
5. `tags` may contain only `product`, `service`, `component` and `runtime`.
6. Drop user, breadcrumbs, extra, modules, fingerprint overrides, attachments,
   request headers, cookies, query string and data.
7. Preserve exception type/value/stacktrace but drop exception mechanism data.
8. For spans preserve timestamps, operation and status; normalize descriptions and drop `data`.
9. Normalize UUID, ULID, all-numeric, e-mail-like and opaque segments longer than 24 characters to `:id`.
10. Limit strings to 500 characters, except stack traces.

- [ ] **Step 3: Export and verify**

Add:

```ts
export * from "./observability";
```

to `packages/shared/src/index.ts`.

Run:

```bash
pnpm --filter @prymeira/baase-shared test
pnpm --filter @prymeira/baase-shared typecheck
```

Expected: all shared tests and typecheck pass.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src
git commit -m "feat: add shared observability privacy sanitizer"
```

## Task 3: Add tested runtime monitoring configuration to the React app

**Files:**

- Create: `apps/web/src/monitoring/config.ts`
- Create: `apps/web/src/monitoring/config.test.ts`
- Create: `apps/web/src/monitoring/client.ts`
- Create: `apps/web/src/monitoring/client.test.ts`
- Modify: `apps/web/src/vite-env.d.ts`
- Modify: `apps/web/public/baase-runtime-config.js`
- Modify: `apps/web/docker-entrypoint.d/10-baase-runtime-config.sh`
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Write failing configuration tests**

Test `readWebMonitoringConfig(buildEnv, runtimeEnv, isProductionBuild)`:

- absent DSN produces `enabled: false`;
- test/development produces `enabled: false` even with a DSN;
- runtime values override build-time values;
- whitespace is trimmed;
- invalid DSN or sample rate outside `0..1` disables monitoring;
- production defaults to `environment: "production"` and `tracesSampleRate: 0.01`;
- `"0"` is accepted for the emergency performance-off path;
- release is required when monitoring is enabled.

The result type must be:

```ts
type WebMonitoringConfig = {
  enabled: boolean;
  dsn: string | null;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
};
```

- [ ] **Step 2: Implement `config.ts` and run tests**

Read:

- `VITE_GLITCHTIP_DSN`;
- `VITE_BAASE_ENVIRONMENT`;
- `VITE_BAASE_RELEASE`;
- `VITE_GLITCHTIP_TRACES_SAMPLE_RATE`.

Accept only HTTPS DSNs whose URL has a username/public key and numeric project path. Do not restrict hostname so development can use a local GlitchTip instance.

Run:

```bash
pnpm --filter @prymeira/baase-web test -- config.test.ts
```

- [ ] **Step 3: Write failing SDK initialization tests**

Inject a narrow SDK adapter into `initializeWebMonitoring(config, sdk)` and assert:

- disabled config never calls `init`;
- enabled config calls once with DSN, environment, release and sample rate;
- `sendDefaultPii: false`;
- `autoSessionTracking: false`;
- `maxBreadcrumbs: 0`;
- `transportOptions.bufferSize: 10`;
- `beforeSend` and `beforeSendTransaction` call the shared sanitizer;
- Replay and logs integrations are absent.

- [ ] **Step 4: Implement the client adapter**

`client.ts` imports `@sentry/react`, calls `Sentry.init`, and exports:

```ts
export function initializeWebMonitoring(): boolean;
export { Sentry as WebMonitoring };
```

Initialization happens only once and catches its own initialization error so rendering continues.

- [ ] **Step 5: Extend runtime config files**

Add the four variables to:

- `ImportMetaEnv`;
- `window.__BAASE_RUNTIME_CONFIG__`;
- the public empty bootstrap object;
- the nginx entrypoint-generated object;
- `apps/web/.env.example`.

The shell script must continue to JSON-escape every value. Defaults:

```dotenv
VITE_GLITCHTIP_DSN=
VITE_BAASE_ENVIRONMENT=development
VITE_BAASE_RELEASE=local
VITE_GLITCHTIP_TRACES_SAMPLE_RATE=0
```

Production values are supplied by `docker-compose.prod.yml`, not baked into this example.

- [ ] **Step 6: Verify**

```bash
pnpm --filter @prymeira/baase-web test
pnpm --filter @prymeira/baase-web typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/monitoring apps/web/src/vite-env.d.ts apps/web/public/baase-runtime-config.js apps/web/docker-entrypoint.d/10-baase-runtime-config.sh apps/web/.env.example
git commit -m "feat: configure privacy-safe web monitoring"
```

## Task 4: Initialize web monitoring before React and add a safe Error Boundary

**Files:**

- Create: `apps/web/src/monitoring/MonitoringErrorBoundary.tsx`
- Create: `apps/web/src/monitoring/MonitoringErrorBoundary.test.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Write the failing boundary tests**

Render a child that throws and assert:

- the fallback has `role="alert"`;
- it shows a neutral Portuguese message without exception details;
- a reload button calls `window.location.reload`;
- the thrown error is captured once when monitoring is enabled;
- no employee/workspace/user value is passed as context.

- [ ] **Step 2: Implement the boundary**

Wrap `Sentry.ErrorBoundary` in `MonitoringErrorBoundary`. Use this fallback copy:

```text
Não foi possível exibir esta tela.
Recarregue a página. Se o problema continuar, tente novamente em alguns minutos.
```

Button label: `Recarregar página`.

Do not show an event ID or feedback form.

- [ ] **Step 3: Initialize before mounting**

Change `main.tsx` so:

```tsx
initializeWebMonitoring();

createRoot(...).render(
  <StrictMode>
    <MonitoringErrorBoundary>
      <BaaseAuthRoot>
        <App />
      </BaaseAuthRoot>
    </MonitoringErrorBoundary>
  </StrictMode>
);
```

The SDK automatically handles uncaught exceptions and unhandled promise rejections; do not register duplicate global listeners.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @prymeira/baase-web test
pnpm --filter @prymeira/baase-web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/main.tsx apps/web/src/monitoring/MonitoringErrorBoundary*
git commit -m "feat: capture unexpected React failures"
```

## Task 5: Initialize and test the Fastify monitoring adapter

**Files:**

- Create: `apps/api/src/observability/config.ts`
- Create: `apps/api/src/observability/config.test.ts`
- Create: `apps/api/src/observability/instrumentation.ts`
- Create: `apps/api/src/observability/reporter.ts`
- Create: `apps/api/src/observability/reporter.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/Dockerfile`

- [ ] **Step 1: Write failing API configuration tests**

Test these environment variables:

- `SENTRY_DSN`;
- `SENTRY_ENVIRONMENT`;
- `SENTRY_RELEASE`;
- `SENTRY_TRACES_SAMPLE_RATE`;
- `NODE_ENV`.

Use the same validation rules as the web config. Monitoring requires production, valid DSN and release. Trace rate defaults to `0.01` in production and accepts `0`.

- [ ] **Step 2: Implement configuration**

Export a pure `readApiMonitoringConfig(env)` and its result type. Do not read request data.

- [ ] **Step 3: Write failing reporter tests**

Inject an SDK adapter and assert:

- `init` receives `sendDefaultPii: false`, `autoSessionTracking: false`,
  `maxBreadcrumbs: 0`, `transportOptions.bufferSize: 10`;
- `beforeSend` and `beforeSendTransaction` use the shared sanitizer;
- `captureUnexpectedError` adds only normalized `route`, `method`, `component`
  and safe maintenance operation tags;
- arbitrary context objects cannot be passed through;
- `flush(2000)` is bounded;
- all adapter functions catch SDK failures.

- [ ] **Step 4: Implement instrumentation and reporter**

`instrumentation.ts` must call `Sentry.init()` at module evaluation time. It is preloaded before `server.ts` so Fastify/OpenTelemetry instrumentation can patch imports.

Use `registerEsmLoaderHooks: true` when enabled. Export the reporter operations
from `reporter.ts`:

```ts
export type UnexpectedErrorContext = {
  component: "http" | "startup" | "shutdown" | "maintenance";
  method?: string;
  route?: string;
  operation?: string;
};

export function captureUnexpectedError(error: unknown, context: UnexpectedErrorContext): void;
export function flushMonitoring(timeoutMs?: number): Promise<boolean>;
```

Never attach a Fastify request, headers, body, user, workspace or arbitrary object.

- [ ] **Step 5: Preload instrumentation in production commands**

Add:

```json
"start": "node --import tsx --import ./src/observability/instrumentation.ts ./src/server.ts",
"studio:maintenance": "node --import tsx --import ./src/observability/instrumentation.ts ./src/jobs/run-studio-maintenance.ts"
```

Keep the existing development watch command unchanged.

Change the Docker command to:

```dockerfile
CMD ["pnpm", "--filter", "@prymeira/baase-api", "start"]
```

- [ ] **Step 6: Update API env example**

Add disabled local defaults:

```dotenv
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=local
SENTRY_TRACES_SAMPLE_RATE=0
```

- [ ] **Step 7: Verify**

```bash
pnpm --filter @prymeira/baase-api test
pnpm --filter @prymeira/baase-api typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/observability apps/api/package.json apps/api/.env.example apps/api/Dockerfile
git commit -m "feat: initialize privacy-safe API monitoring"
```

## Task 6: Capture only unexpected API and maintenance failures

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/modules/studio/studio-asset-maintenance-runner.ts`
- Modify: `apps/api/src/modules/studio/studio-asset-maintenance-runner.test.ts`

- [ ] **Step 1: Add failing error-handler tests**

Extend `BuildAppOptions` with an injectable:

```ts
reportUnexpectedError?: (
  error: unknown,
  context: UnexpectedErrorContext
) => void;
```

Create a test-only route plugin through existing `buildApp` test facilities that throws. Assert:

- an unexpected error returns the unchanged generic `500` response and reports once;
- context contains only `{ component: "http", method, route }`;
- `ApiError`, Zod validation, auth `401/403`, conflict `409`, payload `413`,
  explicit expected `4xx`, and AI provider `503` report zero times;
- a reporter that throws does not alter the HTTP response.

- [ ] **Step 2: Capture immediately before the generic 500**

Preserve the current branch order in `setErrorHandler`. Immediately before the final `500`, call the injected reporter or `captureUnexpectedError`.

Use `request.routeOptions.url`, never `request.url`, so query strings and concrete IDs are not captured.

- [ ] **Step 3: Add failing maintenance reporter tests**

Add an optional callback:

```ts
reportUnexpectedError?: (error: unknown, operation: string) => void;
```

to the maintenance runner. Assert every existing `reportError` path:

- still logs through the existing logger;
- reports once with a fixed operation string;
- keeps scheduling if the monitoring callback throws;
- never sends processor results or file paths.

- [ ] **Step 4: Wire maintenance and process lifecycle**

In `server.ts`:

- pass a maintenance callback that maps operation to
  `{ component: "maintenance", operation }`;
- on startup catch, capture with `{ component: "startup" }`, flush for 2 seconds,
  then retain the existing log and exit behavior;
- during graceful shutdown, close app/pool, flush for 2 seconds, and never block
  indefinitely;
- if shutdown itself fails, capture with `{ component: "shutdown" }`, log, then exit non-zero.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @prymeira/baase-api test
pnpm --filter @prymeira/baase-api typecheck
```

Expected: all existing API behavior tests still pass in addition to the new observability tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/server.ts apps/api/src/modules/studio/studio-asset-maintenance-runner*
git commit -m "feat: report unexpected API and maintenance failures"
```

## Task 7: Add immutable runtime configuration to the production stack

**Files:**

- Modify: `docker-compose.prod.yml`
- Modify: `.env.production.example`
- Modify: `apps/api/src/config/production-compose.test.ts`
- Modify: `README.md`
- Modify: `docs/glitchtip-rollout.md`

- [ ] **Step 1: Write failing production compose contract tests**

Extend the existing service-block test pattern. Assert:

- API receives `SENTRY_DSN`, environment, release and sample rate;
- web receives the four `VITE_` runtime values;
- web and API DSNs are separate operator inputs;
- `BAASE_IMAGE_TAG` is required and has no `latest` fallback;
- environment is `production`;
- both releases equal `${BAASE_IMAGE_TAG}`;
- default sample rate is `0.01`;
- no GlitchTip admin token or source-map auth token enters either runtime service;
- PostgreSQL, MinIO and bootstrap services receive no observability DSN;
- existing storage/network/health contracts remain unchanged.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
pnpm --filter @prymeira/baase-api test -- production-compose.test.ts
```

- [ ] **Step 3: Update compose safely**

Change both image references to:

```yaml
image: ghcr.io/yohannreimer/prymeira-baase-api:${BAASE_IMAGE_TAG:?BAASE_IMAGE_TAG_must_be_a_Git_SHA}
image: ghcr.io/yohannreimer/prymeira-baase-web:${BAASE_IMAGE_TAG:?BAASE_IMAGE_TAG_must_be_a_Git_SHA}
```

Add to API:

```yaml
SENTRY_DSN: ${BAASE_API_GLITCHTIP_DSN:-}
SENTRY_ENVIRONMENT: production
SENTRY_RELEASE: ${BAASE_IMAGE_TAG}
SENTRY_TRACES_SAMPLE_RATE: ${BAASE_GLITCHTIP_TRACES_SAMPLE_RATE:-0.01}
```

Add to web:

```yaml
VITE_GLITCHTIP_DSN: ${BAASE_WEB_GLITCHTIP_DSN:-}
VITE_BAASE_ENVIRONMENT: production
VITE_BAASE_RELEASE: ${BAASE_IMAGE_TAG}
VITE_GLITCHTIP_TRACES_SAMPLE_RATE: ${BAASE_GLITCHTIP_TRACES_SAMPLE_RATE:-0.01}
```

- [ ] **Step 4: Update operator documentation**

Add to `.env.production.example`:

```dotenv
BAASE_IMAGE_TAG=full_40_character_git_sha
BAASE_WEB_GLITCHTIP_DSN=
BAASE_API_GLITCHTIP_DSN=
BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0.01
```

README/runbook must explain:

- DSNs come from `baase-web` and `baase-api`;
- browser DSN is public ingestion configuration, not an admin token;
- `BAASE_IMAGE_TAG` must equal the commit built by GitHub Actions;
- setting both DSNs empty disables monitoring;
- setting sample rate `0` disables performance while retaining errors.

- [ ] **Step 5: Verify existing and new stack contracts**

```bash
pnpm --filter @prymeira/baase-api test -- production-compose.test.ts
pnpm --filter @prymeira/baase-api typecheck
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.prod.yml .env.production.example apps/api/src/config/production-compose.test.ts README.md docs/glitchtip-rollout.md
git commit -m "feat: configure GlitchTip in production stack"
```

## Task 8: Produce and upload exact frontend source maps securely

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/Dockerfile`
- Modify: `.github/workflows/publish-images.yml`
- Create: `apps/api/src/config/source-map-build.test.ts`
- Modify: `docs/glitchtip-rollout.md`

- [ ] **Step 1: Write failing build-contract tests**

The test must assert:

- Vite emits hidden source maps;
- Dockerfile pins GlitchTip CLI `v1.0.0`;
- the Linux x86-64 binary SHA-256 is
  `de1c035aa61931a6265d7b29b1614781dfee925466142a907508cb097082dfef`;
- the CLI injects and uploads from `/app/apps/web/dist`;
- upload uses organization `prymeira`, project `baase-web`, and the build release;
- auth token is read from `/run/secrets/glitchtip_auth_token`;
- `.map` files are deleted before the nginx stage;
- workflow passes `${{ github.sha }}` as `VITE_BAASE_RELEASE`;
- workflow uses GitHub secret `GLITCHTIP_AUTH_TOKEN`;
- workflow never prints or persists the token.

- [ ] **Step 2: Enable hidden source maps**

Set:

```ts
build: {
  sourcemap: "hidden"
}
```

in Vite config. Hidden maps must not have a public `sourceMappingURL`.

- [ ] **Step 3: Extend the exact Docker build**

Add Dockerfile syntax `docker/dockerfile:1.7` and build args:

```dockerfile
ARG VITE_BAASE_RELEASE=local
ARG GLITCHTIP_SOURCEMAPS_UPLOAD=false
ENV VITE_BAASE_RELEASE=$VITE_BAASE_RELEASE
```

After Vite build, conditionally:

1. download the official GlitchTip CLI 1.0.0 Linux x86-64 artifact;
2. verify the exact SHA-256 above;
3. read the auth token only from the BuildKit secret mount;
4. run:

   ```bash
   glitchtip-cli sourcemaps inject /app/apps/web/dist
   glitchtip-cli sourcemaps upload /app/apps/web/dist \
     --release "$VITE_BAASE_RELEASE" \
     --org prymeira \
     --project baase-web
   ```

5. use `SENTRY_URL=https://glitchtip.prymeiradigital.com.br`;
6. delete all `.map` files after successful upload and before copying into nginx.

If `GLITCHTIP_SOURCEMAPS_UPLOAD=true`, a missing/empty secret or failed upload must fail the image build. If false, local builds must succeed without a secret.

- [ ] **Step 4: Update GitHub Actions**

Extend the matrix:

```yaml
- name: api
  sourcemaps: "false"
- name: web
  sourcemaps: "true"
```

Pass:

```yaml
build-args: |
  VITE_BAASE_RELEASE=${{ github.sha }}
  GLITCHTIP_SOURCEMAPS_UPLOAD=${{ matrix.sourcemaps }}
secrets: |
  glitchtip_auth_token=${{ secrets.GLITCHTIP_AUTH_TOKEN }}
```

Retain both existing GHCR tags during the transition, but production compose may use only the SHA tag. The mutable tag is convenience metadata, not a deploy input.

- [ ] **Step 5: Document token bootstrap**

In GlitchTip, create a least-privilege API token able to create releases and upload files for `prymeira/baase-web`. Save it as GitHub Actions repository secret `GLITCHTIP_AUTH_TOKEN`. Do not put it in Portainer.

- [ ] **Step 6: Verify locally without uploading**

```bash
pnpm --filter @prymeira/baase-api test -- source-map-build.test.ts
pnpm --filter @prymeira/baase-web build
find apps/web/dist -name '*.map' -print
docker build --build-arg GLITCHTIP_SOURCEMAPS_UPLOAD=false -f apps/web/Dockerfile .
```

Expected: tests pass, local Vite produces hidden maps for inspection, and local Docker build succeeds without a token.

- [ ] **Step 7: Commit**

```bash
git add apps/web/vite.config.ts apps/web/Dockerfile .github/workflows/publish-images.yml apps/api/src/config/source-map-build.test.ts docs/glitchtip-rollout.md
git commit -m "feat: upload private web source maps to GlitchTip"
```

## Task 9: Run the complete non-production verification gate

**Files:**

- Verify all changed files

- [ ] **Step 1: Run the complete suite**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Validate production compose with disabled DSNs**

```bash
export BAASE_IMAGE_TAG=0000000000000000000000000000000000000000
export BAASE_POSTGRES_PASSWORD=validation_only
export BAASE_MINIO_ACCESS_KEY=validation_only
export BAASE_MINIO_SECRET_KEY=validation_only_123
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_validation
export OPENAI_API_KEY=validation_only
export DEEPGRAM_API_KEY=validation_only
export BAASE_WEB_GLITCHTIP_DSN=
export BAASE_API_GLITCHTIP_DSN=
docker stack config --compose-file docker-compose.prod.yml >/dev/null
```

Expected: stack renders, proving observability remains optional.

- [ ] **Step 3: Scan for forbidden data and packages**

```bash
rg -n '(GLITCHTIP_AUTH_TOKEN=|ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,}|Authorization: Bearer)' .
rg -n '@sentry/replay|replayIntegration|enableLogs|sendDefaultPii:\\s*true' apps packages
```

Expected: no secret, Replay, logs, or PII-enabling match.

- [ ] **Step 4: Review the diff against live invariants**

Specifically confirm no accidental change to:

- database volume names;
- MinIO volume/network/credentials;
- API/web service names;
- Traefik host/router;
- health/readiness URLs;
- Clerk configuration;
- resource limits;
- manager placement.

## Task 10: Publish the SHA images before changing Portainer

**Files:**

- GitHub Actions execution only

- [ ] **Step 1: Push the reviewed branch and open a PR**

Do not merge until the GlitchTip URL, projects and GitHub source-map token exist.

- [ ] **Step 2: Let CI verify the branch**

Run all repository-required checks. If the current workflow publishes only from `main`, do not alter production yet.

- [ ] **Step 3: Merge only after approval**

After merge, wait for `Publish Baase Docker Images` to finish. Record:

- merged Git SHA;
- API image digest;
- web image digest;
- successful source-map upload log without token output.

- [ ] **Step 4: Verify GHCR artifacts**

```bash
docker buildx imagetools inspect ghcr.io/yohannreimer/prymeira-baase-api:$BAASE_RELEASE_SHA
docker buildx imagetools inspect ghcr.io/yohannreimer/prymeira-baase-web:$BAASE_RELEASE_SHA
```

Set `BAASE_RELEASE_SHA` to the exact merged 40-character SHA in the operator shell; do not infer it from `latest`.

## Task 11: Roll out to production with rollback isolation

**Files:**

- Portainer environment and stack execution only

- [ ] **Step 1: Reconfirm the baseline**

Repeat Task 1 health and image commands. Stop if the live image or stack changed unexpectedly since baseline capture.

- [ ] **Step 2: Add configuration without deploying**

In Portainer set:

- `BAASE_IMAGE_TAG` to the merged 40-character SHA;
- `BAASE_WEB_GLITCHTIP_DSN` from project `baase-web`;
- `BAASE_API_GLITCHTIP_DSN` from project `baase-api`;
- `BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0.01`.

Confirm neither DSN was pasted into GitHub, docs, chat logs, or screenshots.

- [ ] **Step 3: Pull and inspect exact images**

Verify the SHA tags exist before pressing update. Keep the prior web/API image references in the rollout runbook.

- [ ] **Step 4: Update the Portainer stack**

Deploy the reviewed `main` stack. Watch tasks:

```bash
docker service ps prymeira_baase_prymeira_baase_api --no-trunc
docker service ps prymeira_baase_prymeira_baase_web --no-trunc
docker service logs --since 10m prymeira_baase_prymeira_baase_api
```

- [ ] **Step 5: Run immediate smoke checks**

```bash
curl --fail --show-error https://baase.prymeiradigital.com.br/health
curl --fail --show-error https://baase.prymeiradigital.com.br/api/health
curl --fail --show-error https://baase.prymeiradigital.com.br/api/readiness
```

Then verify login and one normal owner workflow without creating an error.

- [ ] **Step 6: Roll back immediately on product regression**

If health, login, key product flow, latency, or container stability regresses:

1. remove both DSNs first and redeploy the same SHA;
2. if regression remains, restore the prior exact image tag;
3. preserve all database and MinIO volumes;
4. confirm health and login;
5. leave GlitchTip running independently for diagnosis.

## Task 12: Prove both projects, privacy, source maps, and failure isolation

**Files:**

- Operational verification only

- [ ] **Step 1: Send a real API SDK event without adding an HTTP endpoint**

On `manager01`, locate the active API container and run the existing preloaded instrumentation in-process:

```bash
BAASE_API_CONTAINER_ID=$(docker ps --filter name=prymeira_baase_api -q | head -n 1)
test -n "$BAASE_API_CONTAINER_ID"
docker exec "$BAASE_API_CONTAINER_ID" sh -lc \
  'pnpm --filter @prymeira/baase-api exec node --import tsx --import ./src/observability/instrumentation.ts --input-type=module -e "const reporter = await import(\"./src/observability/reporter.ts\"); reporter.captureUnexpectedError(new Error(\"Baase API GlitchTip rollout verification\"), { component: \"startup\" }); await reporter.flushMonitoring(2000);"'
```

Expected: one sanitized event in `baase-api`, release equals deployed SHA, no user/request/business content.

- [ ] **Step 2: Send a browser event**

In a controlled owner browser session, open DevTools on Baase and execute:

```js
setTimeout(() => {
  throw new Error("Baase web GlitchTip rollout verification");
}, 0);
```

Expected: normal page operation continues and one event appears in `baase-web`.

- [ ] **Step 3: Verify source maps**

Open the frontend event in GlitchTip. Confirm:

- release equals the deployed SHA;
- stack frames resolve to TypeScript/TSX source names and lines;
- `.map` files are not publicly fetchable from the Baase nginx origin.

- [ ] **Step 4: Inspect privacy**

For both events search every event section for:

- employee name/e-mail/ID;
- workspace/customer ID;
- authorization/cookie;
- query/body;
- prompt/transcript/memory;
- PDF/document content;
- OpenAI, Deepgram, MinIO, Clerk or Evolution keys.

Expected: none are present. If any appear, set both DSNs empty and redeploy before continuing.

- [ ] **Step 5: Verify expected errors are absent**

Exercise normal unauthenticated, forbidden, validation and not-found requests. Confirm they retain existing status/body behavior and do not create GlitchTip issues.

- [ ] **Step 6: Verify GlitchTip outage isolation**

Temporarily set both DSNs to an unroutable HTTPS host in a non-production local run or an isolated canary container, never the live stack. Run health and representative requests and confirm response status/latency remain acceptable. Restore empty/local config afterward.

Do not intentionally break production DNS or stop the production GlitchTip service for this test.

- [ ] **Step 7: Verify WhatsApp alert**

Allow the synthetic issues through the configured alert rule. Confirm GlitchTip → n8n → Evolution → WhatsApp and verify the message contains no stack trace or customer content.

## Task 13: Observe for 24 hours and close the rollout

**Files:**

- Modify: `docs/glitchtip-rollout.md`

- [ ] **Step 1: Observe application health**

At rollout, +1 hour, and +24 hours record:

- API/web replicas and restarts;
- health/readiness;
- representative user flow;
- p95 latency if available;
- GlitchTip event/transaction counts;
- GlitchTip/PostgreSQL CPU and RAM;
- root-disk utilization.

- [ ] **Step 2: Check sampling and noise**

Confirm:

- unexpected errors are actionable;
- expected `4xx` remain absent;
- transactions are approximately 1%, not 100%;
- no duplicate frontend capture;
- alert cooldown prevents storms.

- [ ] **Step 3: Close or revert**

If all checks pass, mark the runbook rollout complete with deployed SHA and timestamp.

If volume/noise is excessive:

1. set `BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0`;
2. keep errors enabled;
3. redeploy;
4. verify the change;
5. investigate before restoring 1%.

If privacy or product behavior fails, remove both DSNs and follow rollback immediately.

## Final acceptance gate

- [ ] Existing Baase production behavior and data services remain unchanged.
- [ ] Web/API images run the same reviewed Git SHA.
- [ ] Builds and all tests pass with DSNs absent.
- [ ] `baase-web` captures render/global failures with a safe fallback.
- [ ] `baase-api` captures unexpected HTTP, startup and maintenance failures.
- [ ] Expected errors do not generate incidents.
- [ ] Shared sanitizer removes every prohibited data class.
- [ ] Errors are sampled at 100%; performance is sampled at 1%; Replay/logs are absent.
- [ ] Source maps resolve TypeScript while `.map` files are not publicly served.
- [ ] GlitchTip/n8n/Evolution failure cannot break Baase.
- [ ] WhatsApp delivery works without leaking stack traces or user content.
- [ ] Rollback to the prior exact SHA is documented and tested operationally.
