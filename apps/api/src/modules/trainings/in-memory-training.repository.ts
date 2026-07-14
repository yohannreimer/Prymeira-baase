import type { QuizAttempt, Training, TrainingAssignment, TrainingRepository } from "./training.types";

type InMemoryTrainingRepositoryOptions = {
  now?: () => string;
  initialTrainings?: Training[];
};

export function createInMemoryTrainingRepository(
  options: InMemoryTrainingRepositoryOptions = {}
): TrainingRepository {
  const trainings: Training[] = [...(options.initialTrainings ?? [])];
  const assignments: TrainingAssignment[] = [];
  const attempts: QuizAttempt[] = [];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listTrainings(workspaceId, filters = {}) {
      return trainings.filter((training) => training.workspaceId === workspaceId).slice(0, filters.limit);
    },

    async findTraining(workspaceId, trainingId) {
      return trainings.find((training) => training.workspaceId === workspaceId && training.id === trainingId) ?? null;
    },

    async createTraining(input) {
      const timestamp = now();
      const trainingId = `training_${trainings.length + 1}`;
      const training: Training = {
        ...input,
        id: trainingId,
        materials: input.materials.map((material) => ({
          ...material,
          id: material.id.replace("__training__", trainingId),
          trainingId
        })),
        quizQuestions: input.quizQuestions.map((question) => ({
          ...question,
          id: question.id.replace("__training__", trainingId),
          trainingId
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      trainings.push(training);
      return training;
    },

    async updateTraining(training) {
      const index = trainings.findIndex((item) => item.workspaceId === training.workspaceId && item.id === training.id);
      if (index === -1) throw new Error("TRAINING_NOT_FOUND");
      const updated = {
        ...training,
        updatedAt: now()
      };
      trainings[index] = updated;
      return updated;
    },

    async deleteTraining(workspaceId, trainingId) {
      const index = trainings.findIndex((item) => item.workspaceId === workspaceId && item.id === trainingId);
      if (index >= 0) trainings.splice(index, 1);
      for (let assignmentIndex = assignments.length - 1; assignmentIndex >= 0; assignmentIndex -= 1) {
        const assignment = assignments[assignmentIndex];
        if (assignment?.workspaceId === workspaceId && assignment.trainingId === trainingId) {
          assignments.splice(assignmentIndex, 1);
        }
      }
      for (let attemptIndex = attempts.length - 1; attemptIndex >= 0; attemptIndex -= 1) {
        const attempt = attempts[attemptIndex];
        if (attempt?.workspaceId === workspaceId && attempt.trainingId === trainingId) attempts.splice(attemptIndex, 1);
      }
    },

    async listTrainingAssignments(workspaceId) {
      return assignments.filter((assignment) => assignment.workspaceId === workspaceId);
    },

    async createTrainingAssignment(input) {
      const timestamp = now();
      const assignment: TrainingAssignment = {
        ...input,
        id: `training_assignment_${assignments.length + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assignments.push(assignment);
      return assignment;
    },

    async listQuizAttempts(workspaceId, filters = {}) {
      return attempts.filter((attempt) => {
        if (attempt.workspaceId !== workspaceId) return false;
        if (filters.trainingId && attempt.trainingId !== filters.trainingId) return false;
        if (filters.profileId && attempt.profileId !== filters.profileId) return false;
        return true;
      });
    },

    async createQuizAttempt(input) {
      const timestamp = now();
      const attempt: QuizAttempt = {
        ...input,
        id: `attempt_${attempts.length + 1}`,
        createdAt: timestamp
      };
      attempts.push(attempt);
      return attempt;
    }
  };
}
