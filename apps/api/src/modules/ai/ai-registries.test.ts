import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { getPromptDefinition, listPromptDefinitions } from "./prompt-registry";
import {
  onboardingDiagnosisSchema,
  onboardingSetupSuggestionSchema,
  processDraftSchema,
  routineDraftSchema,
  trainingDraftSchema
} from "./schema-registry";

describe("AI prompt registry", () => {
  it("ships versioned prompts for the core Baase specialist agents", () => {
    const promptKeys = listPromptDefinitions().map((prompt) => `${prompt.key}@${prompt.version}`);

    expect(promptKeys).toEqual(expect.arrayContaining([
      "agent/onboarding-architect@1",
      "agent/onboarding-diagnostician@1",
      "agent/process-architect@1",
      "agent/routine-architect@1",
      "agent/training-architect@1",
      "agent/ops-reviewer@1",
      "agent/transcript-normalizer@1"
    ]));

    const onboardingPrompt = getPromptDefinition("agent/onboarding-architect", "1");
    expect(onboardingPrompt).toMatchObject({
      agentKey: "onboarding_architect",
      outputSchemaKey: "onboarding_setup_suggestion"
    });
    expect(onboardingPrompt.system).toContain("arquiteto operacional");
    expect(onboardingPrompt.developer).toContain("Não escreva relatório");
  });

  it("registers the onboarding diagnostician prompt", () => {
    const prompt = getPromptDefinition("agent/onboarding-diagnostician", "1");
    expect(prompt).toMatchObject({
      agentKey: "onboarding_diagnostician",
      outputSchemaKey: "onboarding_diagnosis"
    });
  });
});

