# Rotinas, Evidencias e Comunicados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir isolamento de tarefas por pessoa e area, suportar evidencias anexadas no MinIO e exibir autoria e publico reais nos comunicados.

**Architecture:** A API se torna a autoridade de acesso de tarefas: gera ocorrencias individuais por responsavel e filtra a resposta de `Hoje` com a membership operacional. Edicoes de rotina reconciliam somente ocorrencias pendentes. Evidencias usam o adaptador `ObjectStorage` existente e sao persistidas como metadados da tarefa. Comunicados mantem a audiencia tipada existente, enquanto o frontend resolve autor e destino com os dados reais de pessoas, cargos e areas.

**Tech Stack:** Fastify 5, TypeScript, Zod, PostgreSQL, MinIO/S3 SDK, React 19, Vite, Vitest, Testing Library.

---

## Mapa de arquivos

- `apps/api/src/modules/company/access-policy.ts`: politica central para leitura e execucao de tarefa.
- `apps/api/src/modules/routines/routine.types.ts`: contratos de ocorrencia, evidencia e repositorio.
- `apps/api/src/modules/routines/routine.service.ts`: gera e reconcilia ocorrencias pendentes.
- `apps/api/src/modules/routines/routine.routes.ts`: aplica membership ao ler, marcar checklist e concluir tarefas; recebe o armazenamento de objetos.
- `apps/api/src/modules/routines/*repository.ts`: persiste a reconciliacao e os metadados de evidencia nos adaptadores em memoria e PostgreSQL.
- `apps/api/src/db/operational-schema.ts` e `apps/api/src/db/operational-schema.test.ts`: schema versionado e migracao das colunas de arquivo de evidencia.
- `apps/api/src/modules/routines/routine.routes.test.ts` e `routine.service.test.ts`: isolamento, reconciliacao e validacao de evidencia.
- `apps/api/src/app.ts`: injeta `companyRepository` e `objectStorage` nas rotas de rotinas.
- `apps/web/src/api.ts`: contratos e chamadas de upload/submissao de evidencia e campos de comunicado.
- `apps/web/src/App.tsx`: modal de tarefa com seletor de arquivo e formulario/detalhe de comunicado.
- `apps/web/src/App.test.tsx` ou teste de componente novo: cobertura de interacoes do formulario e modal.
- `apps/api/src/modules/announcements/announcement.routes.ts` e testes: audiencia com contexto de area/cargo e autor retornado.

### Task 1: Tornar autorizacao de tarefas uma regra de servidor

**Files:**
- Modify: `apps/api/src/modules/company/access-policy.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/modules/routines/routine.service.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.test.ts`

- [ ] **Step 1: Escrever testes de isolamento antes da correcao**

Adicionar fixtures de membership Tecnica e Financeiro ao teste de rotas. Cobrir uma rotina individual para `profile_peterson` e `profile_andre`, criada por `profile_owner`, e consultar `Hoje` como cada perfil.

```ts
expect((await app.inject({ method: "GET", url: "/today?date=2026-07-08", headers: financialEmployeeHeaders })).json().tasks)
  .toEqual([]);
expect((await app.inject({ method: "GET", url: "/today?date=2026-07-08", headers: petersonHeaders })).json().tasks)
  .toEqual([expect.objectContaining({ assigneeProfileId: "profile_peterson" })]);
expect((await app.inject({ method: "GET", url: "/today?date=2026-07-08", headers: ownerHeaders })).json().tasks)
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ assigneeProfileId: "profile_peterson" }),
    expect.objectContaining({ assigneeProfileId: "profile_andre" })
  ]));
```

Adicionar tambem `PATCH /tasks/:id/checklist` e `POST /tasks/:id/submit` pelo perfil de Financeiro esperando `403` para uma tarefa Tecnica.

