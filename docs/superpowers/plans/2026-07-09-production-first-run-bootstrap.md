# Production First-Run Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a newly authenticated Baase owner reaches a real onboarding flow, never a dashboard populated by demonstration fallbacks.

**Architecture:** The Account Hub will enrich its existing `access-check` decision with the authenticated customer and workspace identity. Baase will convert that decision into request context and expose it through `/me`. The web client will use an explicit bootstrap state: essential inventory decides between onboarding and application, while optional data can fail independently. Deployment will consume an immutable image tag for both services.

**Tech Stack:** TypeScript, Fastify, React, Vitest, PostgreSQL, Clerk, Docker Swarm, GitHub Container Registry.

---

## File map

### Account Hub repository

- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.types.ts` — add identity fields to the access contract.
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.service.ts` — include identity only in successful decisions.
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.routes.ts` — map authenticated customer and workspace name into access evaluation.
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/demo/demo-fixtures.ts` — keep demo access contract structurally compatible.
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.routes.test.ts` — test the enriched HTTP response.
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.service.test.ts` — test successful decision identity mapping.

### Baase API repository

- Modify: `apps/api/src/http/auth-context.ts` — carry account-derived display identity in the request context.
- Modify: `apps/api/src/http/account-auth.ts` — map enriched Account Hub response and derive a customer-specific profile ID.
- Modify: `apps/api/src/modules/session/session.routes.ts` — return real workspace/customer data before company setup exists.
- Modify: `apps/api/src/app.test.ts` — cover account identity and public health/readiness behavior.

### Baase web repository

- Modify: `apps/web/src/api.ts` — split essential workspace loading from optional requests and export an explicit bootstrap loader.
- Modify: `apps/web/src/App.tsx` — render a deterministic loading/retry state, create onboarding when required, and remove production demo fallbacks.
- Modify: `apps/web/src/styles.css` — style the bootstrap loading/retry surface within the existing application language.
- Modify: `apps/web/src/api.test.ts` — cover auxiliary request failures and essential bootstrap failures.
- Modify: `apps/web/src/App.test.tsx` — cover first visit, automatic onboarding session creation, and recovery UI.

### Deployment repository files

- Modify: `docker-compose.prod.yml` — replace `latest` image references with `${BAASE_IMAGE_TAG}`.
- Modify: `.env.production.example` — document `BAASE_IMAGE_TAG`.
- Modify: `docs/deployment-vps.md` — document immutable tags and the Portainer update sequence.

## Task 1: Enrich the Account Hub access contract

**Files:**
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.types.ts`
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.service.ts`
- Test: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.service.test.ts`

- [ ] **Step 1: Add the failing access-service assertion**

  Extend the `allows active entitlement` expectation so it requires customer and workspace names:

  ```ts
  expect(result).toMatchObject({
    allowed: true,
    workspace_id: "workspace-1",
    workspace_name: "Acme Workspace",
    customer_id: "customer-1",
    customer_name: "Ada Lovelace"
  });
  ```

- [ ] **Step 2: Run the focused test and confirm failure**

  Run:

  ```bash
  pnpm --filter @prymeira/account-api test -- apps/account-api/src/modules/access/access.service.test.ts
  ```

  Expected: the assertion fails because the success decision lacks the four identity fields.

- [ ] **Step 3: Extend the access types and evaluator input**

  In `access.types.ts`, make the workspace name available to the evaluator and define a minimal customer identity:

  ```ts
  export type AccessWorkspace = {
    id: string;
    name: string;
    status: string;
    role: string;
  };

  export type AccessCustomer = {
    id: string;
    name: string | null;
  };

  export type AccessDecision = {
    allowed: boolean;
    workspace_id?: string;
    workspace_name?: string;
    customer_id?: string;
    customer_name?: string | null;
    // keep the existing fields unchanged
  };
  ```

  In `access.service.ts`, replace `hasCustomer: boolean` with `customer: AccessCustomer | null` and return identity only from `allow`:

  ```ts
  return {
    allowed: true,
    workspace_id: input.workspace!.id,
    workspace_name: input.workspace!.name,
    customer_id: input.customer!.id,
    customer_name: input.customer!.name,
    workspace_role: input.workspace!.role,
    product_key: entitlement.productKey,
    product_role: input.productSeat!.role,
    status: entitlement.status,
    plan: entitlement.plan,
    source: entitlement.source,
    seats_limit: entitlement.seatsLimit,
    limits: entitlement.limits,
    reason
  };
  ```

  Update each early guard to use `if (!input.customer)`.

- [ ] **Step 4: Run the focused test and confirm success**

  Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the isolated Hub contract change**

  ```bash
  git add apps/account-api/src/modules/access/access.types.ts \
    apps/account-api/src/modules/access/access.service.ts \
    apps/account-api/src/modules/access/access.service.test.ts
  git commit -m "feat: expose workspace identity in access decisions"
  ```

## Task 2: Return the enriched access response from the Account Hub

**Files:**
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.routes.ts`
- Modify: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/demo/demo-fixtures.ts`
- Test: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Hub — Prymeira Account/apps/account-api/src/modules/access/access.routes.test.ts`

