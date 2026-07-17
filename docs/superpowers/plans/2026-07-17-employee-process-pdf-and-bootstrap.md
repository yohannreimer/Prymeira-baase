# Funcionário: PDF de processo e bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir o PDF de SOP publicado e autorizado para funcionários e eliminar chamadas administrativas 403 no bootstrap dessas contas.

**Architecture:** O bootstrap consulta `/api/me` antes das requisições opcionais e usa o papel retornado pelo servidor para decidir o que carregar. A rota de publicações conserva a proteção do Estúdio e autoriza PDF de processo somente quando o recurso é publicado e a política de área permite sua leitura.

**Tech Stack:** React 19, TypeScript, Vitest, Fastify, Zod e políticas de acesso por área.

---

### Task 1: Carregar a sessão antes das requisições opcionais

**Files:**
- Modify: `apps/web/src/api.ts:896-1009`
- Test: `apps/web/src/api.test.ts:90-310`

- [ ] **Step 1: Escrever o teste de bootstrap autenticado como funcionário**

```ts
it("does not request management bootstrap resources for an authenticated employee", async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({
    "/api/me": { profile: { role: "employee" }, workspace: { id: "workspace_a" } },
    "/api/today?date=2026-07-07": { tasks: [] },
    "/api/processes": { processes: [] },
    "/api/routines": { routines: [] },
    "/api/trainings": { trainings: [] },
    "/api/areas": { areas: [] },
    "/api/roles": { role_templates: [] },
    "/api/people": { people: [] },
    "/api/dashboard?date=2026-07-07": {}
  }[url])));

  await loadFirstRunState("dono", "2026-07-07", fetcher);

  expect(fetcher).not.toHaveBeenCalledWith("/api/onboarding/session", expect.anything());
  for (const path of ["/api/approvals", "/api/invites", "/api/templates", "/api/ai/proactive-suggestions"]) {
    expect(fetcher.mock.calls.some(([url]) => url === path)).toBe(false);
  }
  expect(fetcher.mock.calls.some(([url]) => String(url).startsWith("/api/operational-overview?"))).toBe(false);
});
```

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `pnpm --filter @prymeira/baase-web test -- api.test.ts`

Expected: FAIL porque o bootstrap atual solicita endpoints de gestão usando o papel inicial `dono`.

- [ ] **Step 3: Ler a sessão primeiro e decidir as chamadas por `session.profile.role`**

```ts
const session = await readJson<BaaseSession>(fetcher, "/api/me", { headers });
const isEmployee = session.profile.role === "employee";
const optionalResultsPromise = Promise.all([
  isEmployee ? Promise.resolve({ tasks: [] }) : optionalBootstrapValue((signal) => readJson<{ tasks: ApiTask[] }>(fetcher, "/api/approvals", { headers, signal }), { tasks: [] }),
  optionalBootstrapValue((signal) => readJson<{ trainings: ApiTraining[] }>(fetcher, "/api/trainings", { headers, signal }), { trainings: [] }),
  isEmployee ? Promise.resolve({ invites: [] }) : optionalBootstrapValue((signal) => readJson<{ invites: ApiInvite[] }>(fetcher, "/api/invites", { headers, signal }), { invites: [] }),
  isEmployee ? Promise.resolve({ templates: [], filters: { segments: [], areas: [], kinds: [] } }) : optionalBootstrapValue((signal) => readJson<{ templates: ApiTemplate[]; filters: ApiTemplateFilters }>(fetcher, "/api/templates", { headers, signal }), { templates: [], filters: { segments: [], areas: [], kinds: [] } }),
  optionalBootstrapValue((signal) => readJson<ApiDashboard | Record<string, never>>(fetcher, `/api/dashboard?date=${encodeURIComponent(date)}`, { headers, signal }), {} as ApiDashboard | Record<string, never>),
  isEmployee ? Promise.resolve(null) : optionalBootstrapValue((signal) => readOperationalOverview(role, overviewPeriod, fetcher, signal), null),
  isEmployee ? Promise.resolve({ suggestions: [] }) : optionalBootstrapValue((signal) => readJson<{ suggestions: ApiProactiveSuggestion[] }>(fetcher, "/api/ai/proactive-suggestions", { headers, signal }), { suggestions: [] })
]);
const [today, processes, routines, areas, roleTemplates, people] = await Promise.all([
  readJson<TodayResponse>(fetcher, `/api/today?date=${encodeURIComponent(date)}`, { headers }),
  readJson<{ processes: ApiProcess[] }>(fetcher, "/api/processes", { headers }),
  readJson<{ routines: ApiRoutine[] }>(fetcher, "/api/routines", { headers }),
  readJson<{ areas: ApiArea[] }>(fetcher, "/api/areas", { headers }),
  readJson<{ role_templates: ApiRoleTemplate[] }>(fetcher, "/api/roles", { headers }),
  readJson<{ people: ApiPerson[] }>(fetcher, "/api/people", { headers })
]);
```