- [ ] **Step 2: Executar os testes para confirmar a falha atual**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/routines/routine.routes.test.ts`

Expected: pelo menos o caso de Financeiro falha porque a consulta SQL e o repositorio em memoria incluem tarefas com `assignee_profile_id IS NULL` para qualquer perfil.

- [ ] **Step 3: Definir contratos de leitura e execucao por tarefa**

Em `access-policy.ts`, substituir a assinatura estreita de `canExecuteTask` por um objeto de tarefa e atualizar `canReadTask` para distinguir tarefa individual de compartilhada:

```ts
type TaskAccessInput = { assigneeProfileId: string | null; areaId: string | null };

export function canReadTask(member: OperationalMembership, task: TaskAccessInput) {
  if (member.role === "owner") return true;
  if (task.assigneeProfileId) {
    return task.assigneeProfileId === member.personId || canReadAreaResource(member, task.areaId);
  }
  return canReadAreaResource(member, task.areaId);
}

export function canExecuteTask(member: OperationalMembership, task: TaskAccessInput) {
  if (member.role === "owner") return true;
  if (task.assigneeProfileId) return task.assigneeProfileId === member.personId;
  return canReadAreaResource(member, task.areaId);
}
```

Essa regra impede que ausencia de responsavel seja interpretada como acesso global. O dono continua podendo visualizar e executar para operacao excepcional; gestor usa a rota de aprovacao, nao ganha conclusao de tarefa individual por essa regra.

- [ ] **Step 4: Remover o filtro permissivo do repositorio e filtrar apos resolver membership**

Em `routine.service.ts`, trocar `listTodayTasks(workspaceId, profileId, dueDate)` por `listTodayTasks(workspaceId, dueDate)`, que gera ocorrencias e devolve todas as ocorrencias daquela data. Em `routine.routes.ts`, obter `const membership = requireOperationalMembership(request)` no handler `/today` e aplicar:

```ts
const tasks = (await service.listTodayTasks(context.workspaceId, date))
  .filter((task) => canReadTask(membership, task));
```

Antes de checklist e submit, buscar a tarefa pelo service e bloquear com `scopeForbidden()` quando `canExecuteTask(requireOperationalMembership(request), task)` for falso. Manter a verificacao de responsavel do service como defesa adicional. Nao executar filtro no frontend nem enviar tarefas nao autorizadas na resposta.

No repositrio PostgreSQL, `listTaskOccurrences` deixa de acrescentar `AND (assignee_profile_id IS NULL OR ...)` quando recebe `profileId`; remova o parametro da leitura de Hoje. No repositorio em memoria, remova o bloco equivalente. O filtro de area fica exclusivamente na politica de acesso, que conhece a membership.

- [ ] **Step 5: Executar teste focal e suite de acesso**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/routines/routine.routes.test.ts src/modules/company/company.routes.test.ts`

Expected: PASS. Financeiro recebe zero tarefas Tecnicas e recebe `403` ao tentar manipular uma tarefa vazada por ID.

- [ ] **Step 6: Commit da camada de autorizacao**

```bash
git add apps/api/src/modules/company/access-policy.ts \
  apps/api/src/modules/routines/routine.routes.ts \
  apps/api/src/modules/routines/routine.service.ts \
  apps/api/src/modules/routines/in-memory-routine.repository.ts \
  apps/api/src/modules/routines/postgres-routine.repository.ts \
  apps/api/src/modules/routines/routine.routes.test.ts
git commit -m "fix: isolate routine tasks by assignment and area"
```

### Task 2: Reconciliar ocorrencias pendentes quando uma rotina muda

**Files:**
- Modify: `apps/api/src/modules/routines/routine.types.ts`
- Modify: `apps/api/src/modules/routines/routine.service.ts`
- Modify: `apps/api/src/modules/routines/in-memory-routine.repository.ts`
- Modify: `apps/api/src/modules/routines/postgres-routine.repository.ts`
- Modify: `apps/api/src/modules/routines/routine.service.test.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.test.ts`

- [ ] **Step 1: Escrever testes de reconciliacao**

