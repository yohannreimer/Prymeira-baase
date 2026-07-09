# Prymeira Baase — AI Runtime Design

Atualizado em: 2026-07-07

## 1. Objetivo

O Baase AI Runtime é a camada central de inteligência do Prymeira Baase. Ele transforma conhecimento informal do dono em operação executável: áreas, cargos, pessoas, processos, rotinas, treinamentos, comunicados, lacunas e sugestões proativas.

Esta camada não é um chat genérico. Ela é uma máquina de operacionalização.

Regra-mãe:

```txt
entrada -> transcrição/contexto -> agente especialista -> saída estruturada -> validação -> revisão humana -> ativo/publicado
```

A IA nunca publica, ativa ou altera conteúdo visível para funcionários sem revisão humana explícita.

## 2. Decisões De Plataforma

### 2.1 Transcrição

Provider padrão: Deepgram.

Modelo padrão:

```txt
nova-3
```

Configuração inicial:

```txt
model=nova-3
language=multi ou pt-BR conforme contexto
smart_format=true
utterances=true
diarize_model=latest em áudios longos ou com múltiplas pessoas
keyterm=<termos do workspace>
redact=<PII> quando necessário
```

Uso:

- onboarding por áudio;
- áudio para processo;
- áudio para rotina;
- gravações longas do dono explicando a operação;
- entrevistas futuras com equipe.

Keyterms devem ser gerados por workspace:

- nome da empresa;
- nome dos clientes;
- áreas;
- cargos;
- nomes de pessoas;
- ferramentas usadas;
- termos recorrentes do segmento.

### 2.2 Modelo De Raciocínio

Provider padrão: OpenAI.

Modelo principal:

```txt
gpt-5.5
```

Uso:

- onboarding inteligente;
- criação de processos;
- criação de rotinas;
- criação de treinamentos;
- revisão operacional;
- análise proativa;
- transformação de material longo em estrutura.

Modelo econômico futuro:

```txt
gpt-5.4-mini ou equivalente configurável
```

Uso:

- classificação simples;
- títulos;
- resumos;
- tags;
- detecção de intenção;
- normalização curta.

### 2.3 API E SDK

V1 deve suportar dois runners:

```txt
StructuredResponseRunner
AgentWorkflowRunner
```

`StructuredResponseRunner` usa Responses API com Structured Outputs para tarefas determinísticas de uma chamada.

`AgentWorkflowRunner` usa Agents SDK quando o fluxo exige especialistas, ferramentas, handoffs, guardrails e tracing mais rico.

Uso recomendado no início:

- onboarding completo: `StructuredResponseRunner` com schema forte;
- áudio para processo: `StructuredResponseRunner`;
- revisão operacional: `StructuredResponseRunner`;
- fluxos proativos e multi-etapa: `AgentWorkflowRunner`.

## 3. Princípios De Produto

1. IA transforma conhecimento em estrutura operacional.
2. IA não substitui o dono; ela tira a empresa da cabeça dele.
3. IA nunca publica sozinha.
4. Toda sugestão deve virar algo que um funcionário consegue executar.
5. Sem nota abstrata de organização.
6. Sem diagnóstico genérico.
7. Toda saída deve separar fato informado, inferência e lacuna.
8. Se faltar dado, a IA sugere e marca como sugestão.
9. A IA deve perguntar pouco e produzir muito.
10. A IA deve preferir clareza operacional a linguagem bonita.

## 4. Arquitetura

```txt
apps/api/src/modules/ai
  ai.types.ts
  ai.service.ts
  ai.routes.ts
  ai-harness.ts
  model-router.ts
  context-builder.ts
  prompt-registry.ts
  schema-registry.ts
  guardrails.ts
  evals/
  providers/
    openai.provider.ts
    deepgram.provider.ts
    mock-ai.provider.ts
  agents/
    onboarding-architect.agent.ts
    process-architect.agent.ts
    routine-architect.agent.ts
    training-architect.agent.ts
    ops-reviewer.agent.ts
    proactive-ops-analyst.agent.ts
```

### 4.1 Fluxo De Áudio

```txt
client grava áudio
  -> backend cria upload assinado
  -> áudio vai para storage
  -> backend cria AudioCapture
  -> job transcribe-audio
  -> Deepgram Nova-3
  -> TranscriptRecord
  -> TranscriptNormalizer
  -> AiRun com transcript normalizado
  -> agente especialista
  -> draft/suggestion
```

### 4.2 Fluxo De Texto

