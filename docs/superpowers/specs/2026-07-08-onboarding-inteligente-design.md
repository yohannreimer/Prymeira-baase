# Prymeira Baase — Onboarding Inteligente Design

Atualizado em: 2026-07-08

## 1. Objetivo

Transformar o onboarding do Prymeira Baase no primeiro momento wow do produto.

Quando um dono cria uma empresa nova, ele nao deve cair em um painel vazio nem em uma pagina comum do menu. Ele deve entrar em uma experiencia guiada, em tela cheia, que entende a empresa e monta a primeira versao operacional revisavel: mapa da empresa, areas, cargos, pessoas, processos, rotinas, treinamentos, comunicado inicial, convites e plano leve de ativacao.

O onboarding deve parecer uma conversa inteligente com um arquiteto operacional. Por baixo, ele deve salvar dados estruturados e usar o AI Harness para gerar diagnostico e estrutura inicial com rastreabilidade.

## 2. Norte De Produto

O onboarding precisa provar a promessa central do Baase:

```txt
tirar a empresa da cabeca do dono -> transformar em operacao executavel -> permitir revisao humana -> preparar a equipe para executar
```

Principios:

- A experiencia deve ser premium, calma e simples.
- A IA deve perguntar pouco e produzir muito.
- O dono sempre revisa antes de publicar, ativar ou convidar.
- Areas, cargos e pessoas podem ser criados como base da empresa.
- Processos, rotinas, treinamentos e comunicado entram como rascunho por padrao.
- Rotinas nao geram tarefas reais ate serem ativadas pelo dono.
- Pessoas sem email viram placeholders editaveis.
- O progresso deve ser salvo automaticamente.

## 3. Estado Atual

Hoje o app ja possui:

- tela interna `Onboarding IA`;
- selecao simples de segmento;
- tres perguntas abertas;
- resposta por audio ou texto;
- endpoint `/api/ai/onboarding/suggestions`;
- agente `onboarding_architect`;
- schema `onboarding_setup_suggestion`;
- endpoint `/api/onboarding/setup`;
- criacao real de areas, cargos, pessoas, processos, rotinas e treinamentos.

Limitacoes atuais:

- onboarding aparece como uma pagina do app, nao como primeira experiencia obrigatoria;
- nao existe sessao persistida de onboarding;
- nao existe etapa intermediaria de diagnostico;
- a revisao final ainda e rasa;
- aceitar/ignorar itens na UI nao controla o payload final;
- nao existe fluxo por etapas para revisao completa;
- nao existe status de onboarding no workspace;
- nao existe plano de 7 dias nem comunicado opcional estruturado.

## 4. Escopo V1

Incluido:

- onboarding obrigatorio para workspace vazio de dono novo;
- botao discreto `Configurar depois`;
- identidade inicial da empresa;
- conversa guiada com 3 blocos;
- audio ou texto por bloco;
- anexos opcionais;
- diagnostico intermediario;
- ate 3 perguntas essenciais, uma por vez;
- geracao premium da empresa;
- revisao final em etapas;
- edicao por drawer no desktop e tela cheia no mobile;
- autosave;
- criacao de areas, cargos e pessoas/placeholders;
- rascunhos de processos, rotinas, treinamentos, comunicado e convites;
- plano de ativacao de 7 dias;
- tela final `Empresa pronta`.

Fora do V1:

- cobranca/billing;
- validacao Clerk completa;
- upload definitivo em storage externo;
- importacao profunda de planilhas complexas;
- automacoes reais do plano de 7 dias;
- envio automatico de convites;
- publicacao automatica para funcionarios.

## 5. Experiencia

### 5.1 Entrada

Regra para abrir onboarding automaticamente:

- usuario tem papel `owner`;
- workspace esta vazio ou sem estrutura operacional minima;
- `workspace.onboarding_status` e `not_started` ou `in_progress`;
- onboarding ainda nao foi concluido.

O app deve abrir uma tela cheia, sem sidebar, sem dashboard vazio e sem modal.

CTA principal:

```txt
Montar minha empresa com IA
```

CTA secundario discreto:

```txt
Configurar depois
```

Se o dono pular, entra no app com estado vazio premium e chamada persistente para retomar o onboarding.

### 5.2 Identidade Inicial

Campos:

- nome da empresa;
- segmento;
- campo livre quando segmento for `Outro`;
- faixa de equipe;
- objetivos multiplos.

Segmentos:

- Agencia de marketing;
- Servicos locais;
- Clinica;
- Restaurante;
- Loja / varejo;
- E-commerce;
- Consultoria;
- Outro.

Faixas de equipe:

