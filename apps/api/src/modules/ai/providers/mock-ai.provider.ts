import type {
  AiProvider,
  AiStructuredProviderRequest,
  AiTextStreamEvent,
  AudioTranscriptionResult
} from "../ai.types";

type MockAiProviderOptions = {
  structuredOutput?: unknown;
  transcript?: AudioTranscriptionResult;
  streamEvents?: AiTextStreamEvent[];
  embeddings?: number[][];
};

export function createMockAiProvider(options: MockAiProviderOptions = {}): AiProvider {
  return {
    async generateStructured(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("AI_STRUCTURED_CANCELLED");
      return options.structuredOutput ?? createDefaultStructuredOutput(request);
    },

    async *streamText(request) {
      if (options.streamEvents) {
        yield* options.streamEvents;
        return;
      }

      const text = "Vamos organizar este pensamento com calma e preservar o original.";
      yield { type: "delta", text: "Vamos organizar este pensamento " };
      yield { type: "delta", text: "com calma e preservar o original." };
      if (request.allowExternalResearch) {
        yield {
          type: "citation",
          title: "Fonte pública de demonstração",
          url: "https://example.com/pesquisa",
          publishedAt: null
        };
      }
      yield { type: "done", text };
    },

    async createEmbeddings(request) {
      return options.embeddings ?? request.inputs.map(createDeterministicEmbedding);
    },

    async transcribeAudio() {
      return options.transcript ?? {
        text: "Transcrição demo: transformar a fala do dono em processo operacional com etapas, responsáveis, evidência e aprovação.",
        confidence: 0.82,
        durationSeconds: 12
      };
    }
  };
}