- [ ] **Step 1: Add the failing route test**

  In the successful `access-check` test, require the API response to contain:

  ```ts
  expect(response.json()).toMatchObject({
    allowed: true,
    workspace_id: workspaceId,
    workspace_name: "User Workspace",
    customer_id: customer.id,
    customer_name: "User"
  });
  ```

- [ ] **Step 2: Run the focused route test and confirm failure**

  ```bash
  pnpm --filter @prymeira/account-api test -- apps/account-api/src/modules/access/access.routes.test.ts
  ```

  Expected: the new fields are absent.

- [ ] **Step 3: Pass customer and workspace name through the route**

  In `access.routes.ts`, replace the `hasCustomer` argument with the real identity and include workspace name in `toAccessWorkspace`:

  ```ts
  customer: customer ? { id: customer.id, name: customer.name } : null,
  ```

  ```ts
  function toAccessWorkspace(membership: WorkspaceMembershipWithWorkspace): AccessWorkspace {
    return {
      id: membership.workspace.id,
      name: membership.workspace.name,
      status: membership.workspace.status,
      role: membership.role
    };
  }
  ```

  Update `demoAccessDecision` so an allowed demo decision also carries `workspace_name`, `customer_id`, and `customer_name`; this keeps consumers from branching by runtime mode.

- [ ] **Step 4: Run Account Hub verification**

  ```bash
  pnpm --filter @prymeira/account-api test -- apps/account-api/src/modules/access/access.routes.test.ts apps/account-api/src/modules/access/access.service.test.ts
  pnpm --filter @prymeira/account-api build
  ```

  Expected: all tests and TypeScript build pass.

- [ ] **Step 5: Commit and push the Hub update**

  ```bash
  git add apps/account-api/src/modules/access/access.routes.ts \
    apps/account-api/src/modules/access/access.routes.test.ts \
    apps/account-api/src/modules/demo/demo-fixtures.ts
  git commit -m "feat: return customer identity from access check"
  git push
  ```

## Task 3: Map Account identity through the Baase API

