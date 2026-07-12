# Baase Identity and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every authenticated Account Hub user to one operational person and enforce owner, manager, employee, workspace, area, and assigned-only access throughout the Baase.

**Architecture:** Keep the Account Hub as the authority for Clerk identity, workspace membership, and product `base` seats. Extend the Baase person record with external identity and operational scope, then resolve that record during authenticated session bootstrap. A central access-policy module receives the resolved membership and is used by every protected route before it reads or mutates operational data.

**Tech Stack:** TypeScript, Fastify, Zod, PostgreSQL, JSONB rollback repository, React, Vitest, Account Hub HTTP API, Clerk bearer tokens.

---

## File Structure

- `apps/api/src/http/account-auth.ts`: external Account Hub identity, bearer token subject, and bootstrap-only request context.
- `apps/api/src/http/auth-context.ts`: external and operational request context plus `requireOperationalMembership`.
- `apps/api/src/modules/company/company.types.ts`: person, invite, membership, repository, and service contracts.
- `apps/api/src/modules/company/operational-membership.service.ts`: resolves, creates, links, and audits a Baase member from a Hub identity.
- `apps/api/src/modules/company/access-policy.ts`: pure read and mutation policy shared by routes.
- `apps/api/src/modules/company/company.routes.ts`: invite proxy, membership resolution actions, and scoped company reads.
- `apps/api/src/modules/company/{in-memory-company.repository.ts,postgres-company.repository.ts}`: persist identities, multi-area access, and invitation metadata.
- `apps/api/src/db/{operational-schema.ts,postgres.ts}`: relational schema, JSONB parity, and backfill support.
- `apps/api/src/modules/session/session.routes.ts`: first authenticated bootstrap and real profile response.
- `apps/api/src/modules/{processes,routines,trainings,announcements,dashboard}/*.routes.ts`: central policy enforcement and filtered queries.
- `apps/web/src/{api.ts,App.tsx,auth.tsx,styles.css}`: real authenticated role, role-specific navigation, team access editor, and membership recovery states.

### Task 1: Model Membership and Multi-Area Access

**Files:**
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/in-memory-company.repository.ts`
- Modify: `apps/api/src/modules/company/postgres-company.repository.ts`
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Test: `apps/api/src/modules/company/company.service.test.ts`
- Test: `apps/api/src/modules/company/area-lifecycle.postgres.test.ts`
- Test: `apps/api/src/db/operational-schema.test.ts`

- [ ] **Step 1: Write failing domain and schema tests**

```ts
it("keeps one active Clerk identity per workspace and persists multiple accessible areas", async () => {
  const person = await company.createTeamMember({
    workspaceId: "workspace_a", name: "Ana", email: "ana@example.com", role: "manager",
    areaId: "area_finance", areaAccessIds: ["area_finance", "area_ops"],
    accessScope: "area", clerkUserId: "user_ana", customerId: "customer_ana",
    status: "active", createdByProfileId: "person_owner"
  });

  await expect(company.createTeamMember({ ...person, id: undefined, name: "Duplicada" }))
    .rejects.toThrow("TEAM_MEMBER_CLERK_ID_CONFLICT");
  expect(person.areaAccessIds).toEqual(["area_finance", "area_ops"]);
});
```

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run: `pnpm --filter @prymeira/baase-api test -- company.service.test.ts operational-schema.test.ts`

Expected: FAIL because `areaAccessIds`, `accessScope`, `clerkUserId`, and `customerId` are absent.

- [ ] **Step 3: Extend the domain contracts without changing existing person IDs**

```ts
export type AccessScope = "workspace" | "area" | "assigned_only";

export type TeamMember = {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  role: "owner" | "manager" | "employee";
  areaId: string | null;
  areaAccessIds: string[];
  roleTemplateId: string | null;
  accessScope: AccessScope;
  clerkUserId: string | null;
  customerId: string | null;
  status: "pending" | "active" | "inactive" | "placeholder" | "archived";
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
};
```

Add `findTeamMemberByClerkUserId`, `findTeamMemberByCustomerId`, `findUnlinkedTeamMembersByEmail`, and `setTeamMemberIdentity` to `CompanyRepository`. Require a non-empty `areaAccessIds` for `manager/area` and `employee/area`; normalize and deduplicate IDs; force owners to `workspace`.

- [ ] **Step 4: Add idempotent relational schema support**

```sql
ALTER TABLE people ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS access_scope TEXT NOT NULL DEFAULT 'workspace';

