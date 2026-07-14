export type TrainingStatus = "draft" | "published" | "archived";

export type TrainingMaterialKind = "lesson" | "pdf" | "link";

export type TrainingSourceType = "manual" | "process" | "material";

export type TrainingSource = {
  type: TrainingSourceType;
  processId: string | null;
  title: string | null;
};

export type TrainingMaterial = {
  id: string;
  trainingId: string;
  workspaceId: string;
  kind: TrainingMaterialKind;
  title: string;
  body: string | null;
  url: string | null;
  sortOrder: number;
};

export type QuizOption = {
  id: string;
  label: string;
};

export type QuizQuestion = {
  id: string;
  trainingId: string;
  workspaceId: string;
  prompt: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string | null;
  sortOrder: number;
};

export type Training = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: TrainingStatus;
  source: TrainingSource;
  audience: TrainingAudience | null;
  dueDate: string | null;
  materials: TrainingMaterial[];
  quizQuestions: QuizQuestion[];
  createdByProfileId: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuizAttempt = {
  id: string;
  workspaceId: string;
  trainingId: string;
  profileId: string;
  score: number;
  passed: boolean;
  answers: QuizAnswerInput[];
  completedAt: string;
  createdAt: string;
};

export type TrainingAudience =
  | { type: "all" }
  | { type: "area"; areaId: string }
  | { type: "role"; roleTemplateId: string }
  | { type: "person"; profileId: string };

export type TrainingAssignment = {
  id: string;
  workspaceId: string;
  trainingId: string;
  audience: TrainingAudience;
  dueDate: string | null;
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainingProgressStatus = "pending" | "completed" | "overdue";

export type TrainingProgress = {
  assignmentId: string;
  trainingId: string;
  profileId: string;
  dueDate: string | null;
  status: TrainingProgressStatus;
  completedAt: string | null;
  score: number | null;
  passed: boolean | null;
  training: Training;
};

export type CreateTrainingMaterialInput = {
  kind: TrainingMaterialKind;
  title: string;
  body?: string | null;
  url?: string | null;
};

export type CreateQuizQuestionInput = {
  prompt: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation?: string | null;
};

export type CreateTrainingInput = {
  title: string;
  description?: string | null;
  source?: TrainingSource | null;
  audience?: TrainingAudience | null;
  dueDate?: string | null;
  materials: CreateTrainingMaterialInput[];
  quizQuestions: CreateQuizQuestionInput[];
};

export type UpdateTrainingInput = CreateTrainingInput;

export type QuizAnswerInput = {
  questionId: string;
  optionId: string;
};

export type SubmitQuizAttemptInput = {
  answers: QuizAnswerInput[];
};

export type AssignTrainingInput = {
  audience: TrainingAudience;
  dueDate?: string | null;
};

export type TrainingRepository = {
  listTrainings(workspaceId: string, filters?: { limit?: number }): Promise<Training[]>;
  findTraining(workspaceId: string, trainingId: string): Promise<Training | null>;
  createTraining(input: Omit<Training, "id" | "createdAt" | "updatedAt">): Promise<Training>;
  updateTraining(training: Training): Promise<Training>;
  deleteTraining(workspaceId: string, trainingId: string): Promise<void>;
  listTrainingAssignments(workspaceId: string): Promise<TrainingAssignment[]>;
  createTrainingAssignment(input: Omit<TrainingAssignment, "id" | "createdAt" | "updatedAt">): Promise<TrainingAssignment>;
  listQuizAttempts(workspaceId: string, filters?: { trainingId?: string; profileId?: string }): Promise<QuizAttempt[]>;
  createQuizAttempt(input: Omit<QuizAttempt, "id" | "createdAt">): Promise<QuizAttempt>;
};
