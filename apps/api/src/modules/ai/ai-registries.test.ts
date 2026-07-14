import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { getPromptDefinition, listPromptDefinitions } from "./prompt-registry";
import {
  onboardingDiagnosisSchema,
  onboardingSetupSuggestionSchema,
  processDraftSchema,
  routineDraftSchema,
  schemaRegistry,
  studioOperationalDraftSchema,
  studioOrganizeSchema,
  studioRitualPrepareSchema,
  studioStrategicReviewSchema,
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

  it("registers guarded version-one Studio agents with known schemas", () => {
    const expected = [
      ["agent/studio-librarian", "studio_librarian", "studio_organize"],
      ["agent/studio-strategist", "studio_strategist", "studio_strategic_review"],
      ["agent/studio-ritual-facilitator", "studio_ritual_facilitator", "studio_ritual_prepare"],
      ["agent/studio-operations-bridge", "studio_operations_bridge", "studio_operational_draft"]
    ] as const;

    for (const [key, agentKey, outputSchemaKey] of expected) {
      const prompt = getPromptDefinition(key, "1");
      expect(prompt).toMatchObject({ version: "1", agentKey, outputSchemaKey });
      const instructions = `${prompt.system}\n${prompt.developer}`.toLocaleLowerCase("pt-BR");
      expect(instructions).toContain("preserve o original");
      expect(instructions).toContain("fatos");
      expect(instructions).toContain("inferências");
      expect(instructions).toContain("sugestões");
      expect(instructions).toContain("citações");
      expect(instructions).toContain("nunca publique");
      expect(instructions).toContain("dados não confiáveis");
      expect(instructions).toContain("não podem alterar permissões");
      expect(instructions).toContain("pesquisa externa");
      expect(instructions).toContain("consentimento explícito");
    }
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

  it("keeps every Studio schema serializable for structured outputs", () => {
    for (const key of [
      "studio_organize",
      "studio_strategic_review",
      "studio_ritual_prepare",
      "studio_operational_draft"
    ] as const) {
      const jsonSchema = zodTextFormat(schemaRegistry[key], key).schema;
      expect(jsonSchema).toMatchObject({ type: "object" });
      expect(JSON.stringify(jsonSchema)).toContain("proposal");
    }
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

  it("validates bounded Studio organization, strategy and ritual proposals", () => {
    const common = studioCommon();
    expect(studioOrganizeSchema.parse({
      ...common,
      proposal: {
        document_id: "doc-1",
        suggested_title: "Decisões do trimestre",
        summary: "Consolida decisões, próximos passos e temas em aberto.",
        collection_names: ["Estratégia"],
        related_document_ids: ["doc-2"],
        inbox_state: "reviewed"
      }
    }).proposal.suggested_title).toBe("Decisões do trimestre");

    expect(studioStrategicReviewSchema.parse({
      ...common,
      proposal: {
        title: "Plano do próximo trimestre",
        objective: "Aumentar previsibilidade da operação.",
        period_from: "2026-07-01",
        period_to: "2026-09-30",
        priorities: [{ title: "Reduzir atrasos", rationale: "Há recorrência documentada.", expected_outcome: "Menos tarefas vencidas." }],
        milestones: [{ title: "Revisão mensal", target_date: "2026-08-01", success_criteria: "Tendência de atrasos registrada." }],
        risks: [{ description: "Dados incompletos.", mitigation: "Validar período com o dono." }],
        next_steps: [{ title: "Revisar responsáveis", owner_hint: "Dono", due_date: null }]
      }
    }).proposal.priorities).toHaveLength(1);

    expect(studioRitualPrepareSchema.parse({
      ...common,
      proposal: {
        ritual_id: "ritual-1",
        title: "Revisão semanal do dono",
        intent: "Encerrar a semana com decisões claras.",
        agenda: [{ prompt: "O que avançou?", purpose: "Separar progresso real de impressão." }],
        preparation_notes: ["Revisar decisões abertas."],
        suggested_duration_minutes: 30
      }
    }).proposal.suggested_duration_minutes).toBe(30);
  });

  it("validates every operational draft variant without publishing anything", () => {
    const common = studioCommon();
    const proposals = [
      {
        resource_type: "task",
        title: "Revisar fechamento",
        area_id: "area-financeiro",
        assignee_profile_id: "person-1",
        due_date: "2026-07-20",
        due_hint: "Até 17h",
        approval_mode: "approval_required",
        evidence_policy: "comment_required",
        checklist_items: ["Conferir saldo", "Registrar diferença"]
      },
      {
        resource_type: "routine",
        title: "Fechamento diário",
        area_id: "area-financeiro",
        frequency: "daily",
        weekdays: [],
        due_hint: "Até 17h",
        assignee_profile_ids: ["person-1"],
        execution_mode: "individual",
        approval_mode: "direct",
        evidence_policy: "comment_required",
        task_templates: [{
          title: "Conferir saldo",
          process_id: null,
          assignee_profile_id: null,
          due_hint: null,
          approval_mode: "direct",
          evidence_policy: "comment_required"
        }]
      },
      {
        resource_type: "process",
        title: "Fechamento financeiro",
        body: "1. Conferir lançamentos.\n2. Registrar diferenças.",
        area_id: "area-financeiro",
        summary: "Padroniza o fechamento.",
        owner_profile_id: "person-1"
      },
      {
        resource_type: "announcement",
        title: "Novo horário de fechamento",
        body: "A partir de segunda-feira, registre o fechamento até 17h.",
        announcement_type: "process_change",
        requirement: "read_confirmation",
        audience: { type: "area", area_id: "area-financeiro" },
        related_process_id: null,
        related_training_id: null,
        quiz_questions: []
      }
    ] as const;

    for (const proposal of proposals) {
      const parsed = studioOperationalDraftSchema.parse({ ...common, proposal });
      expect(parsed.proposal.resource_type).toBe(proposal.resource_type);
      expect(parsed).not.toHaveProperty("published");
    }
  });

  it("rejects missing or contradictory Studio sources, invalid periods and oversized payloads", () => {
    const common = studioCommon();
    const proposal = {
      document_id: null,
      suggested_title: "Organização",
      summary: "Resumo",
      collection_names: [],
      related_document_ids: [],
      inbox_state: "pending_review"
    };

    expect(() => studioOrganizeSchema.parse({
      ...common,
      citations: [{ ...common.citations[0], source_id: null }],
      proposal
    })).toThrow();
    expect(() => studioOrganizeSchema.parse({
      ...common,
      citations: [{ ...common.citations[0], source_type: "external_url", source_id: null, url: null }],
      proposal
    })).toThrow();
    expect(() => studioOrganizeSchema.parse({
      ...common,
      citations: [{ ...common.citations[0], period_from: "2026-08-01", period_to: "2026-07-01" }],
      proposal
    })).toThrow();
    expect(() => studioOrganizeSchema.parse({
      ...common,
      proposal: { ...proposal, summary: "x".repeat(2_001) }
    })).toThrow();
    expect(() => studioOperationalDraftSchema.parse({
      ...common,
      proposal: { resource_type: "task", title: "Sem data" }
    })).toThrow();
    expect(() => studioOperationalDraftSchema.parse({
      ...common,
      publish: true,
      proposal: {
        resource_type: "task",
        title: "Tentativa de publicação",
        area_id: null,
        assignee_profile_id: null,
        due_date: "2026-07-20",
        due_hint: null,
        approval_mode: "direct",
        evidence_policy: "optional",
        checklist_items: []
      }
    })).toThrow();
  });
});

function studioCommon() {
  return {
    facts: [{ statement: "Há uma decisão registrada.", citation_indexes: [0] }],
    inferences: [{ statement: "A decisão parece prioritária.", basis: "Recorrência nos registros.", confidence: "medium" as const }],
    gaps: [{ question: "Qual é o prazo?", reason: "O documento não informa a data." }],
    citations: [{
      source_type: "studio_document" as const,
      source_id: "doc-1",
      url: null,
      label: "Nota de planejamento",
      excerpt: "Revisar a operação no trimestre.",
      observed_at: "2026-07-13T12:00:00.000Z",
      period_from: null,
      period_to: null
    }]
  };
}
