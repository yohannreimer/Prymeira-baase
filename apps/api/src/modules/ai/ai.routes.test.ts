import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { AiProvider, AiStructuredProviderRequest, AudioTranscriptionProviderRequest } from "./ai.types";
import { createInMemoryAiRepository } from "./in-memory-ai.repository";
import { createMockAiProvider } from "./providers/mock-ai.provider";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_owner",
  "x-baase-role": "owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_employee",
  "x-baase-role": "employee"
};

const suggestionMetadata = {
  reason: "Sugerido a partir do onboarding.",
  basedOn: ["respostas do onboarding"],
  expectedImpact: "Dar clareza para a operação.",
  source: "inferred" as const,
  reviewDefault: "draft" as const
};

const activationPlan = [
  { day: 1, title: "Revisar mapa", objective: "Confirmar áreas.", action: "open_company_map" },
  { day: 2, title: "Revisar processos", objective: "Ajustar processos.", action: "review_processes" },
  { day: 3, title: "Ativar rotina", objective: "Começar execução.", action: "activate_routine" },
  { day: 4, title: "Publicar treinamento", objective: "Alinhar equipe.", action: "publish_training" },
  { day: 5, title: "Convidar equipe", objective: "Trazer funcionários.", action: "invite_team" },
  { day: 6, title: "Revisar hoje", objective: "Ver primeiras execuções.", action: "review_today" },
  { day: 7, title: "Revisar painel", objective: "Ajustar gargalos.", action: "review_dashboard" }
] as const;

