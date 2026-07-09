# Prymeira Baase — API Contract

> Contrato inicial da API do Baase. Este documento descreve as rotas privadas, payloads, respostas e regras de autorização para guiar backend, web e testes.

Atualizado em: 2026-07-07

---

## 1. Convenções

### Base URL local

```txt
http://localhost:3090
```

### Auth

Todas as rotas privadas exigem:

```http
Authorization: Bearer <clerk_token>
```

A API deve:

1. validar o token Clerk;
2. chamar Account API `/access-check?product_key=base`;
3. exigir `allowed=true`;
4. usar `workspace_id` retornado pela Account API;
5. resolver o perfil operacional do usuário no Baase.

### Modo local futuro

Para desenvolvimento, poderá existir:

```txt
BAASE_LOCAL_AUTH_BYPASS=true
BAASE_LOCAL_WORKSPACE_ID=local_workspace
BAASE_LOCAL_ROLE=owner
```

Esse modo deve ser recusado quando `NODE_ENV=production`.

### Erros

Formato padrão:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Nome da área é obrigatório.",
    "details": {}
  }
}
```

---

## 2. Health

### `GET /health`

Resposta:

```json
{
  "ok": true,
  "service": "baase-api",
  "product_key": "base"
}
```

---

## 3. Me

### `GET /me`

Retorna usuário operacional atual.

Resposta:

```json
{
  "workspace": {
    "id": "workspace_123",
    "name": "Clínica Silva"
  },
  "profile": {
    "id": "profile_owner",
    "role": "owner",
    "display_name": "Ana Silva",
    "area_id": null,
    "role_template_id": null
  },
  "home_route": "/painel"
}
```

---

## 4. Áreas

### `GET /areas`

Lista áreas do workspace.

Resposta:

```json
{
  "areas": [
    {
      "id": "area_atendimento",
      "name": "Atendimento",
      "description": "Relacionamento com clientes",
      "sort_order": 1
    }
  ]
}
```

### `POST /areas`

Cria área.

Permissão: `owner`.

Payload:

```json
{
  "name": "Financeiro",
  "description": "Caixa, cobranças e recebimentos"
}
```

Resposta:

```json
{
  "area": {
    "id": "area_financeiro",
    "name": "Financeiro",
    "description": "Caixa, cobranças e recebimentos",
    "sort_order": 2
  }
}
```

Validações:

- `name` obrigatório;
- `name` máximo 80 caracteres;
- `description` máximo 240 caracteres.

---

## 5. Cargos

### `GET /roles`

Lista cargos por área.

### `POST /roles`

Permissão: `owner`.

Payload:

```json
{
  "area_id": "area_atendimento",
  "name": "Atendente",
  "description": "Responsável pelo primeiro atendimento"
}
```

---

## 6. Convites e pessoas

### `GET /people`

Lista perfis operacionais do workspace.

### `POST /invites`

Cria convite por link/código.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "email": "maria@empresa.com",
  "role": "employee",
  "area_id": "area_atendimento",
  "role_template_id": "role_atendente",
  "access_scope": "all_published_processes"
}
```

Resposta:

```json
{
  "invite": {
    "id": "invite_123",
    "code": "ABC123",
    "url": "https://baase.prymeiradigital.com.br/convite/ABC123",
    "status": "pending"
  }
}
```

### `GET /invites/:code`

Rota pública para pré-visualizar convite.

### `POST /invites/:code/accept`

Rota autenticada para aceitar convite e criar perfil operacional.

---

## 7. Processos

### `GET /processes`

Lista processos.

Filtros:

```txt
status=draft|published|archived
area_id=<id>
```

### `POST /processes`