Substituir a expectativa antiga de ocorrencia imutavel no mesmo dia por duas regras explicitas:

```ts
expect(oldResponsibleToday.json().tasks).toEqual([]);
expect(newResponsibleToday.json().tasks).toEqual([
  expect.objectContaining({
    title: "Atualizar orquestrador revisado",
    assigneeProfileId: "profile_employee",
    dueHint: "Até 10:00",
    checklistItems: [
      { title: "Conferir dia anterior", done: false },
      { title: "Registrar mudanças", done: false }
    ]
  })
]);
```

Criar um segundo caso que conclui a ocorrencia de `profile_manager`, altera a rotina e confirma que a ocorrencia concluida mantem titulo, checklist e responsavel anteriores enquanto a pendente de outro responsavel muda.

- [ ] **Step 2: Executar os testes para confirmar a falha atual**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/routines/routine.service.test.ts src/modules/routines/routine.routes.test.ts`

Expected: FAIL nos casos de edicao no mesmo dia, pois `createOrReuseRoutineOccurrences` retorna cedo quando encontra `routineRevisionSnapshot` antigo.

- [ ] **Step 3: Modelar a chave desejada e reconciliar somente pendencias**

Em `routine.service.ts`, extrair uma chave estavel por input de ocorrencia:

```ts
function occurrenceKey(input: Pick<TaskOccurrence, "taskTemplateId" | "assigneeProfileId">) {
  return `${input.taskTemplateId ?? "manual"}:${input.assigneeProfileId ?? "shared"}`;
}

function isMutableRoutineOccurrence(task: TaskOccurrence) {
  return task.status === "pending" && task.submittedAt === null;
}
```

Reescrever `createOrReuseRoutineOccurrences` para montar `desiredByKey` a partir de `buildRoutineOccurrenceInputs`, encontrar ocorrencias existentes da mesma rotina/data e:

1. criar cada chave desejada inexistente;
2. atualizar cada ocorrencia pendente existente com os campos do input desejado, checklist zerado apenas quando a versao da rotina mudou, e `routineRevisionSnapshot` atual;
3. excluir/arquivar ocorrencias pendentes cuja chave nao existe mais;
4. nunca alterar tarefas em `awaiting_approval`, `needs_adjustment` ou `completed`.

O modo `individual` deve continuar usando uma chave de execucao por responsavel (`routineId__execution__profileId`), portanto Peterson e Andre nunca compartilham a mesma ocorrencia. `createdByProfileId` nao entra nessa lista em nenhum momento.

- [ ] **Step 4: Persistir snapshot atualizado nos dois repositorios**

Adicionar ao contrato `RoutineRepository` um metodo focado, por exemplo `reconcileRoutineOccurrence(task, routineRevisionSnapshot)`, para que o service nao conheca SQL. A implementacao em memoria substitui a tarefa por id; a PostgreSQL atualiza `task_occurrences`, checklist e `routine_occurrences.routine_updated_at_snapshot` na mesma transacao e bloqueio de workspace.

Ao remover uma pendencia, usar a operacao de exclusao ja existente para que PostgreSQL aplique o mesmo soft delete usado pelo dominio e o repositorio em memoria remova o item. Para preservar historico, so chamar essa operacao se `isMutableRoutineOccurrence(task)` for verdadeiro.

- [ ] **Step 5: Executar testes de rotina e idempotencia**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/routines/routine.service.test.ts src/modules/routines/routine.routes.test.ts`

Expected: PASS. Duas leituras consecutivas de `Hoje` retornam a mesma quantidade de tarefas, responsaveis removidos nao recebem pendencias e tarefas concluidas nao sao reescritas.

- [ ] **Step 6: Commit da reconciliacao**

```bash
git add apps/api/src/modules/routines/routine.types.ts \
  apps/api/src/modules/routines/routine.service.ts \
  apps/api/src/modules/routines/in-memory-routine.repository.ts \
  apps/api/src/modules/routines/postgres-routine.repository.ts \
  apps/api/src/modules/routines/routine.service.test.ts \
  apps/api/src/modules/routines/routine.routes.test.ts
git commit -m "fix: reconcile pending routine occurrences"
```

