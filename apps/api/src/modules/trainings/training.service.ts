import type {
  AssignTrainingInput,
  CreateQuizQuestionInput,
  CreateTrainingInput,
  CreateTrainingMaterialInput,
  QuizQuestion,
  SubmitQuizAttemptInput,
  Training,
  TrainingAudience,
  TrainingProgress,
  TrainingMaterial,
  TrainingRepository,
  TrainingSource,
  UpdateTrainingInput
} from "./training.types";

const passingScore = 70;

function requiredText(value: string, errorCode: string) {
  const text = value.trim();
  if (!text) throw new Error(errorCode);
  return text;
}

function optionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function normalizeTrainingTitle(value: string) {
  const title = requiredText(value, "TRAINING_TITLE_REQUIRED");
  const cleaned = title
    .replace(/^Rascunho\s+de\s+treinamento\s*[-—:]\s*/i, "")
    .replace(/^Rascunho\s*[-—:]\s*/i, "")
    .trim();

  return cleaned || title;
}

function normalizeTrainingOutput(training: Training): Training {
  const title = normalizeTrainingTitle(training.title);
  return title === training.title ? training : { ...training, title };
}

function normalizeSource(source: TrainingSource | null | undefined): TrainingSource {
  if (!source) return { type: "manual", processId: null, title: null };
  if (source.type === "process") {
    return {
      type: "process",
      processId: requiredText(source.processId ?? "", "TRAINING_SOURCE_PROCESS_REQUIRED"),
      title: optionalText(source.title)
    };
  }
  if (source.type === "material") {
    return {
      type: "material",
      processId: null,
      title: optionalText(source.title)
    };
  }
  return {
    type: "manual",
    processId: null,
    title: optionalText(source.title)
  };
}

function buildMaterial(workspaceId: string, index: number, input: CreateTrainingMaterialInput): TrainingMaterial {
  const sortOrder = index + 1;
  return {
    id: `material___training___${sortOrder}`,
    trainingId: "__training__",
    workspaceId,
    kind: input.kind,
    title: requiredText(input.title, "TRAINING_MATERIAL_TITLE_REQUIRED"),
    body: optionalText(input.body),
    url: optionalText(input.url),
    sortOrder
  };
}

function buildQuestion(workspaceId: string, index: number, input: CreateQuizQuestionInput): QuizQuestion {
  const sortOrder = index + 1;
  if (input.options.length < 2) throw new Error("QUIZ_OPTIONS_REQUIRED");
  if (!input.options.some((option) => option.id === input.correctOptionId)) throw new Error("QUIZ_CORRECT_OPTION_INVALID");

  return {
    id: `question___training___${sortOrder}`,
    trainingId: "__training__",
    workspaceId,
    prompt: requiredText(input.prompt, "QUIZ_PROMPT_REQUIRED"),
    options: input.options.map((option) => ({
      id: requiredText(option.id, "QUIZ_OPTION_ID_REQUIRED"),
      label: requiredText(option.label, "QUIZ_OPTION_LABEL_REQUIRED")
    })),
    correctOptionId: input.correctOptionId,
    explanation: optionalText(input.explanation),
    sortOrder
  };
}

function attachTrainingId<T extends { id: string; trainingId: string }>(trainingId: string, item: T): T {
  return {
    ...item,
    id: item.id.replace("__training__", trainingId),
    trainingId
  };
}

function buildTrainingParts(workspaceId: string, trainingId: string, input: UpdateTrainingInput) {
  if (input.materials.length === 0) throw new Error("TRAINING_MATERIALS_REQUIRED");
  return {
    materials: input.materials.map((material, index) => attachTrainingId(trainingId, buildMaterial(workspaceId, index, material))),
    quizQuestions: input.quizQuestions.map((question, index) => attachTrainingId(trainingId, buildQuestion(workspaceId, index, question)))
  };
}

