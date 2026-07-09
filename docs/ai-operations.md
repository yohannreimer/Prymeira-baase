# Prymeira Baase — IA, Jobs e Storage

> Especificação operacional para IA, transcrição, jobs e armazenamento de arquivos do Baase.

Atualizado em: 2026-07-07

Spec detalhada do runtime, harness, agentes, prompts, schemas, guardrails e evals:

```txt
docs/superpowers/specs/2026-07-07-baase-ai-runtime-design.md
```

---

## 1. Princípio central

A IA do Baase transforma conhecimento em estrutura operacional, mas não publica nada sozinha.

Fluxo obrigatório:

```txt
entrada -> sugestão/rascunho -> revisão humana -> ativo/publicado
```

---

## 2. Casos de uso de IA

### Sob demanda

- Criar processo.
- Criar rotina.
- Gerar checklist.
- Gerar treinamento.
- Melhorar processo.
- Transformar áudio em SOP.
- Transformar PDF em treinamento.
- Resumir comentários.
- Criar comunicado sobre mudança.
- Sugerir perguntas de quiz.

### Proativa em pontos-chave

- rotina atrasou várias vezes;
- processo gerou muitas dúvidas;
- processo foi alterado;
- treinamento teve muitas reprovações;
- rotina crítica sem aprovação;
- cargo sem treinamento;
- área criada sem rotina.

---

## 3. Provider

Fase 1 implementada com `AiHarness` interno. O backend depende da interface, não diretamente dos SDKs em módulos de domínio.

Providers:

- OpenAI SDK para geração estruturada quando `OPENAI_API_KEY` existir.
- Deepgram SDK para transcrição quando `DEEPGRAM_API_KEY` existir.
- Mock provider seguro quando chaves não estiverem configuradas.

```ts
export type AiProvider = {
  generateStructuredDraft(input: AiDraftInput): Promise<AiDraftResult>;
  transcribeAudio(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult>;
};
```

Rotas atuais do runtime:

```txt
GET  /ai/runs
POST /ai/drafts
POST /ai/onboarding/suggestions
POST /ai/transcriptions
```

`/ai/drafts` cria sugestões/rascunhos prontos para revisão.  
`/ai/onboarding/suggestions` gera a estrutura inicial da empresa a partir do onboarding inteligente.  
`/ai/transcriptions` usa a camada de transcrição do harness.  
`/ai/runs` mostra o histórico técnico das execuções do workspace.

### Onboarding inteligente com IA

`POST /ai/onboarding/suggestions` recebe segmento, respostas abertas e contexto do workspace.

Payload:

```json
{
  "segment": "Agência de marketing",
  "answers": [
    {
      "question": "O que mais trava a empresa?",
      "answer": "O dono responde tudo e faltam processos claros.",
      "input_mode": "audio"
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

O frontend renderiza essa sugestão na revisão. O aceite persiste por `/onboarding/setup`, mantendo a regra central: IA sugere, humano aprova, o sistema publica/cria.

### Transcrição de áudio

`POST /ai/transcriptions` aceita áudio hospedado (`audio_url`) ou áudio gravado no navegador (`audio_base64` + `mime_type`). O onboarding usa o segundo formato na Fase 3.

Payload com gravação direta:

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

No V1 desta fase o áudio trafega em JSON para simplificar o produto. Storage assinado entra quando houver biblioteca persistente de capturas.

---

## 4. Saídas estruturadas

IA deve retornar JSON validado por Zod antes de persistir.

Exemplo de rascunho de processo:

```json
{
  "type": "process",
  "title": "Fechamento de caixa",
  "summary": "Rotina para conferir e registrar o caixa no fim do dia.",
  "steps": [
    "Conferir dinheiro em caixa.",
    "Fotografar comprovantes.",
    "Registrar diferença, se existir.",
    "Enviar para aprovação do gestor."
  ],
  "suggested_area": "Financeiro",
  "suggested_evidence_mode": "photo_and_comment",
  "suggested_approval_mode": "approval_required"
}
```

---

## 5. Prompts de produto

Tom:

- claro;
- operacional;
- sem jargão;
- orientado a execução;
- sem prometer diagnóstico abstrato.

Regras:

- perguntar o mínimo necessário;
- explicitar lacunas quando faltam dados;
- sugerir evidência e aprovação quando fizer sentido;
- nunca inventar política como se fosse regra aprovada;
- marcar tudo como sugestão ou rascunho.

---

## 6. Jobs

### `generate-daily-task-occurrences`

Cria tarefas do dia a partir de rotinas ativas.

Entrada:

```txt
workspace_id
date
```

Regras:

- rotina por empresa: gerar para responsáveis configurados;
- rotina por área: gerar para pessoas ativas da área;
- rotina por cargo: gerar para pessoas ativas do cargo;
- rotina por pessoa: gerar somente para a pessoa;
- não duplicar tarefa para mesma rotina/pessoa/data.

### `mark-late-task-occurrences`

Marca tarefas como atrasadas quando `due_at` passou e status ainda é acionável.

### `transcribe-audio`

Processa áudio enviado pelo dono/gestor.

Saída:

```txt
transcript_text
confidence?
duration_seconds
```

### `generate-ai-draft`

Gera rascunho estruturado e salva em `ai_drafts`.

---

## 7. Storage

Arquivos V1:

- fotos de evidência;
- PDFs e materiais de treinamento;
- anexos de processo;
- áudios de captura.

Provider recomendado:

- Cloudflare R2 ou S3 compatível.

Estrutura de chaves:

```txt
workspaces/{workspace_id}/evidence/{task_id}/{file_id}
workspaces/{workspace_id}/training/{training_id}/{file_id}
workspaces/{workspace_id}/processes/{process_id}/{file_id}
workspaces/{workspace_id}/audio-captures/{draft_id}/{file_id}
```

Regras:

- nunca aceitar chave de storage vinda do client;
- gerar upload assinado no backend;
- validar tamanho e MIME type;
- guardar metadados no banco;
- URLs públicas só quando necessário.