describe("AI schema registry", () => {
  it("keeps onboarding setup JSON schema compatible with OpenAI structured outputs", () => {
    const jsonSchema = zodTextFormat(onboardingSetupSuggestionSchema, "onboarding_setup_suggestion").schema;
    const serializedSchema = JSON.stringify(jsonSchema);

    expect(serializedSchema).not.toContain("?=");
    expect(serializedSchema).not.toContain("?!");
    expect(serializedSchema).not.toContain("?<=");
    expect(serializedSchema).not.toContain("?<!");
  });

  it("validates onboarding setup suggestions with areas, people and content", () => {
    const metadata = {
      reason: "Sugerido a partir do onboarding.",
      basedOn: ["respostas do onboarding"],
      expectedImpact: "Dar clareza para a operacao.",
      source: "inferred" as const,
      reviewDefault: "draft" as const
    };

    const suggestion = {
      companyName: "Estudio Norte",
      segment: "Agência de marketing",
      confidence: "high",
      assumptions: ["A empresa trabalha com clientes recorrentes."],
      gaps: [{ title: "Responsável financeiro", reason: "Não foi citado.", suggestedQuestion: "Quem cuida do financeiro?" }],
      areas: [{ id: "area_atendimento", name: "Atendimento", description: "Relacionamento com clientes.", metadata: { ...metadata, reviewDefault: "create" } }],
      roles: [{ id: "role_gestor_atendimento", areaName: "Atendimento", name: "Gestor de atendimento", description: null, metadata: { ...metadata, reviewDefault: "create" } }],
      people: [{
        id: "person_marina",
        name: "Marina Alves",
        email: null,
        role: "manager",
        areaName: "Atendimento",
        roleName: "Gestor de atendimento",
        placeholder: false,
        metadata: { ...metadata, source: "user_provided", reviewDefault: "create" }
      }],
      processes: [{
        id: "process_onboarding_cliente",
        title: "Onboarding de cliente novo",
        summary: "Entrada de cliente.",
        objective: "Garantir que todo novo cliente entre com contexto, acesso e próximo passo definidos.",
        trigger: "Sempre que uma venda for fechada e a operação precisar iniciar a entrega.",
        operationalRule: "Nenhum cliente novo deve iniciar sem responsável e escopo registrados.",
        steps: [
          {
            title: "Registrar fechamento comercial",
            instruction: "Confirme cliente, escopo vendido, responsável comercial e data prevista de início.",
            expectedResult: "A operação entende o que foi vendido antes de assumir o cliente.",
            attentionPoints: ["Não iniciar sem escopo confirmado."]
          },
          {
            title: "Coletar acessos e materiais",
            instruction: "Solicite os acessos, arquivos e contatos necessários para iniciar a entrega.",
            expectedResult: "Os insumos principais ficam disponíveis no local correto.",
            attentionPoints: ["Não deixar materiais apenas no WhatsApp."]
          },
          {
            title: "Definir próximo passo operacional",
            instruction: "Registre quem assume o cliente e qual será a primeira ação da entrega.",
            expectedResult: "O cliente tem dono interno e próxima ação definida.",
            attentionPoints: []
          }
        ],
        areaName: "Atendimento",
        metadata
      }],
      routines: [{
        id: "routine_abertura_dia",
        title: "Abertura do dia",
        areaName: "Atendimento",
        frequency: "daily",
        taskTitles: ["Conferir prioridades"],
        metadata
      }],
      trainings: [{
        id: "training_evidencias",
        title: "Como registrar evidências",
        description: "Aula curta.",
        materialBody: "Registre o que foi feito.",
        quizPrompt: "O que deve ficar claro?",
        metadata
      }],
      announcement: {
        id: "announcement_baase",
        title: "Novo padrão operacional",
        body: "Vamos centralizar rotinas no Baase.",
        metadata
      },
      activationPlan: [
        { day: 1, title: "Revisar mapa", objective: "Confirmar areas.", action: "open_company_map" },
        { day: 2, title: "Revisar processos", objective: "Ajustar processos.", action: "review_processes" },
        { day: 3, title: "Ativar rotina", objective: "Comecar execucao.", action: "activate_routine" },
        { day: 4, title: "Publicar treinamento", objective: "Alinhar equipe.", action: "publish_training" },
        { day: 5, title: "Convidar equipe", objective: "Trazer funcionarios.", action: "invite_team" },
        { day: 6, title: "Revisar hoje", objective: "Ver primeiras execucoes.", action: "review_today" },
        { day: 7, title: "Revisar painel", objective: "Ajustar gargalos.", action: "review_dashboard" }
      ]
    };

    const parsed = onboardingSetupSuggestionSchema.parse(suggestion);

    expect(parsed.companyName).toBe("Estudio Norte");
    expect(parsed.areas[0]!.name).toBe("Atendimento");
    expect(parsed.people[0]!.placeholder).toBe(false);
    expect(parsed.activationPlan).toHaveLength(7);
    const { announcement: _announcement, ...withoutAnnouncement } = suggestion;
    expect(onboardingSetupSuggestionSchema.parse(withoutAnnouncement).announcement).toBeUndefined();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      activationPlan: [
        ...suggestion.activationPlan.slice(0, 5),
        { day: 6, title: "Revisar hoje", objective: "Ver primeiras execucoes.", action: "review_today" },
        { day: 6, title: "Dia duplicado", objective: "Duplicar dia seis.", action: "review_dashboard" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      areas: [
        suggestion.areas[0],
        { ...suggestion.areas[0], name: "Financeiro" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      roles: [
        suggestion.roles[0],
        { ...suggestion.roles[0], name: "Analista de atendimento" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      people: [
        suggestion.people[0],
        { ...suggestion.people[0], name: "Bruno Costa" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      processes: [
        suggestion.processes[0],
        { ...suggestion.processes[0], title: "Outro processo" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      routines: [
        suggestion.routines[0],
        { ...suggestion.routines[0], title: "Outra rotina" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      trainings: [
        suggestion.trainings[0],
        { ...suggestion.trainings[0], title: "Outro treinamento" }
      ]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      roles: [{ ...suggestion.roles[0], areaName: "Financeiro" }]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      people: [{ ...suggestion.people[0], areaName: "Financeiro" }]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      people: [{ ...suggestion.people[0], roleName: "Responsavel financeiro" }]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      areas: [
        ...suggestion.areas,
        { id: "area_financeiro", name: "Financeiro", description: null, metadata }
      ],
      roles: [
        ...suggestion.roles,
        { id: "role_financeiro", areaName: "Financeiro", name: "Responsavel financeiro", description: null, metadata }
      ],
      people: [{ ...suggestion.people[0], areaName: "Atendimento", roleName: "Responsavel financeiro" }]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      areas: [
        ...suggestion.areas,
        { id: "area_suporte", name: "Suporte", description: null, metadata }
      ],
      roles: [
        suggestion.roles[0],
        { id: "role_gestor_suporte", areaName: "Suporte", name: "Gestor de atendimento", description: null, metadata }
      ],
      people: [{ ...suggestion.people[0], areaName: null, roleName: "Gestor de atendimento" }]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      processes: [{ ...suggestion.processes[0], areaName: "Financeiro" }]
    })).toThrow();
    expect(() => onboardingSetupSuggestionSchema.parse({
      ...suggestion,
      routines: [{ ...suggestion.routines[0], areaName: "Financeiro" }]
    })).toThrow();
  });

  it("validates onboarding diagnosis with at most three follow-up questions", () => {
    const diagnosis = onboardingDiagnosisSchema.parse({
      companyName: "Estudio Norte",
      normalizedSegment: "Agencia de marketing",
      confidence: "high",
      operationalSummary: "Agencia com entrega recorrente de conteudo e trafego.",
      businessModel: "Servicos recorrentes",
      customerProfile: "Pequenas empresas",
      deliveryModel: "Atendimento, briefing, execucao e aprovacao",
      detectedAreas: [{ id: "area_ops", name: "Operacoes", description: "Entrega diaria.", source: "inferred", reason: "Citada na explicacao." }],
      detectedPeople: [{ id: "person_owner", name: "Dono", roleHint: "Gestor", areaName: "Operacoes", source: "placeholder" }],
      bottlenecks: [{ id: "bottleneck_approval", title: "Aprovacoes atrasadas", description: "Entregas param esperando ok.", severity: "high", source: "user_provided" }],
      assumptions: ["Financeiro nao foi detalhado."],
      followupQuestions: [
        { id: "approval_owner", question: "Quem aprova entregas?", reason: "Define rotina e permissao.", expectedUse: "approval_evidence", priority: 1 }
      ]
    });

    expect(diagnosis.followupQuestions).toHaveLength(1);
  });

  it("rejects process drafts without executable steps", () => {
    expect(() => processDraftSchema.parse({
      title: "Fechamento",
      summary: "Resumo",
      objective: "Fechar caixa",
      trigger: "Fim do dia",
      areaName: "Financeiro",
      roleName: null,
      operationalRule: "Registrar o fechamento antes de encerrar o dia.",
      steps: [],
      assumptions: [],
      gaps: []
    })).toThrow();
  });

  it("validates routine and training drafts used by the harness", () => {
    const routine = routineDraftSchema.parse({
      title: "Abertura do dia",
      frequency: "daily",
      areaName: "Operações",
      roleName: null,
      tasks: [{
        title: "Conferir prioridades",
        dueHint: "09:00",
        evidencePolicy: "optional",
        approvalMode: "direct"
      }],
      linkedProcessTitle: null,
      assumptions: [],
      gaps: []
    });
    const training = trainingDraftSchema.parse({
      title: "Como registrar evidências",
      description: "Treinamento curto.",
      targetAreaName: "Operações",
      targetRoleName: null,
      lesson: { title: "Aula curta", body: "Registre o que foi feito e o próximo passo." },
      quiz: [{
        prompt: "O que uma evidência precisa mostrar?",
        options: [{ id: "a", label: "O que foi feito" }, { id: "b", label: "Só que terminou" }],
        correctOptionId: "a",
        explanation: "A evidência precisa ser auditável."
      }],
      assumptions: [],
      gaps: []
    });

    expect(routine.tasks[0]!.title).toBe("Conferir prioridades");
    expect(training.quiz[0]!.correctOptionId).toBe("a");
  });
});