### Task 3: Anexar evidencias reais usando o armazenamento MinIO

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/modules/routines/routine.types.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/modules/routines/routine.service.ts`
- Modify: `apps/api/src/modules/routines/postgres-routine.repository.ts`
- Modify: `apps/api/src/modules/routines/in-memory-routine.repository.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Escrever os testes de API de upload e regra de evidencia**

Seguir o padrao de `process-material.routes.test.ts`, usando `createInMemoryObjectStorage()`. Cobrir `POST /tasks/:id/evidence` multipart com PDF e imagem, e depois `POST /tasks/:id/submit`.

```ts
expect(uploadResponse.statusCode).toBe(201);
expect(uploadResponse.json().evidence.attachment).toMatchObject({
  fileName: "fechamento.pdf",
  contentType: "application/pdf"
});

expect(submitWithoutEvidence.statusCode).toBe(400);
expect(submitWithUploadedEvidence.statusCode).toBe(200);
```

Adicionar casos para extensao/tipo fora da lista, arquivo acima de 25 MB e uma politica `photo_or_comment_required` satisfeita apenas por comentario.

- [ ] **Step 2: Executar testes para confirmar a ausencia da rota**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/routines/routine.routes.test.ts`

Expected: FAIL com `404` para `/tasks/:id/evidence` e falha de tipo porque `TaskEvidence` nao possui anexo.

- [ ] **Step 3: Criar o contrato de anexo e a migracao**

Em `routine.types.ts`, adicionar metadados de anexo sem quebrar leitura legada:

```ts
export type TaskEvidenceAttachment = {
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
};

export type TaskEvidence = {
  comment: string | null;
  photoUrl: string | null; // legado para registros ja existentes
  attachment: TaskEvidenceAttachment | null;
};
```

`task_evidence` ja possui `object_key`. Adicionar uma nova versao a `OPERATIONAL_SCHEMA_MIGRATIONS` em `operational-schema.ts` com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS file_name`, `content_type` e `size_bytes`. Atualizar o schema base para conter as mesmas colunas e adicionar assertivas em `operational-schema.test.ts`. Manter `photo_url` para compatibilidade com dados antigos e hidratar ambos os formatos.

- [ ] **Step 4: Implementar upload protegido e validacao no backend**

Reutilizar o objeto `ObjectStorage` e limites do material de processo. Registrar `POST /tasks/:id/evidence` antes da submissao, ler `await request.file()`, aceitar `image/*`, `application/pdf`, documentos Word e planilhas, e rejeitar qualquer outro MIME com `415 TASK_EVIDENCE_TYPE_INVALID`.

Gerar chave isolada por workspace e tarefa:

```ts
const objectKey = `workspaces/${workspaceId}/task-evidence/${taskId}/${randomUUID()}-${safeFileName}`;
```

Checar `canExecuteTask` antes de ler/gravar o arquivo, chamar `objectStorage.put`, obter URL pelo mecanismo ja usado por materiais e atualizar somente o `attachment` da evidencia da tarefa. A rota retorna `201 { evidence }`. Nunca aceitar `photo_url` da requisicao como prova de evidencia.

No service, trocar a regra de `photo_required` por `Boolean(evidence.attachment || evidence.photoUrl)` e apresentar esse valor no frontend como `Evidência obrigatória`. `photo_or_comment_required` aceita comentario ou anexo. Arquivo antigo em `photoUrl` continua valido para nao invalidar historico.

- [ ] **Step 5: Implementar seletor de arquivo no frontend**

Em `api.ts`, adicionar `uploadTaskEvidence(role, taskId, file)` usando `FormData` e a mesma autenticacao das rotas existentes. Atualizar `submitTaskExecution` para enviar apenas comentario e usar o anexo salvo na tarefa.