CREATE TABLE IF NOT EXISTS person_area_access (
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, person_id, area_id),
  FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, area_id) REFERENCES areas (workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS people_active_clerk_identity_uidx
  ON people (workspace_id, clerk_user_id) WHERE clerk_user_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS people_active_customer_identity_uidx
  ON people (workspace_id, customer_id) WHERE customer_id IS NOT NULL AND archived_at IS NULL;
```

Hydrate and replace `areaAccessIds` transactionally in both repositories. Preserve JSONB fields exactly so switching `BAASE_OPERATIONAL_STORE` does not change the returned shape.

- [ ] **Step 5: Run focused API and PostgreSQL tests**

Run: `TEST_DATABASE_URL=postgresql://yohannreimer@127.0.0.1:55432/baase_test pnpm --filter @prymeira/baase-api test -- company.service.test.ts area-lifecycle.postgres.test.ts operational-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the data model**

```bash
git add apps/api/src/modules/company apps/api/src/db/operational-schema.ts apps/api/src/db/postgres.ts
git commit -m "feat: model Baase operational memberships"
```

### Task 2: Resolve Authenticated Membership at Session Bootstrap

**Files:**
- Create: `apps/api/src/modules/company/operational-membership.service.ts`
- Create: `apps/api/src/modules/company/operational-membership.service.test.ts`
- Modify: `apps/api/src/http/account-auth.ts`
- Create: `apps/api/src/http/account-auth.test.ts`
- Modify: `apps/api/src/http/auth-context.ts`
- Modify: `apps/api/src/modules/session/session.routes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/modules/session/session.routes.test.ts`

- [ ] **Step 1: Write failing membership-resolution tests**

```ts
it("links an active Hub user to the only pending person with the same email", async () => {
  const result = await resolveOperationalMembership({
    workspaceId: "workspace_a", clerkUserId: "user_ana", customerId: "customer_ana",
    email: "ana@example.com", name: "Ana", hubRole: "member"
  });
  expect(result.person.id).toBe("person_ana");
  expect(result.person.clerkUserId).toBe("user_ana");
});

it("rejects an ambiguous email instead of choosing a person by name", async () => {
  await expect(resolveOperationalMembership({ ...identity, email: "shared@example.com" }))
    .rejects.toThrow("BAASE_MEMBERSHIP_CONFLICT");
});
```

- [ ] **Step 2: Run the new tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- operational-membership.service.test.ts session.routes.test.ts`

Expected: FAIL because no resolver or external identity exists in the request context.

- [ ] **Step 3: Carry verified external identity through account authentication**

Mirror Talk's safe post-validation subject extraction and retain the bearer token:

```ts
export type ExternalAccountIdentity = {
  workspaceId: string;
  workspaceName?: string;
  clerkUserId: string;
  customerId: string;
  productRole: string;
  bearerToken: string;
};

function readClerkUserIdFromBearerToken(token: string): string {
  const [, payload] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  if (typeof decoded.sub !== "string" || !decoded.sub) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  return decoded.sub;
}
```

Only decode after the Account Hub has validated that same bearer token. Add `externalIdentity` to `RequestContext`; do not synthesize `profileId` from `customerId` in account mode.

- [ ] **Step 4: Implement deterministic member resolution**

`resolveOperationalMembership` must resolve in this order: existing `clerkUserId`, existing `customerId`, exactly one unlinked active/pending person with normalized matching email, first workspace owner bootstrap, otherwise `BAASE_MEMBERSHIP_REQUIRED`. Fetch `/me/products` with the original bearer token only when an e-mail is needed. Every successful bind writes an `operational_audit_log` event with the before/after identity fields.

```ts
if (identity.productRole === "admin" && !await repository.hasLinkedOwner(identity.workspaceId)) {
  return repository.createTeamMember({
    workspaceId: identity.workspaceId, name: identity.name, email: identity.email,
    role: "owner", areaId: null, areaAccessIds: [], accessScope: "workspace",
    clerkUserId: identity.clerkUserId, customerId: identity.customerId,
    status: "active", createdByProfileId: identity.clerkUserId
  });
}
```

`GET /me` is the allowed bootstrap route. All later protected routes call `requireOperationalMembership(request)` and receive a real person ID.

- [ ] **Step 5: Run focused auth/session tests**

Run: `pnpm --filter @prymeira/baase-api test -- account-auth.test.ts operational-membership.service.test.ts session.routes.test.ts`

Expected: PASS, including missing membership, auto-link, conflict, and first-owner cases.

- [ ] **Step 6: Commit bootstrap identity**

```bash
git add apps/api/src/http apps/api/src/modules/company/operational-membership.service.ts apps/api/src/modules/session apps/api/src/app.ts
git commit -m "feat: resolve authenticated Baase memberships"
```

### Task 3: Make the Account Hub Invitation the Only Production Invitation

**Files:**
- Create: `apps/api/src/modules/company/account-hub-team.client.ts`
- Create: `apps/api/src/modules/company/account-hub-team.client.test.ts`
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/company.service.ts`
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/http/account-auth.ts`
- Test: `apps/api/src/modules/company/company.routes.test.ts`

- [ ] **Step 1: Write failing Hub client and invite route tests**

```ts
expect(fetchMock).toHaveBeenCalledWith("https://hub.test/api/team/members/invite", expect.objectContaining({
  method: "POST",
  headers: expect.objectContaining({ Authorization: "Bearer clerk-token" }),
  body: JSON.stringify({ email: "ana@example.com", name: "Ana", role: "member", product_key: "base" })
}));
expect(response.statusCode).toBe(201);
expect(response.json().invite.hubInvitationId).toBe("hub_invite_1");
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- account-hub-team.client.test.ts company.routes.test.ts`

Expected: FAIL because the Baase does not call the Hub or retain Hub invite state.

- [ ] **Step 3: Add a timeout-bound Hub client**

```ts
export async function inviteBaseMember(input: HubInviteInput): Promise<HubInviteResult> {
  const response = await timedFetch(`${input.accountApiUrl}/team/members/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.bearerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, name: input.name, role: "member", product_key: "base" })
  }, 3_000);
  if (!response.ok) throw new ApiError(502, "ACCOUNT_HUB_INVITE_FAILED", "Não foi possível enviar o convite pelo Prymeira Hub.");
  return parseHubInviteResult(await response.json());
}
```

Map every Baase operational role to Hub `member`; reserve Account Hub administration for the workspace owner. Store `hubInvitationId`, `hubStatus`, `acceptedAt`, and `personId` on the local invite.

- [ ] **Step 4: Replace production invite-code flows**

In account mode, `POST /invites` requires an operational owner and external bearer identity, calls the Hub first, then writes the local operational invitation in one server action. Mark `GET /invites/:code` and `POST /invites/:code/accept` unavailable with `410 LEGACY_INVITE_FLOW_DISABLED` in account mode; retain them only in local mode for existing demo tests.

- [ ] **Step 5: Run invitation tests**

Run: `pnpm --filter @prymeira/baase-api test -- account-hub-team.client.test.ts company.routes.test.ts company.service.test.ts`

Expected: PASS, including Hub failure leaves no local invite, existing Hub users, pending Hub users, and disabled public acceptance in account mode.

- [ ] **Step 6: Commit invitation integration**

```bash
git add apps/api/src/modules/company apps/api/src/http/account-auth.ts
git commit -m "feat: route Baase invitations through Account Hub"
```

### Task 4: Create the Central Authorization Policy

**Files:**
- Create: `apps/api/src/modules/company/access-policy.ts`
- Create: `apps/api/src/modules/company/access-policy.test.ts`
- Modify: `apps/api/src/http/auth-context.ts`
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/modules/processes/process.routes.ts`
- Modify: `apps/api/src/modules/processes/process-material.routes.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/modules/trainings/training.routes.ts`
- Modify: `apps/api/src/modules/announcements/announcement.routes.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.ts`

- [ ] **Step 1: Write the policy matrix as pure tests**

```ts
const manager = membership({ role: "manager", accessScope: "area", areaAccessIds: ["area_ops"] });
expect(canReadAreaResource(manager, "area_ops")).toBe(true);
expect(canReadAreaResource(manager, "area_finance")).toBe(false);
expect(canManageAreaResource(manager, "area_ops")).toBe(true);

const employee = membership({ role: "employee", accessScope: "assigned_only" });
expect(canReadTask(employee, { assigneeProfileId: employee.personId })).toBe(true);
expect(canReadTask(employee, { assigneeProfileId: "person_other" })).toBe(false);
```

- [ ] **Step 2: Run the policy tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- access-policy.test.ts`

Expected: FAIL because no policy module exists.

- [ ] **Step 3: Implement explicit policy helpers**

```ts
export function canReadAreaResource(member: OperationalMembership, areaId: string | null) {
  if (member.role === "owner" || member.accessScope === "workspace") return true;
  if (areaId === null) return member.accessScope !== "assigned_only";
  return member.accessScope === "area" && member.areaAccessIds.includes(areaId);
}

export function canManageAreaResource(member: OperationalMembership, areaId: string | null) {
  return member.role === "owner" || (member.role === "manager" && canReadAreaResource(member, areaId));
}
```

Add helpers for own task execution, approval visibility, assigned-only process IDs, and Hub seat administration. `BAASE_SCOPE_FORBIDDEN` must be returned for an authenticated member outside the resource scope.

- [ ] **Step 4: Apply policy to all API reads and writes**

Filter process/routine/training/announcement/dashboard outputs before serializing them. Filter approvals by permitted areas. Guard mutation endpoints using the target resource's area before calling the service. For assigned-only process listing, obtain the member's task occurrences first and allow only matching `processId`s.

- [ ] **Step 5: Run route and policy tests**

Run: `pnpm --filter @prymeira/baase-api test -- access-policy.test.ts process.routes.test.ts process-material.routes.test.ts routine.routes.test.ts training.routes.test.ts announcement.routes.test.ts dashboard.routes.test.ts`

Expected: PASS, with owner, scoped manager, area employee, and assigned-only employee coverage.

- [ ] **Step 6: Commit authorization policy**

```bash
git add apps/api/src/http/auth-context.ts apps/api/src/modules/company/access-policy.ts apps/api/src/modules/company/company.routes.ts apps/api/src/modules/processes apps/api/src/modules/routines apps/api/src/modules/trainings apps/api/src/modules/announcements apps/api/src/modules/dashboard
git commit -m "feat: enforce Baase operational access scopes"
```

### Task 5: Make Task Assignment and Execution Use the Real Person

**Files:**
- Modify: `apps/api/src/modules/routines/routine.service.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/modules/routines/routine.service.test.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.test.ts`
- Modify: `apps/api/src/modules/session/session.routes.ts`
- Test: `apps/api/src/modules/session/session.routes.test.ts`

- [ ] **Step 1: Write regressions for real assignees**

```ts
it("returns different Today tasks to two authenticated people with the same role", async () => {
  await service.createManualTask("workspace_a", "person_owner", { title: "Ana", assigneeProfileId: "person_ana", dueDate: "2026-07-11" });
  await service.createManualTask("workspace_a", "person_owner", { title: "Bia", assigneeProfileId: "person_bia", dueDate: "2026-07-11" });
  await expect(service.listTodayTasks("workspace_a", "person_ana", "2026-07-11")).resolves.toMatchObject([{ title: "Ana" }]);
});
```

- [ ] **Step 2: Run the regression tests and verify failure or current mismatch**

Run: `pnpm --filter @prymeira/baase-api test -- routine.service.test.ts routine.routes.test.ts session.routes.test.ts`

Expected: FAIL until requests pass the resolved person ID instead of `account_<customer_id>`.

- [ ] **Step 3: Pass the membership person ID through all task paths**

Use `requireOperationalMembership(request).personId` for Today, manual task defaults, checklist updates, submit, approve, return, training progress, announcement receipts, and audit actor fields. Before assignment or reassignment, verify the target person exists, is active, and is manageable by the actor's scope.

- [ ] **Step 4: Return the real profile in session bootstrap**

```ts
return {
  workspace: { id: context.workspaceId, name: context.workspaceName ?? "Empresa" },
  profile: {
    id: membership.personId,
    role: membership.role,
    display_name: membership.person.name,
    initials: initialsFromName(membership.person.name),
    area_name: membership.primaryAreaName,
    area_names: membership.areaNames,
    access_scope: membership.accessScope
  },
  home_route: readHomeRouteForRole(membership.role)
};
```

- [ ] **Step 5: Run task/session tests**

Run: `pnpm --filter @prymeira/baase-api test -- routine.service.test.ts routine.routes.test.ts session.routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit person-bound execution**

```bash
git add apps/api/src/modules/routines apps/api/src/modules/session
git commit -m "fix: bind Baase task execution to authenticated person"
```

### Task 6: Move the Web App to the Authenticated Role and Scope

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/auth.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write web tests for production role behavior**

```tsx
it("uses the authenticated manager profile and does not render the role switcher in account mode", async () => {
  mockWorkspace({ session: { profile: { id: "person_ana", role: "manager", access_scope: "area" }, home_route: "painel-gestor" } });
  render(<App />);
  expect(await screen.findByText("Painel do Gestor")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Funcionário" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the web tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- App.test.tsx api.test.ts`

Expected: FAIL because role is still locally switchable and session lacks scope metadata.

- [ ] **Step 3: Extend API session types and derive UI identity exclusively from session in account mode**

```ts
profile: {
  id: string;
  role: BaaseApiRole;
  display_name?: string;
  initials?: string;
  area_name?: string | null;
  area_names?: string[];
  access_scope?: "workspace" | "area" | "assigned_only";
}
```

In account mode, initialize `role` from `session.profile.role` and navigate to `session.home_route`. Keep the role selector only for local mode. Add an owner-only “Prévia” menu that changes presentation state but never API headers, session role, or mutation privileges.

- [ ] **Step 4: Render role-specific navigation and scope explanations**

Render owner dashboard/navigation for owners, manager dashboard/navigation for managers, and Today-first navigation for employees. Remove management controls when the authenticated session cannot manage them. Use a compact `Área: Financeiro e Operações` label for multi-area managers; do not create a new visual language.

- [ ] **Step 5: Run web tests**

Run: `pnpm --filter @prymeira/baase-web test -- App.test.tsx api.test.ts auth-config.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit authenticated web roles**

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/auth.tsx apps/web/src/styles.css apps/web/src/*.test.ts*
git commit -m "feat: render Baase by authenticated role and scope"
```

### Task 7: Build the Team Access Editor and Legacy Resolution Queue

**Files:**
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/modules/company/company.service.ts`
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/api/src/modules/company/company.routes.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for invite metadata and manual identity resolution**

```ts
await request(app.server)
  .post("/memberships/unlinked/user_ana/resolve")
  .set(authHeaders("person_owner"))
  .send({ person_id: "person_existing" })
  .expect(200)
  .expect(({ body }) => expect(body.person.clerk_user_id).toBe("user_ana"));
```

- [ ] **Step 2: Run focused API and web tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- company.routes.test.ts && pnpm --filter @prymeira/baase-web test -- App.test.tsx`

Expected: FAIL because the access editor and resolution endpoint do not exist.

- [ ] **Step 3: Add owner-only membership administration endpoints**

Expose a scoped list of unlinked identities and `POST /memberships/unlinked/:clerkUserId/resolve`. The route accepts a person ID, verifies same workspace and no existing identity, applies the confirmed association in a transaction, and audits `membership.resolve_manual`. Existing team member update routes accept `area_access_ids` and `access_scope` but never let a manager grant workspace access or alter an owner.

- [ ] **Step 4: Replace invite-code UI with the access editor**

The owner form uses a primary-area select, multi-select area checklist, access-scope select, and a summary sentence such as “Gestor com acesso a Financeiro e Operações”. On submit, show `Convite enviado pelo Prymeira Hub` or `Acesso liberado; aguardando primeiro acesso`. Render legacy conflicts in an owner-only section with a direct “Vincular pessoa” action and a confirmation dialog.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @prymeira/baase-api test -- company.routes.test.ts company.service.test.ts && pnpm --filter @prymeira/baase-web test -- App.test.tsx api.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit team access UX**

```bash
git add apps/api/src/modules/company apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/*.test.ts*
git commit -m "feat: manage Baase team access and identity links"
```

### Task 8: Backfill, Production Verification, and Release Documentation

**Files:**
- Modify: `apps/api/src/db/operational-backfill/legacy-parse.ts`
- Modify: `apps/api/src/db/operational-backfill/workspace-persist.ts`
- Modify: `apps/api/src/db/operational-backfill/reconcile.ts`
- Modify: `apps/api/src/db/operational-backfill.test.ts`
- Modify: `docs/deployment-operational-migration.md`
- Create: `docs/identity-access-rollout.md`

- [ ] **Step 1: Write failing backfill/reconciliation tests**

```ts
expect(report.memberships).toMatchObject({
  existing_people: 4,
  linked_by_email: 1,
  unresolved: 2,
  duplicate_emails: ["shared@example.com"]
});
expect(report.reconciled).toBe(false);
```

- [ ] **Step 2: Run the migration tests and verify failure**

Run: `TEST_DATABASE_URL=postgresql://yohannreimer@127.0.0.1:55432/baase_test pnpm --filter @prymeira/baase-api test -- operational-backfill.test.ts`

Expected: FAIL because membership data and unresolved identity diagnostics are absent.

- [ ] **Step 3: Backfill without changing person IDs**

Backfill `areaAccessIds` from each existing `areaId`, set unlinked existing people to their safe historical scope, and report every identity that cannot be matched by a unique normalized e-mail. Never infer Clerk or customer IDs during database-only migration. The report is blocking only for production switch to enforced account-mode membership, not for the initial schema deployment.

- [ ] **Step 4: Write production rollout instructions**

Document this sequence:

```text
1. Deploy schema and compatibility code while local identity enforcement is disabled.
2. Run the membership reconciliation report against a rehearsal copy.
3. Resolve duplicate and missing e-mail records from the owner UI.
4. Deploy Account Hub invitation integration and verify owner bootstrap.
5. Enable BAASE_REQUIRE_OPERATIONAL_MEMBERSHIP=true.
6. Test owner, scoped manager, area employee, and assigned-only employee with separate Clerk accounts.
7. Keep the rollback flag for one soak period; never delete identity columns or audit rows.
```

- [ ] **Step 5: Run full verification**

Run: `TEST_DATABASE_URL=postgresql://yohannreimer@127.0.0.1:55432/baase_test pnpm test && pnpm typecheck && pnpm build`

Expected: all API, web, and shared tests PASS; typecheck and production builds PASS.

- [ ] **Step 6: Commit rollout support**

```bash
git add apps/api/src/db docs/deployment-operational-migration.md docs/identity-access-rollout.md
git commit -m "docs: add Baase identity access rollout"
```

## Plan Self-Review

- The plan covers the approved Hub invitation flow, Clerk-to-person association, multi-area access, central policy, role-specific UI, legacy resolution, tests, and rollout.
- No task depends on an unplanned Account Hub change: it uses the existing `/team/members/invite`, `/access-check`, and `/me/products` contracts already exercised by Prymeira Talk.
- The naming is consistent: `OperationalMembership`, `accessScope`, `areaAccessIds`, `clerkUserId`, `customerId`, and `personId` are used throughout.
- The scope intentionally excludes MinIO, backup, CORS, rate limiting, observability, and the relational cutover hardening from the earlier audit.