```txt
client envia texto
  -> AiRun
  -> ContextBuilder
  -> AgentProfile
  -> modelo
  -> structured output
  -> Zod validation
  -> OpsReviewer opcional
  -> draft/suggestion
```

### 4.3 Fluxo De Onboarding

```txt
segmento + respostas + transcrições
  -> OnboardingArchitect
  -> OnboardingSetupSuggestion
  -> OpsReviewer
  -> tela Revisão
  -> dono aceita/edita/ignora
  -> POST /onboarding/setup
```

## 5. Harness

O harness é a única entrada permitida para chamadas de IA.

### 5.1 Interface

```ts
export type AiHarness = {
  runStructured<TInput, TOutput>(
    request: AiStructuredRunRequest<TInput, TOutput>
  ): Promise<AiStructuredRunResult<TOutput>>;

  runAgent<TInput, TOutput>(
    request: AiAgentRunRequest<TInput, TOutput>
  ): Promise<AiAgentRunResult<TOutput>>;

  transcribeAudio(
    request: AudioTranscriptionRequest
  ): Promise<AudioTranscriptionResult>;
};
```

### 5.2 `AiRun`

Cada execução gera um registro.

```ts
export type AiRun = {
  id: string;
  workspaceId: string;
  actorProfileId: string;
  source: "onboarding" | "create_with_ai" | "process" | "routine" | "training" | "proactive";
  inputMode: "text" | "audio" | "pdf" | "mixed";
  agentKey: string;
  promptVersion: string;
  model: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
  status: "queued" | "running" | "needs_review" | "failed" | "completed";
  traceId: string | null;
  inputSummary: string;
  outputSummary: string | null;
  validationErrors: string[];
  costEstimateCents: number | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
};
```

### 5.3 Model Router

```ts
export type AiTaskKind =
  | "onboarding_setup"
  | "process_draft"
  | "routine_draft"
  | "training_draft"
  | "ops_review"
  | "transcript_cleanup"
  | "classification"
  | "proactive_suggestion";
```

Roteamento inicial:

```txt
onboarding_setup      -> gpt-5.5, reasoning medium
process_draft         -> gpt-5.5, reasoning medium
routine_draft         -> gpt-5.5, reasoning medium
training_draft        -> gpt-5.5, reasoning medium
ops_review            -> gpt-5.5, reasoning low
transcript_cleanup    -> gpt-5.5 ou mini, reasoning low
classification        -> mini, reasoning none/low
proactive_suggestion  -> gpt-5.5, reasoning medium
```

## 6. Agentes

### 6.1 Onboarding Architect

Missão:

Transformar respostas abertas do dono em uma empresa inicial revisável.

Entrada:

- segmento;
- respostas de texto;
- transcrições;
- contexto do workspace;
- templates por segmento;
- preferências de equipe.

Saída:

- áreas;
- cargos;
- pessoas sugeridas;
- processos sugeridos;
- rotinas sugeridas;
- treinamentos sugeridos;
- lacunas;
- perguntas de follow-up opcionais.

Critérios:

- gerar estrutura suficiente para começar;
- não criar complexidade demais;
- marcar tudo como sugestão;
- explicar inferências.

### 6.2 Process Architect

Missão:

Transformar fala informal, texto, PDF ou comentário em processo operacional.

Saída:

- título;
- objetivo;
- gatilho;
- quando usar;
- etapas;
- responsável sugerido;
- área sugerida;
- evidência sugerida;
- aprovação sugerida;
- riscos;
- lacunas.

### 6.3 Routine Architect

Missão:

Transformar processos ou dores recorrentes em checklist executável.

Saída:

- título;
- frequência;
- área/cargo/pessoa sugeridos;
- tarefas;
- prazo sugerido;
- evidência por tarefa;
- aprovação por tarefa;
- processo vinculado;
- critério de conclusão.

### 6.4 Training Architect

Missão:

Transformar processo, PDF ou material em treinamento curto.

Saída:

- título;
- descrição;
- aula curta;
- material de apoio;
- quiz;
- resposta correta;
- explicação;
- cargo/área recomendado.

### 6.5 Ops Reviewer

Missão:

Revisar se a saída da IA é clara, segura e executável.

Checks:

- um funcionário conseguiria executar?
- existe responsável ou regra de atribuição?
- existe evidência quando necessário?
- a aprovação faz sentido?
- tem etapa ambígua?
- inventou política não informada?
- misturou sugestão com fato?
- está genérico demais?

Saída:

```txt
approved | needs_revision
issues[]
suggested_fixes[]
quality_score interno
```