Em `TaskExecutionModal`, trocar o input de URL por:

```tsx
<label className="file-picker">
  Anexar evidência
  <input
    type="file"
    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
    onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
  />
  <small>{evidenceFile ? evidenceFile.name : "Imagem, PDF ou documento"}</small>
</label>
```

Quando a pessoa escolher imagem, renderizar um botao de camera separado com `accept="image/*"` e `capture="environment"`; o seletor geral permanece disponivel para PDF/documento. No clique de concluir, enviar arquivo primeiro, atualizar o estado com a tarefa devolvida pela API e somente entao submeter. Exibir estado `Enviando evidencia...`, erro recuperavel e nome do anexo salvo. Manter a estrutura e classes visuais atuais do modal.

- [ ] **Step 6: Cobrir a interacao web**

Em `App.test.tsx`, mockar `uploadTaskEvidence` e testar que selecionar `new File(["pdf"], "fechamento.pdf", { type: "application/pdf" })` habilita a sequencia upload e submit. Verificar que nao existe campo de URL e que erro de upload mantem o nome do arquivo visivel.

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

Expected: PASS.

- [ ] **Step 7: Executar testes API e web da evidencia**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/routines/routine.routes.test.ts && pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

Expected: PASS. O teste de API confirma anexo no armazenamento em memoria e a interface nao permite URL manual.

- [ ] **Step 8: Commit da evidencia por anexo**

```bash
git add apps/api/src/app.ts apps/api/src/db/operational-schema.ts \
  apps/api/src/db/operational-schema.test.ts apps/api/src/modules/routines \
  apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: add task evidence uploads"
```

### Task 4: Exibir autor e publico reais dos comunicados

**Files:**
- Modify: `apps/api/src/modules/announcements/announcement.routes.ts`
- Modify: `apps/api/src/modules/announcements/announcement.routes.test.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Escrever testes de audiencia e autoria no backend**

Criar areas, cargos e pessoas no `CompanyRepository` em memoria. Criar e publicar um comunicado para area, um para cargo e um para pessoa. Consultar como perfis de cada grupo e testar que somente o publico correto recebe cada item, com `createdByProfileId` do dono presente:

```ts
expect(technicalResponse.json().announcements).toEqual([
  expect.objectContaining({ audience: { type: "area", areaId: "area_tecnica" }, createdByProfileId: "profile_owner" })
]);
expect(financialResponse.json().announcements).toEqual([]);
```

- [ ] **Step 2: Executar teste para confirmar a falha de contexto**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/announcements/announcement.routes.test.ts`

Expected: FAIL no caso de area/cargo, pois `listAnnouncementsForProfile` recebe somente perfil e papel, sem `areaId` e `roleTemplateId`.

- [ ] **Step 3: Passar membership completa ao servico de anuncios**

Em `announcement.routes.ts`, obter `membership` uma unica vez em `GET /announcements`, passar `areaId: membership.areaId` e `roleTemplateId: membership.roleTemplateId` para `listAnnouncementsForProfile`, e preservar `createdByProfileId` no JSON. Em `routine.routes.ts`, aplicar o mesmo contexto ao `announcementService.listAnnouncementsForProfile` usado dentro de `/today`. Nao duplicar regra de audiencia no frontend.

- [ ] **Step 4: Estender contratos e formulario web**

Adicionar `createdByProfileId?: string` a `ApiAnnouncement`. Mudar `AnnouncementForm` para receber `areas`, `roleTemplates` e `people`, e retornar audiencia tipada:

```ts
onSubmit({
  title, body, type, requirement, publish,
  audienceType,
  areaId: audienceType === "area" ? audienceId : null,
  roleTemplateId: audienceType === "role" ? audienceId : null,
  profileId: audienceType === "person" ? audienceId : null
});
```

Usar o mesmo seletor em duas etapas do `TrainingForm`: primeiro `Público` com Empresa inteira, Área, Cargo e Pessoa; depois o select complementar filtrado. Exigir destino complementar antes de salvar quando o público nao for empresa inteira.

