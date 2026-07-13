# Painel de Acompanhamento Operacional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Dono uma visão operacional global e ao Gestor uma visão limitada à sua área, com listas nominais e página de desempenho por pessoa.

**Architecture:** Estender o módulo `dashboard` com duas leituras autorizadas: resumo operacional por período e detalhe por pessoa. O serviço calcula as listas a partir de tarefas e recibos existentes, aplicando `OperationalMembership` no servidor. O frontend substitui o resumo estático por filtros de período, drill-down nominal e uma tela de pessoa que navega para tarefas e comunicados.

**Tech Stack:** Fastify 5, TypeScript, Zod, React 19, Vite, Vitest, Testing Library.

---

### Task 1: Contratos e métricas operacionais autorizadas

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.types.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.test.ts`

- [ ] **Step 1: Escrever testes de escopo e período**

Cobrir `GET /operational-overview?from=2026-07-01&to=2026-07-31` como Dono e Gestor. Criar tarefas em duas áreas, incluindo uma pendente vencida, uma `awaiting_approval`, uma concluída no prazo e uma concluída fora do prazo. Criar comunicado `read_confirmation` para a área e recibo apenas para uma pessoa.

```ts
expect(owner.json().lateTasks).toEqual(expect.arrayContaining([
  expect.objectContaining({ assigneeProfileId: "profile_tecnica", daysLate: 2 })
]));
expect(manager.json().lateTasks).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ areaId: "area_financeiro" })
]));
expect(manager.json().pendingRequiredAnnouncements).toEqual([
  expect.objectContaining({ profileId: "profile_tecnica" })
]);
```

- [ ] **Step 2: Rodar o teste em vermelho**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/dashboard/dashboard.routes.test.ts`

Expected: FAIL porque a rota e os contratos ainda não existem.

- [ ] **Step 3: Definir os tipos de overview**

Adicionar tipos para `OperationalOverview`, itens nominais e tendências, incluindo `from`, `to`, `lateTasks`, `awaitingApprovals`, `pendingRequiredAnnouncements`, `completionOnTimeRate` e `averageApprovalDurationHours`. Cada item nominal deve conter id do item, `profileId`, nome da pessoa, área, título e as datas necessárias para navegação.

- [ ] **Step 4: Implementar o cálculo no serviço**

Ler pessoas, tarefas e comunicados/recibos dos repositórios existentes. Considerar atraso somente quando `dueDate < today` e `status !== "completed"`; aprovação somente `awaiting_approval`; comunicado pendente somente `read_confirmation` ou `quiz_confirmation` publicado, destinado à pessoa e sem recibo confirmado/concluído. Calcular conclusão no prazo apenas para tarefas concluídas no intervalo que possuem vencimento; retornar `null` quando o denominador for zero.

Aplicar membership: Dono recebe tudo; Gestor filtra pessoas e recursos pelo `canReadAreaResource`; Funcionário recebe `403`.

- [ ] **Step 5: Registrar as rotas**

Validar query com Zod:

```ts
const periodSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).refine(({ from, to }) => from <= to, { message: "INVALID_PERIOD" });
```

Registrar `GET /operational-overview` e injetar `AnnouncementRepository` no módulo de dashboard por `app.ts`.

- [ ] **Step 6: Verificar e commitar**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/dashboard/dashboard.routes.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

```bash
git add apps/api/src/app.ts apps/api/src/modules/dashboard
git commit -m "feat: add operational oversight metrics"
```

### Task 2: Página operacional individual e proteção por URL

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.types.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.test.ts`

- [ ] **Step 1: Escrever testes de detalhe da pessoa**

Cobrir `GET /people/:id/operational-overview` com Dono, Gestor da área e Gestor de outra área. Confirmar `403` para área externa e dados de tarefas, taxa no prazo, tempo de aprovação e comunicados pendentes para acesso permitido.

- [ ] **Step 2: Rodar em vermelho**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/dashboard/dashboard.routes.test.ts`

Expected: FAIL com `404` para a nova rota.

- [ ] **Step 3: Implementar o detalhe reutilizando o agregador**

Adicionar `readPersonOperationalOverview({ workspaceId, membership, profileId, from, to })`. Buscar a pessoa, aplicar a mesma política de escopo e filtrar as listas e tendências para o perfil. Retornar `404` se a pessoa não existir no workspace e `403` se estiver fora do escopo.

- [ ] **Step 4: Verificar e commitar**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/dashboard/dashboard.routes.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

```bash
git add apps/api/src/modules/dashboard
git commit -m "feat: add person operational overview"
```

### Task 3: Clientes API e navegação da interface

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Escrever testes de navegação e filtros**

Mockar o overview com uma tarefa atrasada. Verificar que alterar de 7 dias para intervalo personalizado chama a API com `from`/`to`, clicar no nome da pessoa abre a tela de pessoa e clicar na tarefa mantém a navegação para a tarefa existente.

- [ ] **Step 2: Rodar em vermelho**

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

Expected: FAIL porque não há cliente nem tela operacional individual.

- [ ] **Step 3: Adicionar contratos e fetchers**

Adicionar `ApiOperationalOverview`, `ApiPersonOperationalOverview`, `readOperationalOverview` e `readPersonOperationalOverview`. Usar os mesmos cabeçalhos de autenticação e `URLSearchParams` para `from` e `to`.

- [ ] **Step 4: Implementar painel e página de pessoa**

Criar telas no `App.tsx` para Dono e Gestor usando o overview da API: atalhos 7/30/mês atual, intervalo personalizado, cards clicáveis, lista nominal e estados vazios. Adicionar screen `pessoa-operacional` com resumo, taxa, tempo de aprovação, tendências e listas. Ocultar a tela para funcionário e nunca usar filtragem cliente como controle de segurança.

- [ ] **Step 5: Verificar e commitar**

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx && pnpm --filter @prymeira/baase-web typecheck`

Expected: PASS.

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: add operational oversight dashboard"
```

### Task 4: Verificação integrada

**Files:**
- Modify: `README.md` somente se a nova rota exigir documentação pública; caso contrário, nenhum arquivo.

- [ ] **Step 1: Executar verificações completas**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: todos passam; testes PostgreSQL externos podem permanecer skipped sem `TEST_DATABASE_URL`.

- [ ] **Step 2: Teste manual de escopo**

Como Dono, verificar empresa inteira, lista nominal e página de pessoa. Como Gestor, verificar apenas sua área e acesso negado ao perfil externo. Como Funcionário, verificar ausência de navegação e `403` em chamadas diretas.

- [ ] **Step 3: Revisar o diff e encerrar**

Run: `git diff --check && git status --short`

Expected: sem erro de whitespace e sem inclusão do arquivo não rastreado `docs/superpowers/plans/2026-07-09-production-first-run-bootstrap.md`.