O `quality_score` é interno e nunca vira nota para o usuário.

### 6.6 Proactive Ops Analyst

Missão futura:

Ler sinais operacionais reais e propor ações.

Gatilhos:

- atrasos recorrentes;
- tarefas devolvidas;
- processo com muitas dúvidas;
- treinamento pendente;
- cargo sem treinamento;
- área sem rotina;
- processo alterado sem comunicado;
- baixa execução de rotina crítica.

Regra:

Só aparece quando existe evidência operacional concreta.

## 7. Prompt Registry

Prompts devem ser versionados e testáveis.

```ts
export type PromptDefinition = {
  key: string;
  version: string;
  agentKey: string;
  modelFamily: "gpt-5.5";
  system: string;
  developer: string;
  outputSchemaKey: string;
  changelog: string;
};
```

### 7.1 `system/product-principles@1`

```txt
Você é a camada de IA operacional do Prymeira Baase.

O Baase ajuda donos de pequenas empresas a tirar a operação da cabeça e transformar conhecimento informal em processos, rotinas, treinamentos e execução diária da equipe.

Você não é um consultor genérico, coach, mentor ou chatbot.
Você é um arquiteto operacional.

Regras permanentes:
- Nunca publique, ative ou altere conteúdo final.
- Tudo que você cria é sugestão ou rascunho.
- Separe fatos informados, inferências e lacunas.
- Prefira execução concreta a explicação bonita.
- Não dê nota abstrata de organização.
- Não invente políticas como se fossem aprovadas.
- Quando faltar dado, crie uma sugestão razoável e marque a lacuna.
- Escreva em português do Brasil, claro, premium e direto.
- Crie estruturas que funcionários reais conseguiriam executar.
```

### 7.2 `agent/onboarding-architect@1`

```txt
Resultado esperado:
Montar uma empresa inicial revisável para o Baase.

Você receberá segmento, respostas abertas, transcrições e contexto existente.
Gere uma estrutura operacional inicial com áreas, cargos, pessoas, processos, rotinas, treinamentos e lacunas.

Critérios de sucesso:
- A estrutura deve ser útil no primeiro dia.
- Processos devem ter nomes claros e objetivo operacional.
- Rotinas devem virar checklists executáveis.
- Treinamentos devem ser curtos e vinculados a comportamento.
- Cargos devem ser simples e reconhecíveis.
- Pessoas sugeridas devem usar nomes informados quando existirem; se não existirem, use placeholders amigáveis e marque como sugestão.
- Evite criar mais de 6 áreas no V1.
- Evite criar mais de 8 processos iniciais.
- Evite criar mais de 8 rotinas iniciais.
- Evite criar mais de 6 treinamentos iniciais.
- Inclua lacunas que o dono deve revisar.

Não escreva relatório.
Retorne somente o objeto estruturado no schema solicitado.
```

### 7.3 `agent/process-architect@1`

```txt
Resultado esperado:
Criar um rascunho de processo operacional a partir de entrada informal.

Transforme a entrada em um SOP claro:
- título;
- resumo;
- objetivo;
- gatilho;
- etapas;
- evidência sugerida;
- aprovação sugerida;
- área/cargo sugeridos;
- lacunas.

Cada etapa deve começar com verbo de ação.
Evite frases vagas como "alinhar internamente" sem explicar o que deve acontecer.
Se o processo depende do dono, proponha como tirar essa dependência.
```

### 7.4 `agent/routine-architect@1`

```txt
Resultado esperado:
Criar uma rotina executável com checklist.

Transforme a entrada em:
- rotina;
- frequência sugerida;
- tarefas;
- responsável sugerido;
- prazo;
- evidência;
- aprovação;
- processo vinculado quando fizer sentido.

Cada tarefa deve caber em uma execução do dia.
Não crie tarefas que dependem de "lembrar" ou "combinar por fora".
```

### 7.5 `agent/training-architect@1`

```txt
Resultado esperado:
Criar treinamento curto para funcionário executar melhor.

Transforme o material em:
- aula curta;
- pontos principais;
- exemplo prático;
- quiz;
- resposta correta;
- explicação.

Treinamentos do Baase são operacionais, não acadêmicos.
Eles ensinam o comportamento esperado dentro da empresa.
```

### 7.6 `agent/ops-reviewer@1`

```txt
Resultado esperado:
Revisar uma sugestão operacional antes dela chegar ao dono.

Avalie:
- clareza;
- executabilidade;
- lacunas;
- riscos;
- excesso de invenção;
- necessidade de evidência;
- necessidade de aprovação;
- consistência com o segmento;
- consistência com contexto do workspace.

Se estiver bom, aprove.
Se não estiver, marque issues e sugira correções.
Não publique nada.
```