Em `AnnouncementsPage`, receber `people`, `areas`, `roleTemplates` e o perfil atual. Resolver autor por `createdByProfileId`, exibir iniciais derivadas do nome e usar `Autor removido` apenas quando nao houver pessoa correspondente. Substituir `audienceLabel` por uma funcao que resolve nome de area, cargo ou pessoa e retorna texto real. Remover o literal `MA` e `Baase` do detalhe.

- [ ] **Step 5: Cobrir a interface de comunicados**

Renderizar o formulario em teste, selecionar `Área` e `Técnico, Implantação e Entregáveis`, salvar e verificar chamada com `audienceType: "area"` e o id correto. Renderizar um comunicado de `profile_yohann` e verificar iniciais `YR`, nome `Yohann Reimer` e o nome da area destino.

Run: `pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Executar a suite de comunicados e commit**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/announcements/announcement.routes.test.ts && pnpm --filter @prymeira/baase-web test -- src/App.test.tsx`

Expected: PASS.

```bash
git add apps/api/src/app.ts apps/api/src/modules/announcements \
  apps/api/src/modules/routines/routine.routes.ts \
  apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: personalize announcement authors and audiences"
```

### Task 5: Verificacao integrada e preparacao para producao

**Files:**
- Modify: `README.md` para documentar `BAASE_MINIO_*` e limite de upload.

- [ ] **Step 1: Executar verificacoes estaticas e suites completas**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: todos os testes habilitados passam; testes PostgreSQL que dependem de `TEST_DATABASE_URL` podem continuar marcados como skip quando a variavel nao estiver configurada. Typecheck e build terminam com codigo zero.

- [ ] **Step 2: Executar testes PostgreSQL quando houver banco de teste**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @prymeira/baase-api test:postgres-schema`

Expected: PASS, incluindo a migracao de metadados de evidencia e o filtro de ocorrencias.

- [ ] **Step 3: Teste manual local e responsivo**

Iniciar `pnpm --filter @prymeira/baase-web dev`, abrir a aplicacao autenticada e verificar:

1. Dono cria rotina Tecnica individual para Peterson e Andre.
2. Peterson e Andre recebem uma ocorrencia cada; usuario de Financeiro recebe nenhuma.
3. Alterar responsaveis remove somente ocorrencia pendente anterior.
4. Tarefa com evidencia obrigatoria aceita PDF e imagem, inclusive pelo seletor de celular.
5. Comunicado de Yohann para area Tecnica mostra `YR`, `Yohann Reimer` e `Técnico, Implantação e Entregáveis`.

Capturar screenshots desktop e celular para confirmar que o seletor de arquivo e o rodape do modal nao se sobrepoem.

- [ ] **Step 4: Documentar configuracao de anexos**

Adicionar ao `README.md` uma secao curta com as variaveis existentes:

```text
BAASE_MINIO_ENDPOINT
BAASE_MINIO_ACCESS_KEY
BAASE_MINIO_SECRET_KEY
BAASE_MINIO_BUCKET
```

Registrar que o bucket pode ser criado pelo adaptador S3/MinIO atual e que o limite da API e 25 MB por arquivo.

- [ ] **Step 5: Commit final e entrega**

```bash
git add README.md
git commit -m "docs: document task evidence storage"
git status --short
```

Nao incluir arquivos nao relacionados de `docs/superpowers`, `outputs/` ou `tmp/` que ja estavam no diretorio de trabalho.

## Cobertura da especificacao

- Isolamento por area e pessoa: Task 1.
- Ocorrencias individuais e criador fora dos responsaveis: Tasks 1 e 2.
- Reconciliacao somente de pendencias e preservacao de historico: Task 2.
- Anexo de imagem/PDF/documento no MinIO e validacao: Task 3.
- Autor e publico reais de comunicados: Task 4.
- Build, testes e verificacao em desktop/celular: Task 5.