export function createTrainingService(repository: TrainingRepository) {
  return {
    async listTrainings(workspaceId: string) {
      const trainings = await repository.listTrainings(workspaceId);
      return trainings.map(normalizeTrainingOutput);
    },

    async createTraining(workspaceId: string, actorProfileId: string, input: CreateTrainingInput): Promise<Training> {
      const title = normalizeTrainingTitle(input.title);
      if (input.materials.length === 0) throw new Error("TRAINING_MATERIALS_REQUIRED");

      return repository.createTraining({
        workspaceId,
        title,
        description: optionalText(input.description),
        status: "draft",
        source: normalizeSource(input.source),
        audience: input.audience ? normalizeAudience(input.audience) : null,
        dueDate: optionalText(input.dueDate),
        materials: input.materials.map((material, index) => buildMaterial(workspaceId, index, material)),
        quizQuestions: input.quizQuestions.map((question, index) => buildQuestion(workspaceId, index, question)),
        createdByProfileId: actorProfileId,
        publishedAt: null,
        archivedAt: null
      });
    },

    async publishTraining(workspaceId: string, trainingId: string) {
      const training = await readTrainingOrThrow(repository, workspaceId, trainingId);
      return repository.updateTraining({
        ...training,
        status: "published",
        publishedAt: new Date().toISOString()
      });
    },

    async updateTraining(workspaceId: string, trainingId: string, input: UpdateTrainingInput) {
      const training = await readTrainingOrThrow(repository, workspaceId, trainingId);
      const title = normalizeTrainingTitle(input.title);
      const parts = buildTrainingParts(workspaceId, training.id, input);

      return repository.updateTraining({
        ...training,
        title,
        description: optionalText(input.description),
        source: normalizeSource(input.source),
        audience: input.audience ? normalizeAudience(input.audience) : null,
        dueDate: optionalText(input.dueDate),
        materials: parts.materials,
        quizQuestions: parts.quizQuestions
      });
    },

    async deleteTraining(workspaceId: string, trainingId: string) {
      await readTrainingOrThrow(repository, workspaceId, trainingId);
      await repository.deleteTraining(workspaceId, trainingId);
    },

    async unpublishTraining(workspaceId: string, trainingId: string) {
      const training = await readTrainingOrThrow(repository, workspaceId, trainingId);
      return repository.updateTraining({
        ...training,
        status: "draft",
        publishedAt: null
      });
    },

    async assignTraining(workspaceId: string, actorProfileId: string, trainingId: string, input: AssignTrainingInput) {
      const training = await readTrainingOrThrow(repository, workspaceId, trainingId);
      if (training.status !== "published") throw new Error("TRAINING_NOT_PUBLISHED");

      return repository.createTrainingAssignment({
        workspaceId,
        trainingId,
        audience: normalizeAudience(input.audience),
        dueDate: optionalText(input.dueDate),
        createdByProfileId: actorProfileId
      });
    },

    async listTrainingProgress(
      workspaceId: string,
      filters: { profileId: string; date: string; areaId?: string | null; roleTemplateId?: string | null }
    ): Promise<TrainingProgress[]> {
      const [assignments, attempts] = await Promise.all([
        repository.listTrainingAssignments(workspaceId),
        repository.listQuizAttempts(workspaceId, { profileId: filters.profileId })
      ]);
      const progress: TrainingProgress[] = [];

      for (const assignment of assignments) {
        if (!audienceMatchesProfile(assignment.audience, filters)) continue;

        const training = await repository.findTraining(workspaceId, assignment.trainingId);
        if (!training || training.status !== "published") continue;

        const latestPassingAttempt = attempts
          .filter((attempt) => attempt.trainingId === assignment.trainingId && attempt.passed)
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0] ?? null;
        const status = latestPassingAttempt
          ? "completed"
          : assignment.dueDate && assignment.dueDate < filters.date
            ? "overdue"
            : "pending";

        progress.push({
          assignmentId: assignment.id,
          trainingId: assignment.trainingId,
          profileId: filters.profileId,
          dueDate: assignment.dueDate,
          status,
          completedAt: latestPassingAttempt?.completedAt ?? null,
          score: latestPassingAttempt?.score ?? null,
          passed: latestPassingAttempt?.passed ?? null,
          training: normalizeTrainingOutput(training)
        });
      }

      return progress;
    },

    async submitQuizAttempt(workspaceId: string, trainingId: string, profileId: string, input: SubmitQuizAttemptInput) {
      const training = await readTrainingOrThrow(repository, workspaceId, trainingId);
      if (training.quizQuestions.length === 0) throw new Error("TRAINING_HAS_NO_QUIZ");

      const answerByQuestionId = new Map(input.answers.map((answer) => [answer.questionId, answer.optionId]));
      const correctAnswers = training.quizQuestions.filter((question) => {
        return answerByQuestionId.get(question.id) === question.correctOptionId;
      }).length;
      const score = Math.round((correctAnswers / training.quizQuestions.length) * 100);

      return repository.createQuizAttempt({
        workspaceId,
        trainingId,
        profileId,
        score,
        passed: score >= passingScore,
        answers: input.answers,
        completedAt: new Date().toISOString()
      });
    }
  };
}

async function readTrainingOrThrow(repository: TrainingRepository, workspaceId: string, trainingId: string) {
  const training = await repository.findTraining(workspaceId, trainingId);
  if (!training) throw new Error("TRAINING_NOT_FOUND");
  return normalizeTrainingOutput(training);
}

function normalizeAudience(audience: TrainingAudience): TrainingAudience {
  if (audience.type === "all") return audience;
  if (audience.type === "area") return { type: "area", areaId: requiredText(audience.areaId, "TRAINING_AUDIENCE_AREA_REQUIRED") };
  if (audience.type === "role") return { type: "role", roleTemplateId: requiredText(audience.roleTemplateId, "TRAINING_AUDIENCE_ROLE_REQUIRED") };
  return { type: "person", profileId: requiredText(audience.profileId, "TRAINING_AUDIENCE_PERSON_REQUIRED") };
}

function audienceMatchesProfile(
  audience: TrainingAudience,
  profile: { profileId: string; areaId?: string | null; roleTemplateId?: string | null }
) {
  if (audience.type === "all") return true;
  if (audience.type === "person") return audience.profileId === profile.profileId;
  if (audience.type === "area") return Boolean(profile.areaId && audience.areaId === profile.areaId);
  return Boolean(profile.roleTemplateId && audience.roleTemplateId === profile.roleTemplateId);
}