Refatorar `loadFirstRunState` para buscar onboarding somente depois de receber o bundle e somente quando `bundle.session.profile.role === "owner"`.

- [ ] **Step 4: Rodar a regressão do cliente**

Run: `pnpm --filter @prymeira/baase-web test -- api.test.ts`

Expected: PASS, sem chamadas administrativas para funcionário e com o bootstrap de dono preservado.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "fix: avoid management bootstrap requests for employees"
```

### Task 2: Autorizar PDF de SOP publicado e legível

**Files:**
- Modify: `apps/api/src/modules/publications/publication.routes.ts:1-76`
- Modify: `apps/api/src/app.ts:520`
- Test: `apps/api/src/app.test.ts:1-105`

- [ ] **Step 1: Escrever testes de rota para PDF por funcionário**

```ts
it("lets an employee publish and download a PDF for a published global process", async () => {
  const app = buildApp({ publicationRenderer: { renderPdf: async () => Buffer.from("%PDF-process") } });
  const ownerHeaders = { "x-baase-workspace-id": "workspace_a", "x-baase-profile-id": "owner_a", "x-baase-role": "owner" };
  const employeeHeaders = { "x-baase-workspace-id": "workspace_a", "x-baase-profile-id": "employee_a", "x-baase-role": "employee" };
  const created = await app.inject({ method: "POST", url: "/processes", headers: ownerHeaders, payload: { title: "Política geral", body: "1. Ler", area_id: null } });
  await app.inject({ method: "POST", url: `/processes/${created.json().process.id}/publish`, headers: ownerHeaders });

  const publication = await app.inject({ method: "POST", url: "/studio/publications", headers: employeeHeaders, payload: { resource_type: "process", resource_id: created.json().process.id, format: "pdf" } });
  expect(publication.statusCode).toBe(201);
  const download = await app.inject({ method: "GET", url: `/studio/publications/${publication.json().publication.id}/download`, headers: employeeHeaders });
  expect(download.statusCode).toBe(200);
});

it("rejects an employee PDF request for a draft process", async () => {
  const app = buildApp({ publicationRenderer: { renderPdf: async () => Buffer.from("%PDF-process") } });
  const ownerHeaders = { "x-baase-workspace-id": "workspace_a", "x-baase-profile-id": "owner_a", "x-baase-role": "owner" };
  const employeeHeaders = { "x-baase-workspace-id": "workspace_a", "x-baase-profile-id": "employee_a", "x-baase-role": "employee" };
  const created = await app.inject({ method: "POST", url: "/processes", headers: ownerHeaders, payload: { title: "Rascunho", body: "1. Não publicar", area_id: null } });
  const response = await app.inject({ method: "POST", url: "/studio/publications", headers: employeeHeaders, payload: { resource_type: "process", resource_id: created.json().process.id, format: "pdf" } });
  expect(response.statusCode).toBe(403);
});
```

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `pnpm --filter @prymeira/baase-api test -- app.test.ts`

Expected: FAIL no processo publicado, pois a rota exige `canManageKnowledge`.

- [ ] **Step 3: Aplicar a autorização específica de `resource_type: process`**

```ts
await assertCanPublish(request, body.resource_type, body.resource_id, processRepository);