describe("AI routes", () => {
  it("generates a complete onboarding suggestion through the AI harness", async () => {
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider: createMockAiProvider({
        structuredOutput: {
          companyName: "Estúdio Norte",
          segment: "Agência de marketing",
          confidence: "high",
          assumptions: ["A empresa trabalha com clientes recorrentes."],
          gaps: [{
            title: "Responsável financeiro",
            reason: "O dono não informou quem cuida do financeiro.",
            suggestedQuestion: "Quem cuida do financeiro hoje?"
          }],
          areas: [{ id: "area_atendimento", name: "Atendimento", description: "Relacionamento com clientes.", metadata: { ...suggestionMetadata, reviewDefault: "create" } }],
          roles: [{ id: "role_gestor_atendimento", areaName: "Atendimento", name: "Gestor de atendimento", description: "Mantém cadência com clientes.", metadata: { ...suggestionMetadata, source: "template", reviewDefault: "create" } }],
          people: [{
            id: "person_marina",
            name: "Marina Alves",
            email: null,
            role: "manager",
            areaName: "Atendimento",
            roleName: "Gestor de atendimento",
            placeholder: false,
            metadata: { ...suggestionMetadata, source: "user_provided", reviewDefault: "create" }
          }],
          processes: [{
            id: "process_onboarding_cliente",
            title: "Onboarding de cliente novo",
            summary: "Entrada padronizada de cliente.",
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
            metadata: suggestionMetadata
          }],
          routines: [{
            id: "routine_abertura_dia",
            title: "Abertura do dia",
            areaName: "Atendimento",
            frequency: "daily",
            taskTitles: ["Conferir prioridades", "Atualizar pendências"],
            metadata: suggestionMetadata
          }],
          trainings: [{
            id: "training_evidencias",
            title: "Como registrar evidências",
            description: "Aula curta para padronizar execução.",
            materialBody: "Registre o que foi feito, quando e próximo passo.",
            quizPrompt: "O que uma evidência precisa mostrar?",
            metadata: suggestionMetadata
          }],
          announcement: null,
          activationPlan
        }
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/onboarding/suggestions",
      headers: ownerHeaders,
      payload: {
        segment: "Agência de marketing",
        answers: [
          {
            question: "O que sua empresa vende?",
            answer: "Somos uma agência e atendemos clientes recorrentes.",
            input_mode: "text"
          },
          {
            question: "Onde dói?",
            answer: "A equipe se perde na abertura do dia.",
            input_mode: "text"
          }
        ],
        context: {
          team_size: "4"
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().suggestion).toMatchObject({
      companyName: "Estúdio Norte",
      segment: "Agência de marketing",
      confidence: "high",
      areas: [{ id: "area_atendimento", name: "Atendimento" }],
      people: [{ id: "person_marina", placeholder: false }],
      processes: [{ title: "Onboarding de cliente novo" }]
    });
    expect(response.json().ai_run).toMatchObject({
      source: "onboarding",
      agentKey: "onboarding_architect",
      status: "completed"
    });
  });

  it("creates a process draft through the AI harness and stores the run", async () => {
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider: createMockAiProvider({
        structuredOutput: {
          title: "Responder mensagens pendentes",
          summary: "Processo para responder mensagens no início do dia.",
          objective: "Garantir que nenhum cliente fique sem retorno.",
          trigger: "Começo do expediente",
          operationalRule: "Nenhuma conversa comercial deve ficar sem próximo passo registrado.",
          areaName: "Atendimento",
          roleName: "Atendente",
          steps: [
            {
              title: "Abrir WhatsApp Business",
              instruction: "Filtre conversas não respondidas e identifique quem precisa de retorno.",
              expectedResult: "A lista de mensagens pendentes fica clara antes de responder.",
              attentionPoints: ["Não responder sem conferir histórico."]
            },
            {
              title: "Responder com próximo passo",
              instruction: "Envie uma resposta objetiva informando prazo, responsável ou pergunta necessária.",
              expectedResult: "Cada conversa sai do estado de espera.",
              attentionPoints: ["Não prometer prazo sem validar."]
            },
            {
              title: "Registrar oportunidade ou pendência",
              instruction: "Quando a conversa tiver valor comercial ou pendência operacional, registre no sistema correto.",
              expectedResult: "Nada importante fica somente no WhatsApp.",
              attentionPoints: []
            }
          ],
          assumptions: [],
          gaps: []
        }
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: ownerHeaders,
      payload: {
        type: "process",
        input_mode: "text",
        input: "Todo dia a atendente precisa responder WhatsApp ate 10h.",
        context: {
          segment: "Clínica"
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().draft).toMatchObject({
      type: "process",
      status: "ready_for_review",
      content: {
        title: "Responder mensagens pendentes"
      }
    });

    const runs = await app.inject({
      method: "GET",
      url: "/ai/runs",
      headers: ownerHeaders
    });

    expect(runs.statusCode).toBe(200);
    expect(runs.json().runs).toHaveLength(1);
    expect(runs.json().runs[0]).toMatchObject({
      source: "create_with_ai",
      status: "completed",
      agentKey: "process_architect"
    });
  });

  it("extracts draft attachments before sending material into the AI harness", async () => {
    const providerRequests: AiStructuredProviderRequest[] = [];
    const aiProvider: AiProvider = {
      async generateStructured(request) {
        providerRequests.push(request);
        return {
          title: "SOP do material enviado",
          summary: "Processo criado a partir de material anexado.",
          objective: "Transformar o material em execução replicável.",
          trigger: "Quando o fluxo do material for iniciado.",
          operationalRule: "O material anexado deve virar roteiro executável, não resumo solto.",
          areaName: null,
          roleName: null,
          steps: [
            {
              title: "Ler o material",
              instruction: "Conferir instruções do documento enviado e separar o que é ação operacional.",
              expectedResult: "As ações principais ficam identificadas.",
              attentionPoints: ["Não copiar texto sem transformar em roteiro."]
            },
            {
              title: "Organizar o fluxo",
              instruction: "Coloque as ações em ordem de execução, com começo, meio e fim.",
              expectedResult: "O processo pode ser seguido por outra pessoa.",
              attentionPoints: []
            },
            {
              title: "Definir conclusão esperada",
              instruction: "Especifique como a pessoa sabe que o processo terminou corretamente.",
              expectedResult: "O encerramento do SOP fica claro.",
              attentionPoints: []
            }
          ],
          assumptions: [],
          gaps: []
        };
      },
      async transcribeAudio() {
        return {
          text: "",
          confidence: null,
          durationSeconds: null
        };
      }
    };
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: ownerHeaders,
      payload: {
        type: "process",
        input_mode: "pdf",
        input: "Transformar este material em SOP.",
        attachments: [{
          name: "manual-operacional.txt",
          mime_type: "text/plain",
          content_base64: Buffer.from("Manual: revisar pedido, executar checklist e registrar evidência.").toString("base64")
        }]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(providerRequests[0]?.input).toMatchObject({
      text: "Transformar este material em SOP.",
      attachments: [{
        name: "manual-operacional.txt",
        mimeType: "text/plain",
        text: expect.stringContaining("registrar evidência")
      }]
    });
  });

  it("creates an announcement draft through the AI harness", async () => {
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider: createMockAiProvider({
        structuredOutput: {
          title: "Novo padrão de evidência",
          body: "A partir de hoje, toda entrega precisa registrar comentário ou foto no Baase antes de ser enviada.",
          type: "process_change",
          requirement: "read_confirmation",
          audience: { type: "all" },
          quiz: [{
            prompt: "O que precisa acontecer antes de enviar uma entrega?",
            options: [
              { id: "a", label: "Registrar evidência no Baase" },
              { id: "b", label: "Enviar sem histórico" }
            ],
            correctOptionId: "a",
            explanation: "A evidência mantém o histórico operacional confiável."
          }],
          assumptions: ["A mudança deve ir para toda a equipe."],
          gaps: []
        }
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: ownerHeaders,
      payload: {
        type: "announcement",
        input_mode: "text",
        input: "Avisar a equipe que toda entrega precisa de evidência."
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().draft).toMatchObject({
      type: "announcement",
      status: "ready_for_review",
      content: {
        title: "Novo padrão de evidência",
        requirement: "read_confirmation"
      }
    });
  });

  it("returns proactive suggestions from concrete workspace signals", async () => {
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider: createMockAiProvider()
    });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: {
        name: "Financeiro",
        description: "Cobranças e fechamento."
      }
    });
    const areaId = areaResponse.json().area.id;

    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaId,
        name: "Analista financeiro",
        description: "Cuida da rotina financeira."
      }
    });

    await app.inject({
      method: "POST",
      url: "/processes",
      headers: ownerHeaders,
      payload: {
        title: "Fechamento financeiro",
        summary: "Ainda precisa revisão.",
        body: "1. Conferir entradas."
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/ai/proactive-suggestions",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        signal: "area_without_routine",
        title: expect.stringContaining("Financeiro"),
        action: expect.objectContaining({ type: "create_routine" })
      }),
      expect.objectContaining({
        signal: "role_without_training",
        title: expect.stringContaining("Analista financeiro"),
        action: expect.objectContaining({ type: "create_training" }),
        target: expect.objectContaining({ roleTemplateId: roleResponse.json().role_template.id })
      }),
      expect.objectContaining({
        signal: "draft_process",
        title: expect.stringContaining("Fechamento financeiro"),
        action: expect.objectContaining({ type: "review_process" })
      })
    ]));
  });

  it("transcribes audio through the AI harness", async () => {
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider: createMockAiProvider({
        transcript: {
          text: "Minha empresa precisa organizar a abertura do dia.",
          confidence: 0.96,
          durationSeconds: 18
        }
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/transcriptions",
      headers: ownerHeaders,
      payload: {
        source: "onboarding",
        audio_url: "https://storage.baase.local/audio.wav",
        language: "pt-BR",
        keyterms: ["Baase", "Abertura do dia"]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().transcript).toMatchObject({
      text: "Minha empresa precisa organizar a abertura do dia.",
      confidence: 0.96,
      duration_seconds: 18
    });
  });

  it("transcribes browser audio payloads through an audio buffer", async () => {
    const providerRequests: AudioTranscriptionProviderRequest[] = [];
    const aiProvider: AiProvider = {
      async generateStructured() {
        return {};
      },
      async transcribeAudio(request) {
        providerRequests.push(request);
        return {
          text: "A equipe precisa de processos e rotinas simples.",
          confidence: 0.91,
          durationSeconds: 7
        };
      }
    };
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/transcriptions",
      headers: ownerHeaders,
      payload: {
        source: "onboarding",
        audio_base64: Buffer.from("browser-audio").toString("base64"),
        mime_type: "audio/webm",
        language: "pt-BR",
        keyterms: ["processos", "rotinas"]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().transcript.text).toBe("A equipe precisa de processos e rotinas simples.");
    expect(providerRequests[0]?.audioUrl).toBeUndefined();
    expect(providerRequests[0]?.mimeType).toBe("audio/webm");
    expect(providerRequests[0]?.audioBuffer?.toString("utf8")).toBe("browser-audio");
  });

  it("accepts longer browser audio payloads without failing at the HTTP body limit", async () => {
    const providerRequests: AudioTranscriptionProviderRequest[] = [];
    const aiProvider: AiProvider = {
      async generateStructured() {
        return {};
      },
      async transcribeAudio(request) {
        providerRequests.push(request);
        return {
          text: "Áudio longo recebido para montar a base operacional.",
          confidence: 0.9,
          durationSeconds: 58
        };
      }
    };
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider
    });
    const audioBuffer = Buffer.alloc(1_200_000, 7);

    const response = await app.inject({
      method: "POST",
      url: "/ai/transcriptions",
      headers: ownerHeaders,
      payload: {
        source: "onboarding",
        audio_base64: audioBuffer.toString("base64"),
        mime_type: "audio/webm",
        language: "pt-BR"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().transcript.text).toBe("Áudio longo recebido para montar a base operacional.");
    expect(providerRequests[0]?.audioBuffer?.byteLength).toBe(audioBuffer.byteLength);
  });

  it("blocks employees from creating AI drafts", async () => {
    const app = buildApp({
      aiRepository: createInMemoryAiRepository(),
      aiProvider: createMockAiProvider()
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: employeeHeaders,
      payload: {
        type: "process",
        input_mode: "text",
        input: "Crie um processo."
      }
    });

    expect(response.statusCode).toBe(403);
  });
});
