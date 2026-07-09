# Prymeira Baase — Arquitetura Técnica

> Arquitetura inicial para construir o Baase como produto completo dentro do ecossistema Prymeira.

Atualizado em: 2026-07-07

---

## 1. Stack

### Monorepo

```txt
Baase/
  apps/
    web/       React + TypeScript + Vite + Clerk
    api/       Fastify + TypeScript + pg/PostgreSQL
  packages/
    shared/    tipos, regras de domínio e contratos compartilhados
  docs/
    product-spec.md
    full-product-plan.md
    technical-architecture.md
```

### Padrão Prymeira

- Clerk autentica.
- Account API autoriza.
- `product_key=base`.
- `workspace_id` isola dados.
- Baase controla perfis operacionais internos: dono, gestor e funcionário.

### Modo piloto local

O app pode rodar em dois modos úteis durante desenvolvimento:

- `demo`: sem `DATABASE_URL`, usa repositórios em memória, providers de IA mockados e dados de demonstração.
- `pilot`: com `DATABASE_URL`, persiste em Postgres e usa OpenAI/Deepgram quando as chaves existem.

Runbook local para testes reais:

```bash
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
pnpm --filter @prymeira/baase-api db:init
pnpm --filter @prymeira/baase-api dev
pnpm --filter @prymeira/baase-web dev
curl http://localhost:3090/readiness
```

O web usa `/api` via proxy do Vite para `http://localhost:3090`. O endpoint `GET /readiness` mostra o modo atual, persistência, providers de IA ativos e avisos quando uma dependência real está faltando.

Para repetir testes sem apagar o banco inteiro:

```bash
pnpm --filter @prymeira/baase-api db:reset:workspace
BAASE_RESET_WORKSPACE_ID=workspace_b pnpm --filter @prymeira/baase-api db:reset:workspace
```

---

## 2. Aplicações

### `apps/web`

Responsável por:

- landing pública premium;
- login branded Quiet Ops;
- onboarding;
- painel do dono;
- painel do gestor;
- portal do funcionário;
- criação com IA;
- biblioteca de modelos.

Rotas previstas:

```txt
/landing
/login
/convite/:code
/onboarding
/revisao
/painel
/gestor
/hoje
/base
/processos
/rotinas
/treinamentos
/comunicados
/equipe
/modelos
/criar-com-ia
```

### `apps/api`

Responsável por:

- validar token Clerk;
- consultar Account API `/access-check?product_key=base`;
- resolver workspace;
- persistir dados do Baase;
- executar jobs de recorrência;
- orquestrar IA;
- armazenar uploads;
- gerar tarefas do dia.

---

## 3. Domínio principal

### Entidades

```txt
OperationalProfile
Area
RoleTemplate
Person
Invitation
Process
ProcessVersion
Routine
Checklist
ChecklistItem
TaskOccurrence
Evidence
Approval
Training
TrainingMaterial
QuizQuestion
QuizAttempt
Announcement
CommentThread
Comment
Template
AiDraft
AiSuggestion
```

### Papéis

```txt
owner
manager
employee
```

### Estados principais

Processos:

```txt
draft
published
archived
```

Treinamentos:

```txt
draft
published
archived
```

Rotinas:

```txt
active
paused
archived
```

Tarefas:

```txt
pending
in_progress
awaiting_approval
completed
needs_adjustment
late
dismissed
```

Comunicados por pessoa:

```txt
unread
read
confirmed
quiz_completed
pending
overdue
```

---

## 4. Modelo de dados inicial

### Workspace e perfis

O Baase não cria workspaces próprios. Ele recebe `workspace_id` da Account API.

`OperationalProfile` liga um usuário Prymeira a um papel operacional no Baase:

```txt
id
workspace_id
clerk_user_id
role: owner | manager | employee
area_id?
role_template_id?
display_name
phone?
avatar_url?
status
created_at
updated_at
```

### Áreas e cargos

`Area`:

```txt
id
workspace_id
name
description?
sort_order
created_at
updated_at
```

`RoleTemplate`:

```txt
id
workspace_id
area_id
name
description?
created_at
updated_at
```

### Processos

`Process`:

```txt
id
workspace_id
area_id?
title
summary?
status
owner_profile_id?
current_version_id?
published_at?
archived_at?
created_at
updated_at
```

`ProcessVersion`:

```txt
id
process_id
version_number
title
body
change_note
editor_profile_id
created_at
```

### Rotinas e tarefas

`Routine`:

```txt
id
workspace_id
area_id?
title
status
created_by_profile_id
created_at
updated_at
```

`RoutineTaskTemplate`:

```txt
id
workspace_id
routine_id
title
process_id?
assignee_profile_id?
approval_mode
evidence_policy
sort_order
created_at
updated_at
```

`TaskOccurrence`:

```txt
id
workspace_id
routine_id
task_template_id
title
process_id?
assignee_profile_id
approval_mode
evidence_policy
status
due_date
comment?
photo_url?
submitted_by_profile_id?
submitted_at?
created_at
updated_at
```

### Treinamentos

`Training`:

```txt
id
workspace_id
title
description?
status
created_by_profile_id
published_at?
archived_at?
created_at
updated_at
```

`TrainingMaterial`:

```txt
id
training_id
kind: lesson | pdf | link
title
body?
url?
sort_order
```

`QuizQuestion`:

```txt
id
training_id
prompt
options_json
correct_option_id
explanation?
sort_order
```

### Comunicados

`Announcement`:

```txt
id
workspace_id
title
body
type
audience_type
requires_confirmation
requires_quiz
created_by_profile_id
published_at
created_at
updated_at
```

---

## 5. API prevista

### Auth

Todas as rotas privadas:

1. leem token Clerk;
2. chamam Account API `/access-check?product_key=base`;
3. exigem `allowed=true`;
4. usam `workspace_id` da decisão de acesso;
5. resolvem `OperationalProfile`.

### Rotas iniciais

```txt
GET    /health
GET    /me

GET    /areas
POST   /areas
PATCH  /areas/:id

GET    /roles
POST   /roles
PATCH  /roles/:id

GET    /people
POST   /invites
GET    /invites/:code
POST   /invites/:code/accept

GET    /processes
POST   /processes
GET    /processes/:id
PATCH  /processes/:id
POST   /processes/:id/publish
POST   /processes/:id/archive
POST   /processes/:id/versions

GET    /routines
POST   /routines
PATCH  /routines/:id
POST   /routines/:id/occurrences/generate

GET    /today
POST   /tasks/:id/submit
POST   /tasks/:id/approve
POST   /tasks/:id/request-adjustment

GET    /trainings
POST   /trainings
POST   /trainings/:id/publish
POST   /trainings/:id/attempts

GET    /announcements
POST   /announcements
POST   /announcements/:id/confirm

GET    /templates
GET    /ai/runs
POST   /ai/drafts
POST   /ai/onboarding/suggestions
POST   /ai/transcriptions
```

---

## 6. IA

### Provider inicial

OpenAI por padrão, abstraído atrás de um `AiProvider` interno.

### Entradas

- texto;
- áudio transcrito;
- processo existente;
- material de treinamento;
- template.

### Saídas

- sugestões;
- rascunhos;
- processos;
- rotinas;
- checklists;
- treinamentos;
- comunicados;
- quizzes.

### Regra de segurança de produto

IA nunca publica diretamente para equipe.

Tudo que afeta funcionário passa por:

```txt
suggestion -> draft -> owner/manager review -> published/active
```

---

## 7. Jobs

### Jobs necessários

- gerar tarefas recorrentes do dia;
- marcar tarefas atrasadas;
- enviar lembretes futuros;
- processar transcrição de áudio;
- processar upload/material;
- gerar sugestões IA assíncronas.

### Estratégia inicial

Começar com jobs internos agendados no API para desenvolvimento. Evoluir para worker/fila quando houver carga real.

---

## 8. Storage

Arquivos V1:

- fotos de evidência;
- PDFs/materiais de treinamento;
- anexos de processos.

Provider recomendado:

- Cloudflare R2 ou S3 compatível, para manter padrão próximo de Flowcut/Nexus.

---

## 9. Testes

### Pacote shared

Testar regras puras:

- papéis;
- rotas por papel;
- transições de tarefa;
- versões de processo;
- herança de rotinas;
- público de comunicados;
- estados de treinamento.

### API

Testar:

- auth context;
- isolamento por workspace;
- convites;
- CRUDs principais;
- transições de tarefa;
- versionamento de processo;
- publicação de treinamento/comunicado;
- rotas IA com provider mockado.

### Web

Testar:

- roteamento por papel;
- onboarding;
- revisão de sugestões;
- Hoje do funcionário;
- painel do dono;
- formulários críticos.

---

## 10. Deploy

Opções:

1. Deploy independente:
   - `baase.prymeiradigital.com.br`
   - API própria
   - banco próprio

2. Dentro do Hub:
   - mais rápido para compartilhar infra;
   - menos isolamento de produto.

Recomendação inicial:

> Baase como monorepo próprio, domínio próprio e integração com Account API.

Isso preserva a identidade de produto de entrada premium.