**Files:**
- Modify: `apps/api/src/http/auth-context.ts`
- Modify: `apps/api/src/http/account-auth.ts`
- Modify: `apps/api/src/modules/session/session.routes.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] **Step 1: Add failing API tests**

  Add a production `GET /me` test whose mocked Account response includes:

  ```ts
  {
    allowed: true,
    workspace_id: "hub_workspace",
    workspace_name: "Estudio Aurora",
    customer_id: "customer_123",
    customer_name: "Yohann Reimer",
    workspace_role: "owner",
    product_key: "base",
    product_role: "admin",
    status: "active",
    reason: "active_entitlement"
  }
  ```

  Require the response to return `workspace.name === "Estudio Aurora"`, `profile.id === "account_customer_123"`, and `profile.display_name === "Yohann Reimer"`. Add `GET /health` and `GET /readiness` injections under the same account runtime and require HTTP 200 without an Authorization header.

- [ ] **Step 2: Run the API test and confirm failure**

  ```bash
  pnpm --filter @prymeira/baase-api test -- src/app.test.ts
  ```

  Expected: `/me` uses the current `Estúdio Norte`/role-derived fallback and the profile ID is `account_admin`.

- [ ] **Step 3: Extend request context and account mapping**

  In `auth-context.ts`:

  ```ts
  export type RequestContext = {
    workspaceId: string;
    role: BaaseRole;
    profileId: string;
    workspaceName?: string | null;
    profileName?: string | null;
    accountAuthenticated?: boolean;
  };
  ```

  In `account-auth.ts`, extend `AccountAccessDecision`, then build context from trusted Hub fields:

  ```ts
  return {
    workspaceId: decision.workspace_id,
    workspaceName: decision.workspace_name?.trim() || null,
    profileName: decision.customer_name?.trim() || null,
    profileId: `account_${sanitizeProfileSuffix(decision.customer_id ?? decision.product_role ?? decision.workspace_role ?? role)}`,
    role,
    accountAuthenticated: true
  };
  ```

  In `session.routes.ts`, pass `context` to profile/workspace resolution. Use `context.workspaceName` and `context.profileName` when present. For account-authenticated requests with absent names, return neutral labels `"Empresa em configuração"` and `"Usuário"`; keep legacy demo fallbacks only for local mode tests.

- [ ] **Step 4: Run API verification**

  ```bash
  pnpm --filter @prymeira/baase-api test -- src/app.test.ts src/config/runtime.test.ts
  pnpm --filter @prymeira/baase-api build
  ```

  Expected: all focused tests pass and no account-authenticated `/me` response has demo identity.

- [ ] **Step 5: Commit the Baase API identity change**

  ```bash
  git add apps/api/src/http/auth-context.ts \
    apps/api/src/http/account-auth.ts \
    apps/api/src/modules/session/session.routes.ts \
    apps/api/src/app.test.ts
  git commit -m "feat: use Account identity in Baase sessions"
  ```

## Task 4: Make the web bootstrap deterministic and fault-tolerant

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Add failing API-client tests**

  Add a test where `/api/ai/proactive-suggestions` returns HTTP 500 but all essential responses return HTTP 200. Require `loadBaaseWorkspace` to resolve with `proactiveSuggestions: []`. Add another test where `/api/areas` returns HTTP 500 and require a rejected bootstrap result.

  ```ts
  await expect(loadBaaseWorkspace("dono", "2026-07-07", fetcher)).resolves.toMatchObject({
    proactiveSuggestions: []
  });

  await expect(loadBaaseWorkspace("dono", "2026-07-07", failingAreasFetcher)).rejects.toThrow(
    "Baase API request failed: 500 /api/areas"
  );
  ```

- [ ] **Step 2: Run the failing API-client tests**

  ```bash
  pnpm --filter @prymeira/baase-web test -- src/api.test.ts
  ```

  Expected: auxiliary failure rejects the entire `Promise.all` bundle.

- [ ] **Step 3: Separate essential and optional loading in `api.ts`**

  Keep `session`, `today`, `processes`, `routines`, `areas`, `roles`, and `people` in the essential `Promise.all`. Load `approvals`, `invites`, `templates`, `dashboard`, and `proactive-suggestions` through `Promise.allSettled`, using these safe defaults:

  ```ts
  const optional = await Promise.allSettled([
    approvalsPromise,
    readJson<{ invites: ApiInvite[] }>(fetcher, "/api/invites", { headers }),
    templatesPromise,
    dashboardPromise,
    proactivePromise
  ]);

  const optionalValue = <T>(result: PromiseSettledResult<T>, fallback: T) =>
    result.status === "fulfilled" ? result.value : fallback;
  ```

  Add and export `loadFirstRunState(role, date, fetcher)` that calls `loadBaaseWorkspace` and `getOnboardingSession` together. It must return `{ bundle, onboardingSession }` only after both essential paths resolve.

- [ ] **Step 4: Add failing application tests**

  In `App.test.tsx`, configure a new owner workspace with `GET /api/onboarding/session` returning `null`. Require a `POST /api/onboarding/session` and the visible heading `"Vamos montar sua empresa"`. Add a test where `/api/areas` returns 500 and require visible text `"Não foi possível carregar sua empresa"`, while asserting `"Bom dia, Marina."` is absent.

- [ ] **Step 5: Implement explicit bootstrap state in `App.tsx`**

  Replace the independent loading effects with one retryable bootstrap effect for `role === "dono"`:

  ```ts
  type BootstrapStatus = "loading" | "ready" | "error";

  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>("loading");
  ```

  On success, if the owner inventory is empty and `onboardingSession === null`, call `createOnboardingSession("dono")`, store the returned session, and render `OnboardingShell`. On failure, render a focused recovery surface with one `"Tentar novamente"` button that increments `bootstrapAttempt`.

  Do not render the application shell while `bootstrapStatus === "loading"` or `"error"`. Replace client-side default workspace/identity values with neutral labels only; a live authenticated view must receive its real labels from `/me`.

- [ ] **Step 6: Add the recovery styles**

  Add a single `.bootstrap-state` layout near the existing auth/onboarding styles. It must use the current white surface, border, icon treatment, and responsive spacing; do not introduce a new visual system.

- [ ] **Step 7: Run web verification**

  ```bash
  pnpm --filter @prymeira/baase-web test -- src/api.test.ts src/App.test.tsx
  pnpm --filter @prymeira/baase-web build
  ```

  Expected: first-run onboarding is automatic; optional outages are tolerated; essential outages never render demo data.

- [ ] **Step 8: Commit the bootstrap change**

  ```bash
  git add apps/web/src/api.ts apps/web/src/api.test.ts \
    apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
  git commit -m "fix: bootstrap empty workspaces into onboarding"
  ```

## Task 5: Pin production deployment to the published commit tag

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `.env.production.example`
- Modify: `docs/deployment-vps.md`

- [ ] **Step 1: Replace mutable image references**

  In `docker-compose.prod.yml`:

  ```yaml
  image: ghcr.io/yohannreimer/prymeira-baase-api:${BAASE_IMAGE_TAG}
  ```

  ```yaml
  image: ghcr.io/yohannreimer/prymeira-baase-web:${BAASE_IMAGE_TAG}
  ```

- [ ] **Step 2: Document the required environment value**

  In `.env.production.example` add:

  ```env
  # Commit SHA published by the Baase GitHub Action; use the same value for web and API.
  BAASE_IMAGE_TAG=replace-with-github-commit-sha
  ```

  In `docs/deployment-vps.md`, add the Portainer flow: wait for the GitHub Action to publish both package tags, set `BAASE_IMAGE_TAG` to that commit SHA, pull/redeploy the stack, then inspect `/baase-runtime-config.js`, `/api/health`, and `/api/readiness`.

- [ ] **Step 3: Validate the compose file locally**

  ```bash
  BAASE_IMAGE_TAG=local docker compose -f docker-compose.prod.yml config >/tmp/baase-compose-resolved.yml
  ```

  Expected: exit code 0 and both resolved image names end in `:local`.

- [ ] **Step 4: Commit deployment changes**

  ```bash
  git add docker-compose.prod.yml .env.production.example docs/deployment-vps.md
  git commit -m "docs: pin Baase production images by commit"
  ```

## Task 6: End-to-end verification and deployment handoff

**Files:**
- Modify: `docs/deployment-vps.md` only if a command proved inaccurate during verification.

- [ ] **Step 1: Run the complete Baase test suite**

  ```bash
  pnpm test
  pnpm build
  ```

  Expected: all workspace tests and builds pass.

- [ ] **Step 2: Build and smoke-test both images**

  ```bash
  docker build -f apps/api/Dockerfile -t prymeira-baase-api:bootstrap .
  docker build -f apps/web/Dockerfile -t prymeira-baase-web:bootstrap .
  docker run --rm -d --name baase-api-bootstrap \
    -e BAASE_RUNTIME_MODE=production \
    -e BAASE_AUTH_MODE=account \
    -e PRYMEIRA_ACCOUNT_API_URL=https://hub.prymeiradigital.com.br/api \
    -p 13090:3090 prymeira-baase-api:bootstrap
  curl -fsS http://localhost:13090/health
  curl -fsS http://localhost:13090/readiness
  docker rm -f baase-api-bootstrap
  ```

  Expected: health returns `ok: true`; readiness is public and reports the configured production mode.

- [ ] **Step 3: Publish the Baase branch and wait for packages**

  ```bash
  git push origin main
  ```

  Confirm that the Baase GitHub Action publishes matching API and web packages for the pushed commit SHA.

- [ ] **Step 4: Deploy in Portainer with one immutable tag**

  Set the stack environment variable:

  ```env
  BAASE_IMAGE_TAG=<the-published-commit-sha>
  ```

  Redeploy the stack with image pulling enabled. Do not change the Postgres volume.

- [ ] **Step 5: Verify the production behavior manually**

  1. Open `https://baase.prymeiradigital.com.br` in a clean Clerk session with an allowed owner account and no Baase records.
  2. Confirm the onboarding opens before any dashboard.
  3. Confirm company/user labels come from the Account Hub, never `Marina Alves` or `Estúdio Norte`.
  4. Refresh the page and confirm the onboarding resumes from its saved session.
  5. Open `https://baase.prymeiradigital.com.br/api/health` and `https://baase.prymeiradigital.com.br/api/readiness` unauthenticated; both must return 200.

- [ ] **Step 6: Commit only documentation corrections discovered during deployment**

  ```bash
  git add docs/deployment-vps.md
  git commit -m "docs: clarify Baase production verification"
  git push origin main
  ```

  Skip this step when no documentation correction was necessary.

## Plan self-review

- Spec coverage: Tasks 1-2 establish trusted identity, Task 3 maps it to Baase, Task 4 fixes first-run behavior and error boundaries, Tasks 5-6 make deployment deterministic and verify the actual VPS.
- Placeholders: no deferred implementation items remain; the only runtime value intentionally supplied by the deployer is the published commit SHA.
- Consistency: `workspace_name`, `customer_id`, and `customer_name` are introduced in Hub types, emitted by Hub routes, consumed by Baase account auth, and asserted by Baase API tests before the web layer uses `/me`.