Cria processo em rascunho.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "title": "Fechamento de caixa",
  "area_id": "area_financeiro",
  "body": "Conferir caixa, fotografar comprovantes e guardar envelope.",
  "owner_profile_id": "profile_owner"
}
```

Resposta:

```json
{
  "process": {
    "id": "process_123",
    "title": "Fechamento de caixa",
    "status": "draft",
    "current_version": {
      "version": 1,
      "change_note": "Criação inicial"
    }
  }
}
```

### `POST /processes/:id/versions`

Cria nova versão.

Payload:

```json
{
  "body": "Novo conteúdo do processo.",
  "change_note": "Inclui foto obrigatória do comprovante."
}
```

### `POST /processes/:id/publish`

Publica processo.

### `POST /processes/:id/archive`

Arquiva processo.

---

## 8. Rotinas e tarefas

### `GET /routines`

Lista rotinas do workspace atual.

### `POST /routines`

Cria rotina com templates de tarefas executáveis.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "title": "Abertura da loja",
  "area_id": "area_operacao",
  "task_templates": [
    {
      "title": "Fotografar recepção pronta",
      "process_id": "process_123",
      "assignee_profile_id": "profile_employee",
      "approval_mode": "direct",
      "evidence_policy": "photo_or_comment_required"
    }
  ]
}
```

Campos:

- `approval_mode`: `direct` ou `approval_required`;
- `evidence_policy`: `optional`, `photo_required`, `comment_required`, `photo_or_comment_required`;
- `process_id`: opcional para conectar a tarefa a um processo publicado;
- `assignee_profile_id`: opcional para permitir tarefa ainda sem responsável definido.

### `POST /routines/:id/occurrences/generate`

Gera as tarefas de uma rotina para uma data, sem duplicar templates já gerados.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "due_date": "2026-07-07"
}
```

Resposta:

```json
{
  "tasks": [
    {
      "id": "task_123",
      "routineId": "routine_123",
      "taskTemplateId": "template_123_1",
      "title": "Fotografar recepção pronta",
      "status": "pending",
      "dueDate": "2026-07-07"
    }
  ]
}
```

### `GET /today`

Retorna o inbox operacional do usuário atual para a data: tarefas, treinamentos atribuídos e comunicados pendentes.

Query:

```txt
date=2026-07-07
```

Resposta:

```json
{
  "tasks": [],
  "training_assignments": [
    {
      "assignmentId": "training_assignment_1",
      "trainingId": "training_1",
      "profileId": "profile_employee",
      "status": "pending",
      "dueDate": "2026-07-10",
      "training": { "id": "training_1", "title": "Atendimento em 15 minutos" }
    }
  ],
  "announcements": [
    {
      "id": "announcement_1",
      "title": "Novo padrão de atendimento",
      "receipt": { "status": "pending" }
    }
  ]
}
```

### `POST /tasks/:id/submit`

Envia execução da tarefa com comentário e/ou foto.

Payload:

```json
{
  "comment": "Mensagens pendentes conferidas.",
  "photo_url": null
}
```

Resposta para rotina direta:

```json
{
  "task": {
    "id": "task_123",
    "status": "completed"
  }
}
```

Resposta para rotina com aprovação:

```json
{
  "task": {
    "id": "task_123",
    "status": "awaiting_approval"
  }
}
```

---

## 9. Treinamentos

### `POST /trainings`

Cria treinamento em rascunho.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "title": "Atendimento inicial",
  "description": "Como responder o primeiro contato.",
  "materials": [
    {
      "kind": "lesson",
      "title": "Aula curta",
      "body": "Cumprimente, qualifique e encaminhe."
    },
    {
      "kind": "pdf",
      "title": "Script PDF",
      "url": "https://cdn.example.com/script.pdf"
    }
  ],
  "quiz_questions": [
    {
      "prompt": "Qual é o primeiro passo?",
      "options": [
        { "id": "a", "label": "Cumprimentar" },
        { "id": "b", "label": "Encerrar conversa" }
      ],
      "correct_option_id": "a",
      "explanation": "O primeiro contato começa com acolhimento."
    }
  ]
}
```

Campos:

- `materials.kind`: `lesson`, `pdf` ou `link`;
- `quiz_questions` pode começar vazio;
- treinamento sempre nasce como `draft`.

### `POST /trainings/:id/publish`

Publica treinamento.

Permissão: `owner` ou `manager`.

### `POST /trainings/:id/assignments`