### 7.7 `agent/transcript-normalizer@1`

```txt
Resultado esperado:
Limpar uma transcrição sem perder informação operacional.

Você pode:
- remover hesitações;
- organizar frases;
- corrigir termos óbvios com base nos keyterms;
- separar tópicos;
- preservar nomes, ferramentas, áreas e dores.

Você não pode:
- inventar etapas;
- resumir demais;
- remover incertezas importantes;
- transformar sugestão em fato.
```

## 8. Schemas

### 8.1 Onboarding Setup Suggestion

```ts
export const OnboardingSetupSuggestionSchema = z.object({
  segment: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  assumptions: z.array(z.string()),
  gaps: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    suggestedQuestion: z.string()
  })),
  areas: z.array(z.object({
    name: z.string(),
    description: z.string().nullable(),
    source: z.enum(["user_provided", "inferred", "template"])
  })),
  roles: z.array(z.object({
    areaName: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    source: z.enum(["user_provided", "inferred", "template"])
  })),
  people: z.array(z.object({
    name: z.string(),
    email: z.string().nullable(),
    role: z.enum(["owner", "manager", "employee"]),
    areaName: z.string().nullable(),
    roleName: z.string().nullable(),
    source: z.enum(["user_provided", "placeholder", "inferred"])
  })),
  processes: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    body: z.string(),
    areaName: z.string().nullable(),
    reason: z.string()
  })),
  routines: z.array(z.object({
    title: z.string(),
    areaName: z.string().nullable(),
    frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]),
    taskTitles: z.array(z.string()),
    reason: z.string()
  })),
  trainings: z.array(z.object({
    title: z.string(),
    description: z.string(),
    materialBody: z.string(),
    quizPrompt: z.string(),
    reason: z.string()
  }))
});
```

### 8.2 Process Draft

```ts
export const ProcessDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  trigger: z.string(),
  areaName: z.string().nullable(),
  roleName: z.string().nullable(),
  steps: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    evidencePolicy: z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]),
    approvalMode: z.enum(["direct", "approval_required"])
  })),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});
```

### 8.3 Routine Draft

```ts
export const RoutineDraftSchema = z.object({
  title: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]),
  areaName: z.string().nullable(),
  roleName: z.string().nullable(),
  tasks: z.array(z.object({
    title: z.string(),
    dueHint: z.string().nullable(),
    evidencePolicy: z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]),
    approvalMode: z.enum(["direct", "approval_required"])
  })),
  linkedProcessTitle: z.string().nullable(),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});
```

### 8.4 Training Draft

```ts
export const TrainingDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  targetAreaName: z.string().nullable(),
  targetRoleName: z.string().nullable(),
  lesson: z.object({
    title: z.string(),
    body: z.string()
  }),
  quiz: z.array(z.object({
    prompt: z.string(),
    options: z.array(z.object({
      id: z.string(),
      label: z.string()
    })),
    correctOptionId: z.string(),
    explanation: z.string()
  })),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});
```

## 9. Guardrails

### 9.1 Guardrails De Entrada

- bloquear prompt injection óbvio em uploads e textos;
- limitar tamanho por plano;
- detectar áudio vazio;
- rejeitar MIME type inválido;
- redigir PII quando necessário;
- separar conteúdo do usuário de instruções do sistema.

### 9.2 Guardrails De Saída

- validar schema com Zod;
- rejeitar saída sem etapas em processo;
- rejeitar rotina sem checklist;
- rejeitar treinamento sem quiz quando o fluxo exigir quiz;
- rejeitar conteúdo que publique automaticamente;
- rejeitar linguagem de certeza quando a fonte for inferida;
- rejeitar recomendações legais, médicas ou financeiras específicas;
- marcar como `needs_revision` se a saída estiver genérica.

### 9.3 Human Review

Toda saída operacional deve ter um destes estados:

```txt
suggested
draft
ready_for_review
published
active
rejected
```

A IA só pode criar:

```txt
suggested
draft
ready_for_review
```

## 10. Observabilidade

Cada execução deve registrar:

- workspace;
- usuário;
- agente;
- prompt version;
- modelo;
- reasoning effort;
- schema;
- status;
- latência;
- custo estimado;
- erros de validação;
- trace id;
- input summary;
- output summary.

Nunca guardar áudio bruto em logs textuais.

