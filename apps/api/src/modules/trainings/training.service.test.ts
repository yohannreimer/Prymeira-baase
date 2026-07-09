import { describe, expect, it } from "vitest";
import { createInMemoryTrainingRepository } from "./in-memory-training.repository";
import { createTrainingService } from "./training.service";

describe("training service", () => {
  it("creates draft trainings with materials and quiz questions", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());

    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Atendimento inicial",
      description: "Como responder o primeiro contato.",
      materials: [
        {
          kind: "lesson",
          title: "Aula curta",
          body: "Cumprimente, qualifique e encaminhe."
        },
        {
          kind: "pdf",
          title: "Script PDF",
          url: "https://cdn.example.com/script.pdf"
        }
      ],
      quizQuestions: [
        {
          prompt: "Qual é o primeiro passo?",
          options: [
            { id: "a", label: "Cumprimentar" },
            { id: "b", label: "Encerrar conversa" }
          ],
          correctOptionId: "a",
          explanation: "O primeiro contato começa com acolhimento."
        }
      ]
    });

    expect(training).toMatchObject({
      workspaceId: "workspace_a",
      title: "Atendimento inicial",
      status: "draft",
      createdByProfileId: "profile_manager",
      materials: [
        {
          kind: "lesson",
          sortOrder: 1
        },
        {
          kind: "pdf",
          sortOrder: 2
        }
      ],
      quizQuestions: [
        {
          prompt: "Qual é o primeiro passo?",
          correctOptionId: "a",
          sortOrder: 1
        }
      ]
    });
  });

  it("stores draft status as metadata instead of leaking AI draft prefixes into the title", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());

    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Rascunho de treinamento: Como avaliar se a empresa está pronta para contratar vendedores",
      description: "Aula criada com IA.",
      materials: [{ kind: "lesson", title: "Aula curta", body: "Ensinar a decidir quando contratar." }],
      quizQuestions: []
    });

    expect(training).toMatchObject({
      title: "Como avaliar se a empresa está pronta para contratar vendedores",
      status: "draft"
    });
  });

  it("normalizes legacy AI draft prefixes when listing existing trainings", async () => {
    const repository = createInMemoryTrainingRepository();
    const service = createTrainingService(repository);
    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Como avaliar contratação comercial",
      materials: [{ kind: "lesson", title: "Aula curta", body: "Conteúdo legado." }],
      quizQuestions: []
    });
    await repository.updateTraining({
      ...training,
      title: "Rascunho de treinamento: Como avaliar contratação comercial"
    });

    await expect(service.listTrainings("workspace_a")).resolves.toEqual([
      expect.objectContaining({ title: "Como avaliar contratação comercial" })
    ]);
  });

  it("stores process source and target audience metadata on trainings", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());

    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Treinar SOP de entrega",
      description: "Equipe técnica deve entender o fluxo publicado.",
      source: {
        type: "process",
        processId: "process_entregas",
        title: "Executar e documentar entregáveis técnicos"
      },
      audience: { type: "role", roleTemplateId: "role_tecnico" },
      dueDate: "2026-07-20",
      materials: [
        {
          kind: "lesson",
          title: "Resumo do SOP",
          body: "Leia o processo, revise os passos críticos e responda o quiz."
        }
      ],
      quizQuestions: [
        {
          prompt: "O que deve acontecer antes de enviar o entregável?",
          options: [
            { id: "a", label: "Validar no Orquestrador" },
            { id: "b", label: "Enviar sem registrar" }
          ],
          correctOptionId: "a"
        }
      ]
    });

    expect(training).toMatchObject({
      source: {
        type: "process",
        processId: "process_entregas",
        title: "Executar e documentar entregáveis técnicos"
      },
      audience: { type: "role", roleTemplateId: "role_tecnico" },
      dueDate: "2026-07-20"
    });
  });

  it("publishes trainings after review", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());
    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Fechamento de caixa",
      materials: [{ kind: "lesson", title: "Resumo", body: "Conferir caixa." }],
      quizQuestions: []
    });

    const published = await service.publishTraining("workspace_a", training.id);

    expect(published.status).toBe("published");
    expect(published.publishedAt).toEqual(expect.any(String));
  });

  it("scores quiz attempts and marks pass when score reaches threshold", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());
    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Atendimento",
      materials: [{ kind: "lesson", title: "Resumo", body: "Responder bem." }],
      quizQuestions: [
        {
          prompt: "O que fazer primeiro?",
          options: [
            { id: "a", label: "Cumprimentar" },
            { id: "b", label: "Ignorar" }
          ],
          correctOptionId: "a"
        },
        {
          prompt: "Quando encaminhar?",
          options: [
            { id: "a", label: "Sem entender" },
            { id: "b", label: "Após qualificar" }
          ],
          correctOptionId: "b"
        }
      ]
    });

    const attempt = await service.submitQuizAttempt("workspace_a", training.id, "profile_employee", {
      answers: [
        { questionId: training.quizQuestions[0]?.id ?? "", optionId: "a" },
        { questionId: training.quizQuestions[1]?.id ?? "", optionId: "b" }
      ]
    });

    expect(attempt).toMatchObject({
      profileId: "profile_employee",
      score: 100,
      passed: true
    });
  });

  it("tracks assigned training progress for an employee after a passing quiz", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());
    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Padrão de atendimento",
      materials: [{ kind: "lesson", title: "Aula curta", body: "Responda em até 15 minutos." }],
      quizQuestions: [
        {
          prompt: "Qual é o prazo de resposta?",
          options: [
            { id: "a", label: "Até 15 minutos" },
            { id: "b", label: "Até 2 dias" }
          ],
          correctOptionId: "a"
        }
      ]
    });
    await service.publishTraining("workspace_a", training.id);

    const assignment = await service.assignTraining("workspace_a", "profile_manager", training.id, {
      audience: { type: "all" },
      dueDate: "2026-07-10"
    });
    const pending = await service.listTrainingProgress("workspace_a", {
      profileId: "profile_employee",
      date: "2026-07-07"
    });

    expect(assignment).toMatchObject({
      trainingId: training.id,
      audience: { type: "all" },
      dueDate: "2026-07-10",
      createdByProfileId: "profile_manager"
    });
    expect(pending).toEqual([
      expect.objectContaining({
        trainingId: training.id,
        assignmentId: assignment.id,
        profileId: "profile_employee",
        status: "pending",
        training: expect.objectContaining({ title: "Padrão de atendimento" })
      })
    ]);

    await service.submitQuizAttempt("workspace_a", training.id, "profile_employee", {
      answers: [{ questionId: training.quizQuestions[0]?.id ?? "", optionId: "a" }]
    });
    const completed = await service.listTrainingProgress("workspace_a", {
      profileId: "profile_employee",
      date: "2026-07-07"
    });

    expect(completed[0]).toMatchObject({
      status: "completed",
      score: 100,
      passed: true
    });
  });

  it("deletes trainings with assignments and quiz attempts", async () => {
    const service = createTrainingService(createInMemoryTrainingRepository());
    const training = await service.createTraining("workspace_a", "profile_manager", {
      title: "Treinamento removível",
      materials: [{ kind: "lesson", title: "Resumo", body: "Conteúdo que será removido." }],
      quizQuestions: [
        {
          prompt: "Qual é a resposta?",
          options: [
            { id: "a", label: "Certa" },
            { id: "b", label: "Errada" }
          ],
          correctOptionId: "a"
        }
      ]
    });

    await service.publishTraining("workspace_a", training.id);
    await service.assignTraining("workspace_a", "profile_manager", training.id, {
      audience: { type: "all" },
      dueDate: "2026-07-20"
    });
    await service.submitQuizAttempt("workspace_a", training.id, "profile_employee", {
      answers: [{ questionId: training.quizQuestions[0]?.id ?? "", optionId: "a" }]
    });

    await service.deleteTraining("workspace_a", training.id);

    await expect(service.publishTraining("workspace_a", training.id)).rejects.toThrow("TRAINING_NOT_FOUND");
    await expect(service.listTrainingProgress("workspace_a", {
      profileId: "profile_employee",
      date: "2026-07-21"
    })).resolves.toEqual([]);
  });
});
