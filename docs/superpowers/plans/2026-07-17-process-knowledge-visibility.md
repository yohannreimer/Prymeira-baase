# Process Knowledge Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make published processes visible to employees by company/area membership, without requiring a task assignment.

**Architecture:** The process listing endpoint already has a shared area-read policy that grants an employee access to their area and to company-wide resources. Remove only the task-occurrence gate from the process list, while retaining the published-only restriction for employees. Routine and task routes remain unchanged, so Today continues to be assignment-based.

**Tech Stack:** TypeScript, Fastify, Vitest, in-memory repositories.

---

## File structure

- Modify `apps/api/src/modules/processes/process.routes.ts`: list published processes using `canReadAreaResource` for every employee instead of task references.
- Modify `apps/api/src/modules/processes/process.routes.test.ts`: add an integration-style regression test with an employee membership in Financeiro and Controle.

### Task 1: Restore area-based process visibility

**Files:**
- Modify: `apps/api/src/modules/processes/process.routes.test.ts`
- Modify: `apps/api/src/modules/processes/process.routes.ts:82-96`

- [ ] **Step 1: Write the failing regression test**

Import `AuthenticatedRequest` from `../../http/auth-context`. Add this test to `apps/api/src/modules/processes/process.routes.test.ts`; it creates no routine occurrence or task occurrence:

```ts
it("lists published processes from an employee's area without a task assignment", async () => {
  const companyRepository = createInMemoryCompanyRepository();
  const finance = await companyRepository.createArea({
    workspaceId: "workspace_a", name: "Financeiro e Controle", description: null
  });
  const technical = await companyRepository.createArea({
    workspaceId: "workspace_a", name: "Técnico", description: null
  });
  const employee = await companyRepository.createTeamMember({
    workspaceId: "workspace_a", name: "Teste", email: "teste@example.com",
    role: "employee", areaId: finance.id, areaAccessIds: [finance.id],
    roleTemplateId: null, accessScope: "assigned_only", createdByProfileId: "seed"
  });
  const app = buildApp({ companyRepository, processRepository: createInMemoryProcessRepository() });
  app.addHook("onRequest", async (request) => {
    if (request.headers["x-test-as-employee"] !== "true") return;
    (request as AuthenticatedRequest).baaseContext = {
      workspaceId: "workspace_a", role: "employee", profileId: employee.id,
      operationalMembership: {
        person: employee, personId: employee.id, role: "employee",
        accessScope: employee.accessScope, areaAccessIds: employee.areaAccessIds
      }
    };
  });

  const create = async (title: string, areaId: string) => (await app.inject({
    method: "POST", url: "/processes", headers: managerHeaders,
    payload: { title, body: "Instrução operacional.", area_id: areaId }
  })).json().process;
  const financePublished = await create("Conferir fluxo financeiro", finance.id);
  const technicalPublished = await create("Executar entrega técnica", technical.id);
  await app.inject({ method: "POST", url: `/processes/${financePublished.id}/publish`, headers: managerHeaders });
  await app.inject({ method: "POST", url: `/processes/${technicalPublished.id}/publish`, headers: managerHeaders });
  await create("Rascunho financeiro", finance.id);

  const response = await app.inject({
    method: "GET", url: "/processes",
    headers: { ...employeeHeaders, "x-baase-profile-id": employee.id, "x-test-as-employee": "true" }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().processes.map((process: { id: string }) => process.id)).toEqual([financePublished.id]);
  await app.close();
});
```

- [ ] **Step 2: Run the regression test to verify the current failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/modules/processes/process.routes.test.ts
```

Expected: the new test fails because the current `referencedProcessIds` set is empty and the published financial SOP is filtered out.

- [ ] **Step 3: Remove the task-assignment gate from process listing**

In `apps/api/src/modules/processes/process.routes.ts`, remove the `routineRepository.listTaskOccurrences` lookup and the `referencedProcessIds` branch. Keep the employee draft guard and make the final check the shared area policy:

```ts
return { processes: processes.filter((process) => {
  if (membership.role === "employee" && process.status !== "published") return false;
  return canReadAreaResource(membership, process.areaId);
}) };
```

Remove the now-unused `RoutineRepository` parameter and import from `registerProcessRoutes`, then update its call site in `apps/api/src/app.ts` to omit `routineRepository`.

- [ ] **Step 4: Run focused tests to verify the fix**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- src/modules/processes/process.routes.test.ts src/modules/company/access-policy.test.ts
```

Expected: the new regression test and all existing focused tests pass.

- [ ] **Step 5: Run static validation**

Run:

```bash
pnpm --filter @prymeira/baase-api typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add apps/api/src/app.ts apps/api/src/modules/processes/process.routes.ts apps/api/src/modules/processes/process.routes.test.ts
git commit -m "fix: show published processes by area"
```