async function assertCanPublish(
  request: FastifyRequest,
  resourceType: "studio_document" | "process",
  resourceId: string,
  processRepository: ProcessRepository
) {
  const context = readRequestContext(request);
  if (resourceType === "studio_document") {
    if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
    return;
  }
  if (canManageKnowledge(context.role)) return;
  const process = await processRepository.findProcess(context.workspaceId, resourceId);
  if (!process) throw new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  if (process.status !== "published" || !canReadAreaResource(requireOperationalMembership(request), process.areaId)) throw forbiddenError();
}
```

Passar `processRepository` a `registerPublicationRoutes` no registro em `apps/api/src/app.ts`. Para rascunho e área não legível, responder 403; para processo inexistente, responder 404.

- [ ] **Step 4: Rodar os testes da API**

Run: `pnpm --filter @prymeira/baase-api test -- app.test.ts`

Expected: PASS; funcionário gera e baixa PDF do processo global publicado, mas é negado para rascunho. Documento do Estúdio continua exclusivo de dono.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/publications/publication.routes.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "fix: allow employees to download accessible process PDFs"
```

### Task 3: Propagar o papel ao cliente de publicações

**Files:**
- Modify: `apps/web/src/studio/studio-api.ts:55-72`
- Modify: `apps/web/src/studio/publication-api.ts:10-22`
- Modify: `apps/web/src/App.tsx:1237-1240,4823-4965`
- Test: `apps/web/src/App.test.tsx:3450-3530`

- [ ] **Step 1: Escrever teste de interface para o PDF solicitado por funcionário**

```ts
expect(fetchMock).toHaveBeenCalledWith("/api/studio/publications", expect.objectContaining({
  method: "POST",
  headers: expect.objectContaining({ "x-baase-role": "employee" })
}));
```

O teste monta `<App initialRole="func" />`, abre um processo publicado disponível e clica em `Baixar PDF`.

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `pnpm --filter @prymeira/baase-web test -- App.test.tsx`

Expected: FAIL porque `studioRequest` cria os cabeçalhos sempre como `dono`.

- [ ] **Step 3: Tornar o papel explícito nas funções de publicação**

```ts
export async function studioRequest<T>(path: string, init: RequestInit = {}, fetcher: StudioFetcher = fetch): Promise<T> {
  return studioRequestAs("dono", path, init, fetcher);
}

export async function studioRequestAs<T>(role: UiRole, path: string, init: RequestInit = {}, fetcher: StudioFetcher = fetch): Promise<T> {
  const headers = new Headers(createBaaseHeaders(role));
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetcher(`/api/studio${path}`, await withConfiguredAuth({ ...init, headers }));
  const payload = parseJson(await response.text());
  if (!response.ok) throw new StudioApiError(response.status, "STUDIO_API_ERROR", "Não foi possível concluir a operação no Estúdio.");
  return payload as T;
}

export async function createPublication(resourceType: Publication["resourceType"], resourceId: string, format: Publication["format"], role: UiRole) {
  return studioRequestAs(role, "/publications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId, format }) });
}

async function downloadEditorialProcessPdf(processId: string, role: UiRole) {
  const publication = await createPublication("process", processId, "pdf", role);
  globalThis.location.assign(await downloadPublication(publication.id, role));
}
```

Passar o `role` da página de processos até `downloadEditorialProcessPdf`. Os demais consumidores de Estúdio mantêm o padrão de dono e não recebem novas permissões.

- [ ] **Step 4: Rodar a regressão da interface**

Run: `pnpm --filter @prymeira/baase-web test -- App.test.tsx`

Expected: PASS; modo local usa papel `func` e modo account preserva o bearer da sessão.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio/studio-api.ts apps/web/src/studio/publication-api.ts apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "fix: use viewer role for process PDF downloads"
```

### Task 4: Verificação integrada e entrega

**Files:**
- Verify: `apps/web/src/api.test.ts`
- Verify: `apps/web/src/App.test.tsx`
- Verify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Executar a suíte web e o typecheck**

Run: `pnpm --filter @prymeira/baase-web test && pnpm --filter @prymeira/baase-web typecheck`

Expected: exit 0 e nenhuma falha.

- [ ] **Step 2: Executar a suíte da API e o typecheck**

Run: `pnpm --filter @prymeira/baase-api test && pnpm --filter @prymeira/baase-api typecheck`

Expected: exit 0 e nenhuma falha.

- [ ] **Step 3: Inspecionar a árvore antes de publicar**

Run: `git diff --check && git status --short`

Expected: sem erro de espaço; apenas arquivos planejados e `tmp/` preexistente não rastreado.

- [ ] **Step 4: Enviar os commits**

```bash
git push origin main
```