Nunca guardar prompt com dados sensíveis fora do storage/DB esperado.

## 11. Evals

### 11.1 Dataset Inicial

Criar exemplos para:

- agência de marketing;
- restaurante;
- clínica;
- salão;
- loja/varejo;
- e-commerce.

Cada exemplo deve ter:

- segmento;
- resposta do dono;
- transcrição com ruído;
- saída esperada;
- critérios de aprovação.

### 11.2 Graders

Grader de onboarding:

- criou áreas úteis?
- criou cargos coerentes?
- criou rotinas executáveis?
- criou processos claros?
- criou treinamentos curtos?
- marcou lacunas?
- evitou publicação automática?

Grader de processo:

- etapas começam com verbo?
- existe gatilho?
- existe critério de conclusão?
- evidência faz sentido?
- aprovação faz sentido?

Grader de treinamento:

- aula é curta?
- quiz testa comportamento real?
- resposta correta é inequívoca?

### 11.3 Golden Tests Locais

Além de evals de plataforma, manter fixtures locais:

```txt
apps/api/src/modules/ai/__fixtures__/
  onboarding-agency.json
  onboarding-restaurant.json
  process-audio-whatsapp.json
  routine-opening-day.json
  training-approval-flow.json
```

Esses testes rodam sem chamar provider real usando `mock-ai.provider.ts`.

## 12. APIs

### 12.1 Transcrição

```txt
POST /ai/audio-captures
POST /ai/audio-captures/:id/transcribe
GET  /ai/audio-captures/:id
```

### 12.2 Drafts

```txt
POST /ai/drafts
GET  /ai/drafts
GET  /ai/drafts/:id
POST /ai/drafts/:id/accept
POST /ai/drafts/:id/reject
```

### 12.3 Onboarding

```txt
POST /ai/onboarding/suggestions
POST /onboarding/setup
```

`POST /ai/onboarding/suggestions` gera sugestões.  
`POST /onboarding/setup` persiste o que o dono aceitou.

## 13. Banco

Com a estratégia JSONB atual, adicionar kinds:

```txt
ai_run
ai_draft
audio_capture
transcript
prompt_version
ai_eval_result
```

Normalização futura:

```txt
ai_runs
ai_drafts
audio_captures
transcripts
prompt_versions
ai_eval_results
```

## 14. Fases De Implementação

### Fase 1 — Harness Base

- tipos;
- prompt registry;
- schema registry;
- mock provider;
- OpenAI provider;
- Deepgram provider;
- logs de `AiRun`;
- testes unitários.

### Fase 2 — Onboarding IA Real

- endpoint `/ai/onboarding/suggestions`;
- schema `OnboardingSetupSuggestion`;
- revisão na UI;
- persistência via `/onboarding/setup`;
- fixtures por segmento.

### Fase 3 — Áudio Real

- upload assinado;
- `AudioCapture`;
- Deepgram Nova-3;
- transcript normalizer;
- áudio -> processo;
- áudio -> onboarding.

### Fase 4 — Criar Com IA Completo

- processo;
- rotina;
- treinamento;
- comunicado;
- PDF -> treinamento.

### Fase 5 — AgentWorkflowRunner

- Agents SDK;
- OpsReviewer automático;
- tracing;
- handoffs;
- human review pause.

### Fase 6 — Evals E Qualidade

- datasets;
- graders;
- trace grading;
- regressão de prompts;
- dashboard interno de qualidade.

### Fase 7 — IA Proativa

- sinais operacionais;
- sugestões sob demanda;
- nunca interromper sem evidência concreta.

## 15. Critério De Pronto Para O Núcleo IA

O núcleo inicial está pronto quando:

- Deepgram transcreve áudio real;
- OpenAI gera saída estruturada validada;
- prompts são versionados;
- `AiRun` registra cada execução;
- onboarding gera empresa completa;
- processos/rotinas/treinamentos nascem como rascunhos ou sugestões;
- dono revisa antes de publicar/ativar;
- testes cobrem providers mockados;
- existe ao menos um dataset de eval local;
- nenhuma chamada de IA fica espalhada fora do harness.

## 16. Fontes De Referência

- OpenAI latest model guide: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI guardrails and human review: https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- OpenAI evals: https://developers.openai.com/api/docs/guides/evals
- Deepgram Nova-3 model options: https://developers.deepgram.com/docs/model
- Deepgram Keyterm Prompting: https://developers.deepgram.com/docs/keyterm
- Deepgram diarization: https://developers.deepgram.com/docs/diarization