- So eu;
- 2 a 5 pessoas;
- 6 a 15 pessoas;
- 16 a 40 pessoas;
- Mais de 40 pessoas.

Objetivos:

- Tirar processos da minha cabeca;
- Organizar a equipe;
- Reduzir atrasos e esquecimentos;
- Treinar funcionarios melhor;
- Ter mais controle da operacao;
- Preparar a empresa para escalar;
- Melhorar aprovacoes e qualidade das entregas;
- Parar de depender do WhatsApp para cobrar tarefas.

Esses dados devem chegar ao harness de IA como campos estruturados.

### 5.3 Conversa Guiada

A experiencia principal usa 3 blocos, cada um com audio ou texto:

1. Como a empresa funciona

```txt
O que sua empresa vende, para quem vende e como normalmente acontece a entrega?
```

2. Pessoas e responsabilidades

```txt
Quem faz parte da equipe hoje e o que cada pessoa costuma cuidar?
```

3. Gargalos e padroes

```txt
O que mais atrasa, se perde, depende de voce ou precisa virar padrao para a equipe executar melhor?
```

Cada resposta deve ser enviada com:

```ts
{
  questionId: "operations_overview" | "people_responsibilities" | "bottlenecks_standards",
  theme: "business_model" | "team_structure" | "operational_bottlenecks",
  answer: string,
  inputMode: "text" | "audio"
}
```

### 5.4 Anexos Opcionais

O onboarding pode aceitar anexos como contexto secundario:

- PDF;
- TXT;
- MD;
- CSV simples.

Texto sugerido:

```txt
Tem algo pronto? Anexe um manual, lista de funcionarios, planilha simples ou processo antigo para melhorar a estrutura inicial.
```

Anexos nao bloqueiam o fluxo.

### 5.5 Diagnostico Intermediario

Antes de gerar a empresa, a IA deve mostrar a tela:

```txt
Entendi sua empresa
```

Conteudo:

- resumo operacional;
- modelo de negocio detectado;
- cliente principal ou publico atendido;
- areas provaveis;
- pessoas citadas;
- responsabilidades identificadas;
- gargalos principais;
- pontos de atencao;
- lacunas;
- nivel de confianca;
- origem de cada conclusao: informado, inferido ou modelo.

O dono pode corrigir:

- resumo;
- areas detectadas;
- pessoas citadas;
- gargalos principais;
- lacunas irrelevantes.

Essas correcoes atualizam a sessao antes das perguntas essenciais.

### 5.6 Perguntas Essenciais

A IA pode fazer ate 3 perguntas de complemento. Elas aparecem uma por vez, como conversa guiada.

Controles:

- responder por audio;
- responder por texto;
- pular pergunta;
- gerar agora;
- indicador `1 de 3`.

As perguntas devem ser escolhidas por impacto, nao por curiosidade. Exemplos:

- Quem aprova uma entrega antes de ir para o cliente?
- Quem responde por cada area no dia a dia?
- Em quais tarefas sua equipe precisa anexar foto, comentario ou pedir aprovacao?
- Quem cuida do financeiro?
- O que um funcionario novo mais pergunta antes de conseguir executar sozinho?

Evidencia e aprovacao entram como pergunta apenas quando forem relevantes para o segmento ou gargalos citados.

### 5.7 Geracao Premium

Ao gerar a estrutura final, mostrar uma experiencia visual calma com etapas:

1. Entendendo sua operacao
2. Encontrando areas e responsaveis
3. Transformando gargalos em processos
4. Criando rotinas executaveis
5. Montando treinamentos iniciais
6. Preparando revisao final

Direcao visual:

- Assistente Operacional Premium;
- tela cheia;
- movimento sutil;
- cards surgindo com areas/processos/rotinas;
- sem excesso de brilho ou efeito decorativo;
- linguagem direta e sofisticada.

### 5.8 Revisao Final

A revisao final e um fluxo por etapas:

1. Mapa da empresa
2. Pessoas e cargos
3. Processos sugeridos
4. Rotinas sugeridas
5. Treinamentos sugeridos
6. Convites e ativacao

Cada item deve mostrar:

- titulo;
- resumo;
- status proposto;
- motivo da sugestao;
- baseado em;
- impacto esperado;
- origem: informado, inferido ou modelo;
- editar;
- remover;
- manter como rascunho;
- publicar/ativar quando aplicavel.

Edicao:

- desktop: drawer lateral;
- mobile: tela cheia;
- formularios completos para o tipo de item.

### 5.9 Criacao Padrao

Ao clicar em:

```txt
Criar primeira versao da empresa
```

O sistema cria:

- areas;
- cargos;
- pessoas reais;
- placeholders editaveis;
- mapa da empresa.

O sistema cria como rascunho:

- processos;
- rotinas;
- treinamentos;
- comunicado interno opcional;
- convites.

Rotinas ficam prontas para ativar, mas nao geram tarefas do dia ate ativacao explicita.

### 5.10 Tela Final

Tela:

```txt
A primeira versao operacional da sua empresa esta pronta.
```

Resumo:

- X areas criadas;
- Y cargos definidos;
- Z pessoas/placeholders;
- X processos em rascunho;
- Y rotinas prontas para ativar;
- Z treinamentos em rascunho;
- 1 comunicado sugerido;
- plano de 7 dias criado.

CTA principal:

```txt
Ir para o Painel
```

CTAs secundarios:

- Revisar processos;
- Convidar equipe;
- Ativar primeira rotina.

## 6. Dados

### 6.1 Workspace

Adicionar campos ao workspace:

```ts
type WorkspaceOnboardingStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "skipped";

type Workspace = {
  onboardingStatus: WorkspaceOnboardingStatus;
  onboardingCompletedAt: string | null;
  onboardingSkippedAt: string | null;
  onboardingSessionId: string | null;
};
```

### 6.2 Sessao De Onboarding

Nova entidade:

