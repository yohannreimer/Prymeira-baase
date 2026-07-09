# Prymeira Baase — Database Schema

> Desenho inicial do banco de dados do Baase. A implementação atual usa PostgreSQL via `pg`, mantendo `workspace_id` como fronteira de isolamento.

Atualizado em: 2026-07-07

---

## 0. Implementação atual

Nesta fase, a API já suporta Postgres real quando `DATABASE_URL` está definida. Para manter velocidade sem congelar a modelagem cedo demais, os repositórios atuais persistem os objetos operacionais completos em uma tabela `baase_records` com `jsonb`.

```txt
baase_records
kind
workspace_id
id
data jsonb
created_at
updated_at
primary key (kind, workspace_id, id)
```

Kinds usados agora:

- `area`
- `role_template`
- `team_member`
- `team_invite`
- `process`
- `routine`
- `task_occurrence`
- `training`
- `training_assignment`
- `quiz_attempt`
- `announcement`
- `announcement_receipt`
- `ai_run`

Como rodar localmente:

```bash
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
pnpm --filter @prymeira/baase-api db:init
pnpm --filter @prymeira/baase-api dev
```

Sem `DATABASE_URL`, o servidor continua usando repositórios em memória com demo local.

Para limpar apenas um workspace durante testes de piloto:

```bash
pnpm --filter @prymeira/baase-api db:reset:workspace
BAASE_RESET_WORKSPACE_ID=workspace_b pnpm --filter @prymeira/baase-api db:reset:workspace
pnpm --filter @prymeira/baase-api db:reset:workspace -- workspace_b
```

O reset apaga somente linhas da tabela `baase_records` com o `workspace_id` selecionado.

As seções abaixo seguem como alvo de normalização futura, quando os fluxos principais estabilizarem.

## 1. Regras gerais

- Todas as tabelas operacionais têm `workspace_id`.
- Nunca aceitar `workspace_id` vindo do client como fonte de verdade.
- `workspace_id` vem da Account API.
- IDs podem começar como CUID/UUID, mas devem ser opacos para o client.
- Campos `created_at` e `updated_at` em todas as entidades mutáveis.
- Soft archive quando o objeto pode afetar histórico.

---

## 2. Tabelas

### `operational_profiles`

Representa a pessoa dentro da empresa no Baase.

```txt
id
workspace_id
clerk_user_id
role
display_name
email
phone
avatar_url
area_id
role_template_id
access_scope
status
created_at
updated_at
```

Índices:

- unique `(workspace_id, clerk_user_id)`
- `(workspace_id, role)`
- `(workspace_id, area_id)`

### `areas`

```txt
id
workspace_id
name
description
sort_order
created_at
updated_at
archived_at
```

Índices:

- unique `(workspace_id, name)`

### `role_templates`

Cargos/funções operacionais.

```txt
id
workspace_id
area_id
name
description
created_at
updated_at
archived_at
```

Índices:

- unique `(workspace_id, area_id, name)`

### `invitations`

Convites do Baase.

```txt
id
workspace_id
code
email
role
area_id
role_template_id
access_scope
status
expires_at
accepted_by_profile_id
accepted_at
created_by_profile_id
created_at
updated_at
```

Índices:

- unique `(code)`
- `(workspace_id, status)`
- `(email, status)`

### `processes`

```txt
id
workspace_id
area_id
title
summary
status
owner_profile_id
current_version_id
published_at
archived_at
created_by_profile_id
created_at
updated_at
```

Índices:

- `(workspace_id, status)`
- `(workspace_id, area_id)`

### `process_versions`

```txt
id
workspace_id
process_id
version_number
title
body
change_note
editor_profile_id
created_at
```

Índices:

- unique `(process_id, version_number)`
- `(workspace_id, process_id)`

### `routines`

```txt
id
workspace_id
title
area_id
status
created_by_profile_id
created_at
updated_at
archived_at
```

Índices:

- `(workspace_id, status)`
- `(workspace_id, area_id)`

### `routine_task_templates`

```txt
id
workspace_id
routine_id
title
process_id
assignee_profile_id
approval_mode
evidence_policy
sort_order
created_at
updated_at
```

Índices:

- `(workspace_id, routine_id)`
- `(workspace_id, assignee_profile_id)`
- `(workspace_id, process_id)`

### `task_occurrences`

```txt
id
workspace_id
routine_id
task_template_id
title
process_id
assignee_profile_id
approval_mode
evidence_policy
status
due_date
comment
photo_url
submitted_by_profile_id
submitted_at
created_at
updated_at
```

Índices:

- unique `(workspace_id, task_template_id, due_date)`
- `(workspace_id, assignee_profile_id, due_date)`
- `(workspace_id, status)`

### `evidences`

```txt
id
workspace_id
task_occurrence_id
profile_id
type
comment
photo_url
created_at
```

### `approvals`

```txt
id
workspace_id
task_occurrence_id
requested_by_profile_id
approver_profile_id
status
request_comment
decision_comment
requested_at
decided_at
created_at
updated_at
```

### `trainings`

```txt
id
workspace_id
title
description
status
created_by_profile_id
published_at
archived_at
created_at
updated_at
```

### `training_materials`

```txt
id
workspace_id
training_id
kind
title
body
url
sort_order
created_at
updated_at
```

Índices:

- `(workspace_id, training_id)`
- `(workspace_id, kind)`

### `training_assignments`

```txt
id
workspace_id
training_id
audience_type
area_id
role_template_id
person_profile_id
due_at
created_at
```

### `quiz_questions`

```txt
id
workspace_id
training_id
prompt
options_json
correct_option_id
explanation
sort_order
created_at
updated_at
```

### `quiz_attempts`

```txt
id
workspace_id
training_id
profile_id
score
passed
answers_json
completed_at
created_at
```

### `announcements`

```txt
id
workspace_id
title
body
type
audience_type
area_id
role_template_id
person_profile_id
requires_confirmation
requires_quiz
created_by_profile_id
published_at
created_at
updated_at
archived_at
```

### `announcement_receipts`

```txt
id
workspace_id
announcement_id
profile_id
status
read_at
confirmed_at
quiz_completed_at
created_at
updated_at
```

### `comment_threads`

```txt
id
workspace_id
target_type
target_id
created_at
updated_at
```

### `comments`

```txt
id
workspace_id
thread_id
profile_id
body
created_at
updated_at
deleted_at
```

### `templates`

```txt
id
workspace_id
scope
area
segment
type
level
title
description
payload_json
created_at
updated_at
```

### `ai_drafts`

```txt
id
workspace_id
profile_id
type
input_mode
input_text
source_url
status
result_json
created_at
updated_at
```

---

## 3. Enums iniciais

```txt
baase_role = owner | manager | employee
profile_status = active | invited | suspended | archived
access_scope = all_published_processes | area_and_role
content_status = draft | published | archived
training_material_kind = lesson | pdf | link
routine_status = active | paused | archived
task_status = pending | in_progress | awaiting_approval | completed | needs_adjustment | late | dismissed
approval_mode = direct | approval_required
evidence_policy = optional | comment_required | photo_required | photo_or_comment_required
announcement_type = simple | process_change | mandatory_training
audience_type = all | area | role | person
ai_draft_type = process | routine | training | announcement | script
```