Atribui treinamento publicado para um público.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "audience_type": "all",
  "area_id": null,
  "role_template_id": null,
  "profile_id": null,
  "due_date": "2026-07-10"
}
```

### `GET /training-assignments`

Lista progresso de treinamento para o perfil atual.

Query:

```txt
date=2026-07-07
```

Resposta:

```json
{
  "assignments": [
    {
      "assignmentId": "training_assignment_1",
      "trainingId": "training_1",
      "profileId": "profile_employee",
      "status": "pending",
      "score": null,
      "passed": null
    }
  ]
}
```

### `POST /trainings/:id/attempts`

Registra tentativa de quiz.

Payload:

```json
{
  "answers": [
    {
      "question_id": "question_123",
      "option_id": "a"
    }
  ]
}
```

Resposta:

```json
{
  "attempt": {
    "id": "attempt_123",
    "score": 100,
    "passed": true
  }
}
```

---

## 10. Comunicados

### `POST /announcements`

Cria comunicado em rascunho.

Permissão: `owner` ou `manager`.

Payload:

```json
{
  "title": "Novo padrão de fechamento de caixa",
  "body": "A partir de hoje, comprovantes devem ser fotografados.",
  "type": "process_change",
  "requirement": "read_confirmation",
  "audience_type": "area",
  "area_id": "area_financeiro",
  "role_template_id": null,
  "profile_id": null,
  "quiz_questions": []
}
```

### `GET /announcements`

Para `owner`/`manager`, lista comunicados do workspace. Para funcionário, lista comunicados publicados para o perfil atual com `receipt`.

### `POST /announcements/:id/publish`

Publica comunicado.

Permissão: `owner` ou `manager`.

### `POST /announcements/:id/confirm`

Confirma leitura ou envia resposta do quiz.

Payload:

```json
{
  "answers": [
    { "question_id": "announcement_question_1", "option_id": "a" }
  ]
}
```

### `GET /announcement-receipts`

Lista confirmações registradas.

Permissão: `owner` ou `manager`.

Query:

```txt
announcement_id=announcement_1
```

---

## 11. IA

### `POST /ai/drafts`

Gera rascunho sob demanda.

Payload:

```json
{
  "type": "process",
  "input_mode": "text",
  "input": "Todo dia a atendente precisa responder mensagens pendentes até 10h.",
  "context": {
    "segment": "clinica_estetica",
    "area_id": "area_atendimento"
  }
}
```

Resposta:

```json
{
  "draft": {
    "id": "draft_123",
    "type": "process",
    "title": "Responder mensagens pendentes",
    "body": "Passo a passo sugerido...",
    "status": "ready_for_review"
  }
}
```

Regra:

> IA nunca publica diretamente.

### `POST /ai/onboarding/suggestions`

Gera a estrutura inicial revisável do onboarding inteligente.

Payload:

```json
{
  "segment": "Agência de marketing",
  "answers": [
    {
      "question": "Quais áreas existem hoje?",
      "answer": "Atendimento, criação e mídia, mas o dono ainda centraliza aprovações.",
      "input_mode": "text"
    }
  ],
  "context": {
    "workspaceName": "Norte Ops"
  }
}
```

Resposta:

```json
{
  "suggestion": {
    "segment": "Agência de marketing",
    "confidence": "high",
    "areas": [],
    "roles": [],
    "people": [],
    "processes": [],
    "routines": [],
    "trainings": [],
    "assumptions": [],
    "gaps": []
  },
  "ai_run": {
    "id": "ai_run_123",
    "status": "completed"
  }
}
```

Depois da revisão humana, o frontend envia a sugestão aceita para `POST /onboarding/setup`.

### `POST /ai/transcriptions`

Transcreve áudio pelo harness de IA. Aceita URL ou gravação direta em base64.

Payload com `audio_url`:

```json
{
  "source": "onboarding",
  "audio_url": "https://storage.baase.local/audio.wav",
  "language": "pt-BR",
  "keyterms": ["processos", "rotinas"]
}
```

Payload com `audio_base64`:

```json
{
  "source": "onboarding",
  "audio_base64": "YnJvd3Nlci1hdWRpbw==",
  "mime_type": "audio/webm",
  "language": "pt-BR",
  "keyterms": ["Prymeira Baase", "processos", "rotinas", "treinamentos"]
}
```

Resposta:

```json
{
  "transcript": {
    "text": "Atendemos clientes recorrentes e precisamos tirar processos da cabeça do dono.",
    "confidence": 0.95,
    "duration_seconds": 5,
    "words": []
  }
}
```