function createDeterministicEmbedding(input: string) {
  const vector = [0, 0, 0, 0];
  for (let index = 0; index < input.length; index += 1) {
    vector[index % vector.length] = (vector[index % vector.length] ?? 0) + (input.codePointAt(index) ?? 0);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function createDefaultStructuredOutput(request: AiStructuredProviderRequest) {
  if (request.taskKind === "onboarding_setup") return createOnboardingSetupSuggestion(request);
  if (request.taskKind === "onboarding_diagnosis") return createOnboardingDiagnosis(request);
  if (request.taskKind === "process_draft") return createProcessDraft(request);
  if (request.taskKind === "routine_draft") return createRoutineDraft(request);
  if (request.taskKind === "training_draft") return createTrainingDraft(request);
  if (request.taskKind === "announcement_draft") return createAnnouncementDraft(request);
  return {};
}

function createOnboardingSetupSuggestion(request: AiStructuredProviderRequest) {
  const input = request.input as {
    companyName?: string;
    segment?: string;
  };
  const segment = readInputField(request.input, "segment") || "Empresa operacional";
  return {
    companyName: input.companyName ?? "Empresa Baase",
    segment,
    confidence: "medium",
    assumptions: [
      "Modo demo sem provedor externo: a estrutura foi gerada como ponto de partida revisável."
    ],
    gaps: [{
      title: "Responsáveis por área",
      reason: "Algumas responsabilidades ainda precisam ser confirmadas pelo dono.",
      suggestedQuestion: "Quem responde por cada área no dia a dia?"
    }],
    areas: [
      { id: "area_operacoes", name: "Operações", description: "Entrega diária, padrões e rotina.", metadata: metadata("Área central para organizar a entrega do negócio.", "create") },
      { id: "area_atendimento", name: "Atendimento", description: "Relacionamento com clientes e retornos.", metadata: metadata("Clientes recorrentes precisam de cadência clara.", "create") },
      { id: "area_financeiro", name: "Financeiro", description: "Cobrança, conciliação e fechamento.", metadata: metadata("Rotina financeira reduz pendências invisíveis.", "create") }
    ],
    roles: [
      { id: "role_gestor_operacoes", areaName: "Operações", name: "Gestor de operações", description: "Garante execução e melhoria de processos.", metadata: metadata("Dá dono claro para a execução operacional.", "create") },
      { id: "role_atendimento_cs", areaName: "Atendimento", name: "Atendimento / CS", description: "Mantém cadência e comunicação com clientes.", metadata: metadata("Centraliza retornos e alinhamentos com clientes.", "create") },
      { id: "role_responsavel_financeiro", areaName: "Financeiro", name: "Responsável financeiro", description: "Cuida de recebimentos e fechamento.", metadata: metadata("Evita que cobrança e fechamento fiquem soltos.", "create") }
    ],
    people: [
      {
        id: "person_owner_placeholder",
        name: "Dono da empresa",
        email: null,
        role: "owner",
        areaName: "Operações",
        roleName: "Gestor de operações",
        placeholder: true,
        metadata: metadata("Responsável inicial até confirmar os nomes reais.", "create")
      }
    ],
    processes: [{
      id: "process_onboarding_operacional",
      title: `Onboarding operacional - ${segment}`,
      summary: "Processo inicial para tirar operação da cabeça do dono.",
      objective: "Padronizar a entrada de um novo fluxo operacional para a equipe executar sem depender da memória do dono.",
      trigger: "Sempre que uma nova demanda operacional precisar sair da conversa informal e entrar na execução do Baase.",
      operationalRule: "Nenhuma demanda operacional deve avançar sem contexto, responsável e próximo passo registrados.",
      steps: [
        {
          title: "Registrar contexto e objetivo",
          instruction: "Descreva o que precisa ser feito, para quem, por que isso importa e qual resultado final é esperado.",
          expectedResult: "A equipe entende o pedido sem precisar buscar contexto em conversas antigas.",
          attentionPoints: ["Não registrar apenas uma frase solta.", "Não deixar o objetivo implícito."]
        },
        {
          title: "Definir responsável e prazo",
          instruction: "Escolha a pessoa ou área responsável e registre quando a próxima atualização deve acontecer.",
          expectedResult: "Existe dono claro para a execução e para o próximo acompanhamento.",
          attentionPoints: ["Evite responsáveis genéricos como 'time'.", "Confirme se o prazo é viável."]
        },
        {
          title: "Executar o roteiro combinado",
          instruction: "Siga o padrão definido, registre dúvidas no Baase e sinalize qualquer bloqueio antes de atrasar a entrega.",
          expectedResult: "A execução acontece com histórico e sem depender de cobrança manual.",
          attentionPoints: ["Não resolver bloqueios só pelo WhatsApp."]
        }
      ],
      areaName: "Operações",
      metadata: metadata("Cria o primeiro padrão replicável da empresa.")
    },
    {
      id: "process_retorno_cliente",
      title: "Retorno semanal para clientes",
      summary: "Cadência para atualizar clientes sobre entregas e próximos passos.",
      objective: "Evitar que o cliente fique sem visibilidade sobre entregas, pendências e próximos passos.",
      trigger: "Toda semana, antes do fechamento da agenda de atendimento ao cliente.",
      operationalRule: "Todo cliente ativo deve ter uma atualização objetiva registrada no Baase.",
      steps: [
        {
          title: "Revisar entregas da semana",
          instruction: "Confira o que foi entregue, o que avançou e o que ainda está pendente para cada cliente.",
          expectedResult: "A atualização parte de fatos recentes, não de memória.",
          attentionPoints: ["Não misture clientes diferentes.", "Confirme se o status está atualizado."]
        },
        {
          title: "Listar pendências e bloqueios",
          instruction: "Separe as pendências que dependem da equipe, do cliente ou de outra área e defina o próximo passo.",
          expectedResult: "Cada bloqueio tem origem, responsável e encaminhamento.",
          attentionPoints: ["Não esconder bloqueios para evitar conversa difícil."]
        },
        {
          title: "Enviar atualização objetiva",
          instruction: "Comunique ao cliente o que foi feito, o que falta e quando será o próximo retorno.",
          expectedResult: "O cliente entende o andamento sem precisar cobrar a equipe.",
          attentionPoints: ["Não prometer prazo sem validar capacidade."]
        }
      ],
      areaName: "Atendimento",
      metadata: metadata("Reduz ruído com clientes e aumenta previsibilidade.")
    },
    {
      id: "process_fechamento_financeiro",
      title: "Fechamento financeiro semanal",
      summary: "Rotina de conferência de cobranças, recebimentos e pendências.",
      objective: "Dar visibilidade semanal sobre recebimentos, cobranças pendentes e inconsistências financeiras.",
      trigger: "Toda semana, antes do dono tomar decisões sobre caixa, cobrança ou próximos pagamentos.",
      operationalRule: "Nenhuma pendência financeira deve ficar apenas em planilha solta ou conversa informal.",
      steps: [
        {
          title: "Conferir recebimentos",
          instruction: "Compare os recebimentos previstos com os valores realmente recebidos no período.",
          expectedResult: "A lista de recebimentos pagos e pendentes fica atualizada.",
          attentionPoints: ["Confirme datas e valores antes de marcar como recebido."]
        },
        {
          title: "Atualizar cobranças pendentes",
          instruction: "Registre quais clientes ainda precisam ser cobrados e qual canal será usado para o retorno.",
          expectedResult: "Cada cobrança pendente tem próximo passo definido.",
          attentionPoints: ["Não deixar cobrança sem responsável."]
        },
        {
          title: "Enviar resumo ao dono",
          instruction: "Apresente recebimentos, pendências, divergências e decisões necessárias em uma mensagem objetiva.",
          expectedResult: "O dono recebe um panorama claro para decidir sem revisar tudo do zero.",
          attentionPoints: ["Não esconder divergências pequenas."]
        }
      ],
      areaName: "Financeiro",
      metadata: metadata("Torna pendências financeiras visíveis antes do fechamento.")
    }],
    routines: [
      {
        id: "routine_abertura_dia",
        title: "Abertura do dia",
        areaName: "Operações",
        frequency: "daily",
        taskTitles: ["Conferir prioridades", "Distribuir pendências", "Registrar bloqueios"],
        metadata: metadata("Dá visibilidade diária sem depender de cobrança manual.")
      },
      {
        id: "routine_revisao_clientes",
        title: "Revisão de clientes em andamento",
        areaName: "Atendimento",
        frequency: "weekly",
        taskTitles: ["Listar clientes ativos", "Checar próximos retornos", "Registrar riscos"],
        metadata: metadata("Mantém a carteira acompanhada com cadência simples.")
      },
      {
        id: "routine_cobrancas_pendentes",
        title: "Conferência de cobranças pendentes",
        areaName: "Financeiro",
        frequency: "weekly",
        taskTitles: ["Conferir vencimentos", "Atualizar status", "Avisar responsável"],
        metadata: metadata("Evita atrasos por falta de acompanhamento.")
      }
    ],
    trainings: [
      {
        id: "training_registrar_evidencias",
        title: "Como executar e registrar evidências",
        description: "Aula curta para alinhar execução diária no Baase.",
        materialBody: "Execute o checklist, registre evidência quando solicitado e sinalize bloqueios antes do prazo.",
        quizPrompt: "O que deve acontecer ao finalizar uma tarefa com evidência?",
        metadata: metadata("A equipe precisa entender o padrão de registro antes de escalar.")
      },
      {
        id: "training_sinalizar_bloqueios",
        title: "Como sinalizar bloqueios cedo",
        description: "Treinamento para registrar impedimentos antes de afetarem entregas.",
        materialBody: "Ao perceber um bloqueio, descreva o problema, o impacto e o apoio necessário no Baase.",
        quizPrompt: "Quando um bloqueio deve ser registrado?",
        metadata: metadata("Bloqueios visíveis reduzem retrabalho e cobranças de última hora.")
      }
    ],
    announcement: {
      id: "announcement_change_to_baase",
      title: "Nova organizacao operacional no Baase",
      body: "Equipe, vamos centralizar processos, rotinas e evidencias no Prymeira Baase para dar mais clareza ao dia a dia.",
      metadata: metadata("Ajuda a equipe a entender a mudanca.", "draft")
    },
    activationPlan: [
      { day: 1, title: "Revisar mapa da empresa", objective: "Confirmar areas, cargos e responsaveis.", action: "open_company_map" },
      { day: 2, title: "Revisar processos principais", objective: "Ajustar os processos mais importantes.", action: "review_processes" },
      { day: 3, title: "Ativar primeira rotina", objective: "Comecar a execucao diaria com baixa friccao.", action: "activate_routine" },
      { day: 4, title: "Publicar primeiro treinamento", objective: "Alinhar a equipe em um comportamento essencial.", action: "publish_training" },
      { day: 5, title: "Convidar equipe", objective: "Trazer os funcionarios para a visao certa.", action: "invite_team" },
      { day: 6, title: "Acompanhar primeiras execucoes", objective: "Ver atrasos e duvidas reais.", action: "review_today" },
      { day: 7, title: "Revisar painel", objective: "Ajustar gargalos e proximos passos.", action: "review_dashboard" }
    ]
  };
}

function metadata(reason: string, reviewDefault: "create" | "draft" | "publish" | "activate" = "draft") {
  return {
    reason,
    basedOn: ["respostas do onboarding", "objetivos selecionados"],
    expectedImpact: "Dar clareza operacional e reduzir dependencia do dono.",
    source: "inferred",
    reviewDefault
  };
}

function createOnboardingDiagnosis(request: AiStructuredProviderRequest) {
  const input = request.input as {
    companyName?: string;
    normalizedSegment?: string;
    segment?: string;
  };
  const companyName = input.companyName ?? "Empresa Baase";
  const normalizedSegment = input.normalizedSegment ?? input.segment ?? "Operacao geral";

  return {
    companyName,
    normalizedSegment,
    confidence: "medium",
    operationalSummary: `Entendemos uma operacao de ${normalizedSegment} que precisa transformar conhecimento do dono em execucao diaria.`,
    businessModel: "Servico com rotina operacional",
    customerProfile: "Clientes atendidos pela equipe",
    deliveryModel: "Entrada, execucao, revisao e acompanhamento",
    detectedAreas: [
      { id: "area_operacoes", name: "Operacoes", description: "Entrega diaria, padroes e rotina.", source: "inferred", reason: "A operacao foi citada como gargalo principal." },
      { id: "area_atendimento", name: "Atendimento", description: "Relacionamento e retornos para clientes.", source: "template", reason: "Empresas de servico precisam de cadencia com clientes." }
    ],
    detectedPeople: [
      { id: "person_owner", name: "Dono da empresa", roleHint: "Gestor operacional", areaName: "Operacoes", source: "placeholder" }
    ],
    bottlenecks: [
      { id: "bottleneck_owner", title: "Dependencia do dono", description: "Decisoes e padroes ainda ficam concentrados no dono.", severity: "high", source: "inferred" }
    ],
    assumptions: ["Responsaveis por area ainda precisam ser confirmados."],
    followupQuestions: [
      { id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define cargos, permissoes e convites.", expectedUse: "people", priority: 1 },
      { id: "aprovacoes", question: "Em quais tarefas a equipe precisa anexar evidencia ou pedir aprovacao?", reason: "Define rotinas executaveis.", expectedUse: "approval_evidence", priority: 2 }
    ]
  };
}

function createProcessDraft(request: AiStructuredProviderRequest) {
  const title = titleFromRequest(request, "Processo operacional criado com IA");
  return {
    title,
    summary: "Rascunho estruturado em modo demo para revisão antes da publicação.",
    objective: "Transformar o pedido do dono em um fluxo executável pela equipe.",
    trigger: "Sempre que a situação descrita acontecer.",
    operationalRule: "Nenhuma execução deve depender somente de memória, WhatsApp ou orientação verbal.",
    areaName: null,
    roleName: null,
    steps: [
      {
        title: "Receber o gatilho",
        instruction: "Identifique o contexto, o responsável inicial, o prazo e o resultado esperado antes de iniciar.",
        expectedResult: "A pessoa responsável sabe exatamente por que o processo começou e o que precisa entregar.",
        attentionPoints: ["Não começar com pedido incompleto.", "Não deixar prazo implícito."]
      },
      {
        title: "Executar o padrão",
        instruction: "Siga a sequência combinada, registre dúvidas e trate bloqueios antes de avançar para a próxima etapa.",
        expectedResult: "O trabalho avança dentro do padrão definido pela empresa.",
        attentionPoints: ["Não improvisar fora do processo sem registrar."]
      },
      {
        title: "Conferir o resultado",
        instruction: "Revise se o que foi feito atende ao objetivo, ao cliente interno ou externo e ao padrão de qualidade esperado.",
        expectedResult: "Erros de escopo, cliente, versão ou prioridade são identificados antes da conclusão.",
        attentionPoints: ["Não concluir sem revisar o resultado final."]
      },
      {
        title: "Fechar e comunicar",
        instruction: "Atualize o status no Baase e avise as pessoas impactadas sobre conclusão, pendências ou próximo passo.",
        expectedResult: "A equipe consegue entender o status sem depender de conversa solta.",
        attentionPoints: ["Não deixar pendência sem dono."]
      }
    ],
    assumptions: ["Gerado em modo demo; revise nomes de áreas, cargos e prazos."],
    gaps: ["Definir responsável final e SLA ideal."]
  };
}

function createRoutineDraft(request: AiStructuredProviderRequest) {
  const title = titleFromRequest(request, "Rotina operacional criada com IA");
  return {
    title,
    frequency: "daily",
    areaName: null,
    roleName: null,
    tasks: [
      {
        title: "Conferir prioridades da rotina",
        dueHint: "Início do expediente",
        evidencePolicy: "optional",
        approvalMode: "direct"
      },
      {
        title: "Executar checklist principal",
        dueHint: "Até o prazo combinado",
        evidencePolicy: "comment_required",
        approvalMode: "direct"
      },
      {
        title: "Registrar evidência ou bloqueio",
        dueHint: "Antes de concluir",
        evidencePolicy: "photo_or_comment_required",
        approvalMode: "approval_required"
      },
      {
        title: "Marcar conclusão no Baase",
        dueHint: "Fim da rotina",
        evidencePolicy: "optional",
        approvalMode: "direct"
      }
    ],
    linkedProcessTitle: null,
    assumptions: ["A rotina foi criada em modo demo com frequência diária."],
    gaps: ["Definir responsável fixo e horário exato."]
  };
}

function createTrainingDraft(request: AiStructuredProviderRequest) {
  const title = titleFromRequest(request, "Treinamento operacional criado com IA");
  return {
    title,
    description: "Treinamento curto gerado em modo demo para alinhar execução e evidências.",
    targetAreaName: null,
    targetRoleName: null,
    lesson: {
      title: "Aula curta",
      body: "Objetivo: garantir que a pessoa execute o padrão sem depender de memória ou WhatsApp.\n\nQuando usar: antes de iniciar a rotina ou processo relacionado.\n\nPasso a passo: 1. leia o padrão publicado; 2. execute cada item em ordem; 3. registre evidência ou bloqueio no Baase; 4. avise o responsável quando algo sair do combinado.\n\nExemplo prático: se uma entrega travar por falta de arquivo, registre o bloqueio no Baase antes do prazo em vez de resolver só por mensagem.\n\nEvite: executar de memória, pular evidência ou deixar exceções sem registro."
    },
    quiz: [
      {
        prompt: "Qual é o objetivo principal de registrar evidência?",
        options: [
          { id: "a", label: "Criar histórico confiável da execução" },
          { id: "b", label: "Substituir o processo por improviso" }
        ],
        correctOptionId: "a",
        explanation: "A evidência dá visibilidade e reduz dependência da memória."
      },
      {
        prompt: "O que fazer quando existe um bloqueio?",
        options: [
          { id: "a", label: "Registrar o bloqueio antes do prazo" },
          { id: "b", label: "Esperar alguém perguntar" }
        ],
        correctOptionId: "a",
        explanation: "Bloqueios precisam aparecer cedo para o gestor agir."
      }
    ],
    assumptions: ["Treinamento gerado em modo demo."],
    gaps: ["Adicionar exemplos reais da empresa."]
  };
}

function createAnnouncementDraft(request: AiStructuredProviderRequest) {
  const title = titleFromRequest(request, "Comunicado operacional criado com IA");
  return {
    title,
    body: "Equipe, a partir de agora este padrão deve ser seguido no Baase. Execute o processo combinado, registre evidência quando solicitado e sinalize qualquer bloqueio antes do prazo.",
    type: "simple",
    requirement: "read_confirmation",
    audience: { type: "all" },
    quiz: [],
    assumptions: ["Comunicado criado para toda a equipe em modo demo."],
    gaps: ["Definir data de início e responsáveis impactados."]
  };
}

function titleFromRequest(request: AiStructuredProviderRequest, fallback: string) {
  const text = readText(request.input);
  const normalized = text.replace(/^(criar|gerar|escrever|transformar)\s+/i, "").trim();
  return (normalized || fallback).slice(0, 80);
}

function readText(input: unknown) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "text" in input && typeof input.text === "string") return input.text;
  return "";
}

function readInputField(input: unknown, key: string) {
  if (input && typeof input === "object" && key in input && typeof input[key as keyof typeof input] === "string") {
    return input[key as keyof typeof input] as string;
  }
  return "";
}