```ts
type OnboardingSessionStatus =
  | "not_started"
  | "in_progress"
  | "diagnosis_ready"
  | "followup"
  | "generating_setup"
  | "reviewing"
  | "completed"
  | "skipped";

type OnboardingSession = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  status: OnboardingSessionStatus;
  currentStep: string;
  companyName: string | null;
  segment: string | null;
  customSegment: string | null;
  normalizedSegment: string | null;
  teamSizeRange: string | null;
  goals: string[];
  mainAnswers: OnboardingAnswer[];
  attachments: OnboardingAttachment[];
  diagnosis: OnboardingDiagnosis | null;
  followupQuestions: OnboardingFollowupQuestion[];
  followupAnswers: OnboardingAnswer[];
  generatedSuggestion: OnboardingSetupSuggestion | null;
  reviewDecisions: OnboardingReviewDecision[];
  activationPlan: OnboardingActivationStep[];
  createdSetupSummary: OnboardingCreatedSetupSummary | null;
  aiRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

### 6.3 Placeholders De Pessoas

Pessoas sugeridas sem email devem ser criadas como membros placeholder ou registros equivalentes com status claro:

```ts
type TeamMemberStatus = "active" | "invited" | "placeholder";
```

Campos recomendados:

- name;
- email null;
- role;
- areaId;
- roleTemplateId;
- status `placeholder`;
- source `onboarding`;
- suggestedReason.

## 7. AI Harness

### 7.1 Novas Tasks

Separar o onboarding em duas chamadas principais:

```ts
taskKind: "onboarding_diagnosis"
agentKey: "onboarding_diagnostician"
```

e:

```ts
taskKind: "onboarding_setup"
agentKey: "onboarding_architect"
```

O diagnostician entende e pergunta.
O architect monta a estrutura final.

### 7.2 Input Do Diagnostico

```ts
type OnboardingDiagnosisInput = {
  companyName: string;
  segment: string;
  customSegment: string | null;
  normalizedSegment: string;
  teamSizeRange: string;
  goals: string[];
  answers: OnboardingAnswer[];
  attachments: Array<{
    name: string;
    mimeType: string;
    extractedText: string;
  }>;
  context: {
    workspaceName: string;
    ownerProfileId: string;
  };
};
```

### 7.3 Output Do Diagnostico

```ts
type OnboardingDiagnosis = {
  companyName: string;
  normalizedSegment: string;
  confidence: "low" | "medium" | "high";
  operationalSummary: string;
  businessModel: string | null;
  customerProfile: string | null;
  deliveryModel: string | null;
  detectedAreas: Array<{
    name: string;
    description: string;
    source: "user_provided" | "inferred" | "template";
    reason: string;
  }>;
  detectedPeople: Array<{
    name: string;
    roleHint: string | null;
    areaName: string | null;
    source: "user_provided" | "inferred" | "placeholder";
  }>;
  bottlenecks: Array<{
    title: string;
    description: string;
    severity: "low" | "medium" | "high";
    source: "user_provided" | "inferred";
  }>;
  assumptions: string[];
  followupQuestions: Array<{
    id: string;
    question: string;
    reason: string;
    expectedUse: "areas" | "people" | "processes" | "routines" | "trainings" | "approval_evidence";
    priority: number;
  }>;
};
```

Limite: no maximo 3 `followupQuestions`.

### 7.4 Output Da Estrutura Final

Expandir `onboarding_setup_suggestion` para incluir:

- `companyName`;
- `reasons`;
- `basedOn`;
- `expectedImpact`;
- `reviewDefault`;
- `announcement`;
- `activationPlan`.

Exemplo por item:

```ts
{
  title: "Abertura do dia",
  reason: "Voce citou atrasos e pendencias no inicio da operacao.",
  basedOn: ["gargalos", "objetivos selecionados"],
  expectedImpact: "Reduzir esquecimentos e dar visibilidade diaria ao dono.",
  reviewDefault: "draft"
}
```

### 7.5 Prompting

Atualizar o prompt do `onboarding_architect`:

- usar `companyName`;
- nunca tratar `Outro` como segmento;
- usar `normalizedSegment`;
- limitar a poucos itens excelentes;
- sugerir placeholders quando pessoas nao tiverem nome/email;
- gerar rascunhos revisaveis;
- separar fatos, inferencias e lacunas;
- incluir motivo, base e impacto esperado por item;
- gerar plano de 7 dias como guia leve;
- gerar no maximo 1 comunicado opcional.

Novo prompt do `onboarding_diagnostician`:

- nao criar setup final;
- interpretar respostas;
- extrair areas, pessoas e gargalos;
- sinalizar confianca;
- gerar ate 3 perguntas essenciais;
- permitir que perguntas sobre evidencia/aprovacao aparecam apenas quando tiverem impacto.

## 8. Backend

### 8.1 Repositorios

Adicionar `OnboardingRepository` com:

- createSession;
- getCurrentSession;
- updateSession;
- saveDiagnosis;
- saveFollowupAnswer;
- saveGeneratedSuggestion;
- saveReviewDecision;
- completeSession;
- skipSession.

Implementar em memoria e Postgres.

### 8.2 Rotas

Rotas propostas:

```txt
GET    /onboarding/session
POST   /onboarding/session
PATCH  /onboarding/session
POST   /onboarding/session/skip
POST   /onboarding/session/diagnosis
POST   /onboarding/session/followup-answer
POST   /onboarding/session/generate-setup
PATCH  /onboarding/session/review-decision
POST   /onboarding/session/complete
```

`POST /onboarding/session/complete` deve criar os objetos reais respeitando decisoes de revisao.

### 8.3 Atualizar Setup

O endpoint atual `/onboarding/setup` pode continuar existindo para compatibilidade, mas o novo fluxo deve usar `completeSession`, porque precisa aplicar:

- itens removidos;
- itens editados;
- status de rascunho/publicado/ativo;
- placeholders;
- comunicado;
- plano de 7 dias;
- convites pendentes.

### 8.4 Permissoes

- Apenas owner pode iniciar, pular, gerar e concluir onboarding de workspace.
- Manager e employee nao veem onboarding inicial obrigatorio.
- Se um employee entra por convite em workspace sem onboarding concluido, ele deve ver uma tela de espera simples ou sua visao vazia limitada.

## 9. Frontend

### 9.1 Roteamento

No carregamento do app:

- buscar sessao e status do workspace;
- se owner e onboarding obrigatorio, renderizar `OnboardingShell`;
- se skipped, permitir painel com CTA persistente;
- se completed, abrir app normal.

### 9.2 Componentes

Componentes recomendados:

```txt
OnboardingShell
OnboardingWelcome
CompanyIdentityStep
GoalsStep
GuidedConversationStep
OnboardingAudioAnswer
OnboardingAttachmentDropzone
DiagnosisStep
FollowupQuestionStep
GeneratingSetupStep
ReviewWizard
ReviewMapStep
ReviewPeopleStep
ReviewProcessesStep
ReviewRoutinesStep
ReviewTrainingsStep
ReviewActivationStep
ReviewDrawer
CompanyReadyStep
```

### 9.3 Autosave

Toda mudanca importante deve salvar:

- campo inicial;
- objetivo selecionado;
- resposta escrita;
- transcricao concluida;
- anexo processado;
- correcao de diagnostico;
- resposta de follow-up;
- decisao de revisao.

Padrao:

- debounce curto para texto;
- save imediato para botoes/selecoes;
- indicador discreto `Salvo`;
- retry com mensagem clara em erro.

### 9.4 Estados De UI

Obrigatorios:

- carregando sessao;
- onboarding vazio;
- salvando;
- salvo;
- erro de autosave;
- gravando audio;
- transcrevendo audio;
- diagnosticando;
- gerando setup;
- revisao vazia;
- concluindo onboarding;
- onboarding concluido.

## 10. Review Decisions

Cada item revisavel deve gerar uma decisao:

```ts
type ReviewDecision = {
  itemType: "area" | "role" | "person" | "process" | "routine" | "training" | "announcement" | "invite";
  itemId: string;
  action: "create" | "remove" | "draft" | "publish" | "activate";
  editedPayload: Record<string, unknown> | null;
};
```

Comportamento padrao:

- area: create;
- role: create;
- person: create;
- process: draft;
- routine: draft;
- training: draft;
- announcement: draft;
- invite: draft.

## 11. Plano De 7 Dias

Gerar como guia leve, nao como tarefa obrigatoria.

Exemplo:

1. Revisar mapa da empresa e cargos.
2. Revisar os processos mais importantes.
3. Ativar a primeira rotina diaria.
4. Publicar o primeiro treinamento.
5. Convidar a equipe.
6. Acompanhar primeiras execucoes.
7. Revisar atrasos, duvidas e lacunas.

No painel, esse plano pode aparecer como sugestao proativa enquanto nao for dispensado.

## 12. Erros E Recuperacao

### 12.1 IA Falha

Se diagnostico falhar:

- manter respostas salvas;
- mostrar erro claro;
- permitir tentar novamente;
- permitir continuar com setup base por segmento.

Se geracao final falhar:

- manter diagnostico e respostas;
- permitir tentar novamente;
- nao apagar revisoes feitas.

### 12.2 Transcricao Falha

- manter audio state local;
- mostrar erro;
- permitir gravar de novo;
- permitir escrever resposta manualmente.

### 12.3 Autosave Falha

- manter estado local;
- mostrar `Nao conseguimos salvar agora`;
- retry automatico;
- bloquear conclusao se houver alteracao critica nao salva.

## 13. Testes

### 13.1 Backend

Testar:

- cria sessao para owner;
- employee nao cria sessao;
- salva progresso;
- pula onboarding;
- gera diagnostico;
- salva respostas de follow-up;
- gera setup final;
- aplica review decisions;
- cria placeholders;
- cria conteudos como rascunho por padrao;
- nao gera tarefas de rotina antes de ativacao;
- marca workspace como completed.

### 13.2 AI

Testar:

- schema do diagnostico;
- limite de 3 perguntas;
- `Outro` usa `customSegment`;
- prompt recebe `companyName`;
- output inclui reason, basedOn e expectedImpact;
- output respeita limites de quantidade.

### 13.3 Frontend

Testar:

- owner novo cai no onboarding tela cheia;
- `Configurar depois` entra no app e mostra CTA de retomada;
- campos iniciais salvam;
- segmento `Outro` mostra campo livre;
- objetivos aceitam multipla selecao;
- audio transcreve para bloco correto;
- diagnostico mostra resumo, areas, pessoas, gargalos e perguntas;
- follow-ups aparecem um por vez;
- geracao mostra etapas premium;
- revisao por etapas abre drawer;
- decisoes individuais alteram payload final;
- finalizar mostra tela `Empresa pronta`.

## 14. Criterios De Aceite

O onboarding V1 esta pronto quando:

- workspace novo de owner abre onboarding automaticamente;
- dono pode pular e retomar;
- progresso persiste apos reload;
- nome da empresa, segmento, faixa e objetivos chegam ao harness;
- tres blocos aceitam texto e audio;
- diagnostico intermediario existe e e corrigivel;
- ate 3 perguntas aparecem uma por vez;
- setup final gera poucos itens bons;
- revisao final permite editar/remover/rascunhar/publicar/ativar;
- completar cria objetos reais com status corretos;
- rotinas nao criam tarefas ate ativacao;
- tela final resume o que foi criado;
- testes automatizados cobrem o fluxo principal.

## 15. Sequencia Recomendada De Implementacao

1. Dados e rotas de sessao de onboarding.
2. Status de workspace e roteamento obrigatorio.
3. Nova UI de tela cheia ate conversa guiada.
4. Diagnostico intermediario no harness.
5. Follow-ups e autosave.
6. Geracao final expandida.
7. Revisao por etapas com drawer.
8. Complete session criando objetos reais.
9. Tela final e plano de 7 dias.
10. Polimento visual e testes end-to-end.

## 16. Self Review

- Nao ha placeholders de decisao pendente.
- O fluxo separa diagnostico de criacao final.
- Publicacao automatica foi evitada por padrao.
- O design respeita dono, gestor e funcionario, mantendo onboarding obrigatorio apenas para owner.
- A spec cobre UX, dados, harness, backend, frontend, erros e testes.
- O escopo V1 e grande, mas decomponivel em fases sem mudar a direcao do produto.
