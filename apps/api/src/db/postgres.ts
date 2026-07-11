import { Pool } from "pg";
import type { BuildAppOptions } from "../app";
import type { AiRepository, AiRun } from "../modules/ai/ai.types";
import type { Announcement, AnnouncementReceipt, AnnouncementRepository } from "../modules/announcements/announcement.types";
import type { Area, CompanyRepository, RoleTemplate, TeamInvite, TeamMember } from "../modules/company/company.types";
import type { OnboardingRepository, OnboardingSession } from "../modules/onboarding/onboarding.types";
import type { CompanyProcess, ProcessRepository } from "../modules/processes/process.types";
import type { CompanyRoutine, RoutineRepository, TaskOccurrence } from "../modules/routines/routine.types";
import { normalizeRoutineRecurrence } from "../modules/routines/routine-recurrence";
import type { QuizAttempt, Training, TrainingAssignment, TrainingRepository } from "../modules/trainings/training.types";
import { createPostgresCompanyRepository as createRelationalCompanyRepository } from "../modules/company/postgres-company.repository";
import { createPostgresProcessRepository as createRelationalProcessRepository } from "../modules/processes/postgres-process.repository";
import { createPostgresRoutineRepository as createRelationalRoutineRepository } from "../modules/routines/postgres-routine.repository";
import type { OperationalPool } from "./operational-repository-support";
import type { BaaseOperationalStore } from "../config/runtime";

type Queryable = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type RecordRow<T> = {
  data: T;
};

const tableName = "baase_records";

export async function ensurePostgresSchema(db: Queryable) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      kind TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (kind, workspace_id, id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS baase_records_workspace_kind_idx ON ${tableName} (workspace_id, kind)`);
}

export function createPostgresPool(connectionString: string) {
  return new Pool({ connectionString });
}

export async function deleteWorkspaceRecords(db: Queryable, workspaceId: string) {
  await db.query(`DELETE FROM ${tableName} WHERE workspace_id = $1`, [workspaceId]);
}

function now() {
  return new Date().toISOString();
}

function nextTimestamp(previousTimestamp: string) {
  const timestamp = now();
  if (new Date(timestamp).getTime() > new Date(previousTimestamp).getTime()) return timestamp;

  return new Date(new Date(previousTimestamp).getTime() + 1).toISOString();
}

class JsonbRecordStore {
  constructor(private readonly db: Queryable) {}

  async count(kind: string, workspaceId?: string) {
    const result = workspaceId
      ? await this.db.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE kind = $1 AND workspace_id = $2`, [kind, workspaceId])
      : await this.db.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE kind = $1`, [kind]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async nextId(kind: string, workspaceId: string, prefix: string) {
    const records = await this.list<{ id: string }>(kind, workspaceId);
    const nextNumber = records.reduce((max, record) => {
      if (!record.id.startsWith(`${prefix}_`)) return max;
      return Math.max(max, readNumericIdSuffix(record.id));
    }, 0) + 1;
    return `${prefix}_${nextNumber}`;
  }

  async list<T>(kind: string, workspaceId: string) {
    const result = await this.db.query<RecordRow<T>>(
      `SELECT data FROM ${tableName} WHERE kind = $1 AND workspace_id = $2 ORDER BY created_at ASC, id ASC`,
      [kind, workspaceId]
    );
    return result.rows.map((row) => row.data);
  }

  async find<T>(kind: string, workspaceId: string, id: string) {
    const result = await this.db.query<RecordRow<T>>(
      `SELECT data FROM ${tableName} WHERE kind = $1 AND workspace_id = $2 AND id = $3 LIMIT 1`,
      [kind, workspaceId, id]
    );
    return result.rows[0]?.data ?? null;
  }

  async findByTextField<T>(kind: string, field: string, value: string) {
    const result = await this.db.query<RecordRow<T>>(
      `SELECT data FROM ${tableName} WHERE kind = $1 AND data ->> $2 = $3 LIMIT 1`,
      [kind, field, value]
    );
    return result.rows[0]?.data ?? null;
  }

  async insert<T extends { workspaceId: string; id: string; createdAt: string; updatedAt?: string }>(kind: string, record: T) {
    await this.db.query(
      `INSERT INTO ${tableName} (kind, workspace_id, id, data, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [kind, record.workspaceId, record.id, JSON.stringify(record), record.createdAt, record.updatedAt ?? record.createdAt]
    );
    return record;
  }

  async update<T extends { workspaceId: string; id: string; updatedAt: string }>(kind: string, record: T) {
    const result = await this.db.query<{ id: string }>(
      `UPDATE ${tableName} SET data = $4::jsonb, updated_at = $5 WHERE kind = $1 AND workspace_id = $2 AND id = $3 RETURNING id`,
      [kind, record.workspaceId, record.id, JSON.stringify(record), record.updatedAt]
    );
    if (!result.rows[0]) throw new Error(`${kind.toUpperCase()}_NOT_FOUND`);
    return record;
  }

  async delete(kind: string, workspaceId: string, id: string) {
    await this.db.query(`DELETE FROM ${tableName} WHERE kind = $1 AND workspace_id = $2 AND id = $3`, [
      kind,
      workspaceId,
      id
    ]);
  }

  async updateOnboardingSessionIfCurrent(record: OnboardingSession, expectedUpdatedAt: string) {
    const result = await this.db.query<RecordRow<OnboardingSession>>(
      `
        UPDATE ${tableName}
        SET data = $4::jsonb,
          updated_at = $5
        WHERE kind = $1
          AND workspace_id = $2
          AND id = $3
          AND data ->> 'updatedAt' = $6
        RETURNING data
      `,
      [
        "onboarding_session",
        record.workspaceId,
        record.id,
        JSON.stringify(record),
        record.updatedAt,
        expectedUpdatedAt
      ]
    );
    return result.rows[0]?.data ?? null;
  }

  async claimOnboardingCompletion(record: OnboardingSession, expectedUpdatedAt: string) {
    const result = await this.db.query<RecordRow<OnboardingSession>>(
      `
        UPDATE ${tableName}
        SET data = $4::jsonb,
          updated_at = $5
        WHERE kind = $1
          AND workspace_id = $2
          AND id = $3
          AND data ->> 'status' = 'reviewing'
          AND data ->> 'generatedSuggestion' IS NOT NULL
          AND data ->> 'updatedAt' = $6
        RETURNING data
      `,
      [
        "onboarding_session",
        record.workspaceId,
        record.id,
        JSON.stringify(record),
        record.updatedAt,
        expectedUpdatedAt
      ]
    );
    return result.rows[0]?.data ?? null;
  }
}

export function createPostgresRepositoryBundle(db: Queryable): Required<Pick<
  BuildAppOptions,
  | "companyRepository"
  | "processRepository"
  | "routineRepository"
  | "trainingRepository"
  | "announcementRepository"
  | "onboardingRepository"
  | "aiRepository"
>> {
  const store = new JsonbRecordStore(db);
  return {
    companyRepository: createJsonbCompanyRepository(store),
    processRepository: createJsonbProcessRepository(store),
    routineRepository: createJsonbRoutineRepository(store),
    trainingRepository: createPostgresTrainingRepository(store),
    announcementRepository: createPostgresAnnouncementRepository(store),
    onboardingRepository: createPostgresOnboardingRepository(store),
    aiRepository: createPostgresAiRepository(store)
  };
}

export function createRelationalOperationalRepositoryBundle(
  db: OperationalPool,
  jsonbCompanyRepository: CompanyRepository
): Pick<BuildAppOptions, "companyRepository" | "processRepository" | "routineRepository"> {
  return {
    companyRepository: createRelationalCompanyRepository(db, jsonbCompanyRepository),
    processRepository: createRelationalProcessRepository(db),
    routineRepository: createRelationalRoutineRepository(db)
  };
}

export function createConfiguredPostgresRepositoryBundle(
  db: OperationalPool,
  operationalStore: BaaseOperationalStore
): ReturnType<typeof createPostgresRepositoryBundle> {
  const jsonbBundle = createPostgresRepositoryBundle(db);
  if (operationalStore === "jsonb") return jsonbBundle;
  return {
    ...jsonbBundle,
    ...createRelationalOperationalRepositoryBundle(db, jsonbBundle.companyRepository)
  };
}

function createPostgresOnboardingRepository(store: JsonbRecordStore): OnboardingRepository {
  return {
    async getCurrentSession(workspaceId) {
      const sessions = await store.list<OnboardingSession>("onboarding_session", workspaceId);
      return sessions.sort(compareOnboardingSessionsByNewest)[0] ?? null;
    },

    findSession(workspaceId, sessionId) {
      return store.find<OnboardingSession>("onboarding_session", workspaceId, sessionId);
    },

    async createSession(input) {
      const timestamp = now();
      return store.insert<OnboardingSession>("onboarding_session", {
        ...input,
        id: await store.nextId("onboarding_session", input.workspaceId, "onboarding_session"),
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null
      });
    },

    async updateSession(session) {
      const persisted = await store.find<OnboardingSession>("onboarding_session", session.workspaceId, session.id);
      if (!persisted) throw new Error("ONBOARDING_SESSION_NOT_FOUND");
      if (persisted.updatedAt !== session.updatedAt) throw new Error("ONBOARDING_SESSION_STALE");

      const updated = {
        ...session,
        updatedAt: nextTimestamp(persisted.updatedAt)
      };
      const current = await store.updateOnboardingSessionIfCurrent(updated, persisted.updatedAt);
      if (!current) throw new Error("ONBOARDING_SESSION_STALE");
      return current;
    },

    async claimCompletion(workspaceId, sessionId) {
      const persisted = await store.find<OnboardingSession>("onboarding_session", workspaceId, sessionId);
      if (!persisted || persisted.status !== "reviewing" || !persisted.generatedSuggestion) return null;

      return store.claimOnboardingCompletion({
        ...persisted,
        status: "completing",
        currentStep: "completing",
        updatedAt: nextTimestamp(persisted.updatedAt)
      }, persisted.updatedAt);
    }
  };
}

function compareOnboardingSessionsByNewest(a: OnboardingSession, b: OnboardingSession) {
  const updatedOrder = b.updatedAt.localeCompare(a.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;

  const createdOrder = b.createdAt.localeCompare(a.createdAt);
  if (createdOrder !== 0) return createdOrder;

  return readNumericIdSuffix(b.id) - readNumericIdSuffix(a.id);
}

function readNumericIdSuffix(id: string) {
  return Number(id.split("_").at(-1)) || 0;
}

function createPostgresAiRepository(store: JsonbRecordStore): AiRepository {
  return {
    listRuns(workspaceId) {
      return store.list<AiRun>("ai_run", workspaceId);
    },

    findRun(workspaceId, runId) {
      return store.find<AiRun>("ai_run", workspaceId, runId);
    },

    async createRun(input) {
      const timestamp = now();
      return store.insert<AiRun>("ai_run", {
        ...input,
        id: await store.nextId("ai_run", input.workspaceId, "ai_run"),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    updateRun(run) {
      return store.update<AiRun>("ai_run", {
        ...run,
        updatedAt: now()
      });
    }
  };
}

function createJsonbCompanyRepository(store: JsonbRecordStore): CompanyRepository {
  return {
    async listAreas(workspaceId) {
      const areas = await store.list<Area>("area", workspaceId);
      return areas.sort((a, b) => a.sortOrder - b.sortOrder);
    },

    findAreaById(workspaceId, areaId) {
      return store.find<Area>("area", workspaceId, areaId);
    },

    async createArea(input) {
      const timestamp = now();
      const existingAreas = await store.list<Area>("area", input.workspaceId);
      const sortOrder = existingAreas.reduce((max, area) => Math.max(max, area.sortOrder), 0) + 1;
      return store.insert<Area>("area", {
        ...input,
        id: await store.nextId("area", input.workspaceId, "area"),
        sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    updateArea(area) {
      return store.update<Area>("area", {
        ...area,
        updatedAt: now()
      });
    },

    deleteArea(workspaceId, areaId) {
      return store.delete("area", workspaceId, areaId);
    },

    listRoleTemplates(workspaceId) {
      return store.list<RoleTemplate>("role_template", workspaceId);
    },

    async createRoleTemplate(input) {
      const timestamp = now();
      return store.insert<RoleTemplate>("role_template", {
        ...input,
        id: await store.nextId("role_template", input.workspaceId, "role"),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    deleteRoleTemplate(workspaceId, roleTemplateId) {
      return store.delete("role_template", workspaceId, roleTemplateId);
    },

    listTeamMembers(workspaceId) {
      return store.list<TeamMember>("team_member", workspaceId);
    },

    findTeamMember(workspaceId, personId) {
      return store.find<TeamMember>("team_member", workspaceId, personId);
    },

    async createTeamMember(input) {
      const timestamp = now();
      return store.insert<TeamMember>("team_member", {
        ...input,
        id: await store.nextId("team_member", input.workspaceId, "person"),
        status: input.status ?? "active",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    deleteTeamMember(workspaceId, personId) {
      return store.delete("team_member", workspaceId, personId);
    },

    updateTeamMember(person) {
      return store.update<TeamMember>("team_member", {
        ...person,
        updatedAt: now()
      });
    },

    listTeamInvites(workspaceId) {
      return store.list<TeamInvite>("team_invite", workspaceId);
    },

    findTeamInviteByCode(code) {
      return store.findByTextField<TeamInvite>("team_invite", "code", code);
    },

    async createTeamInvite(input) {
      const timestamp = now();
      const inviteId = await store.nextId("team_invite", input.workspaceId, "invite");
      const inviteNumber = readNumericIdSuffix(inviteId);
      return store.insert<TeamInvite>("team_invite", {
        ...input,
        id: inviteId,
        code: `BAASE-${String(inviteNumber).padStart(4, "0")}`,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    updateTeamInvite(invite) {
      return store.update<TeamInvite>("team_invite", {
        ...invite,
        updatedAt: now()
      });
    },

    deleteTeamInvite(workspaceId, inviteId) {
      return store.delete("team_invite", workspaceId, inviteId);
    }
  };
}

function createJsonbProcessRepository(store: JsonbRecordStore): ProcessRepository {
  return {
    listProcesses(workspaceId) {
      return store.list<CompanyProcess>("process", workspaceId);
    },

    findProcess(workspaceId, processId) {
      return store.find<CompanyProcess>("process", workspaceId, processId);
    },

    async createProcess(input) {
      const timestamp = now();
      const processId = await store.nextId("process", input.workspaceId, "process");
      const versions = input.versions.map((version) => ({
        ...version,
        id: `version_${processId}_${version.version}`,
        processId
      }));
      const process = {
        ...input,
        id: processId,
        versions,
        currentVersion: versions.find((version) => version.version === input.currentVersion.version)!,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return store.insert<CompanyProcess>("process", process);
    },

    updateProcess(process) {
      return store.update<CompanyProcess>("process", {
        ...process,
        updatedAt: now()
      });
    },

    deleteProcess(workspaceId, processId) {
      return store.delete("process", workspaceId, processId);
    }
  };
}

function createJsonbRoutineRepository(store: JsonbRecordStore): RoutineRepository {
  return {
    listRoutines(workspaceId) {
      return store.list<CompanyRoutine>("routine", workspaceId);
    },

    findRoutine(workspaceId, routineId) {
      return store.find<CompanyRoutine>("routine", workspaceId, routineId);
    },

    async createRoutine(input) {
      const timestamp = now();
      const routineId = await store.nextId("routine", input.workspaceId, "routine");
      const recurrence = normalizeRoutineRecurrence(input);
      const routine: CompanyRoutine = {
        ...input,
        ...recurrence,
        id: routineId,
        taskTemplates: input.taskTemplates.map((template) => ({
          ...template,
          id: template.id.replace("__routine__", routineId),
          routineId
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return store.insert<CompanyRoutine>("routine", routine);
    },

    updateRoutine(routine) {
      const recurrence = normalizeRoutineRecurrence(routine);
      return store.update<CompanyRoutine>("routine", {
        ...routine,
        ...recurrence,
        updatedAt: nextTimestamp(routine.updatedAt)
      });
    },

    async deleteRoutine(workspaceId, routineId) {
      const tasks = await store.list<TaskOccurrence>("task_occurrence", workspaceId);
      await Promise.all(tasks
        .filter((task) => task.routineId === routineId)
        .map((task) => store.delete("task_occurrence", workspaceId, task.id)));
      await store.delete("routine", workspaceId, routineId);
    },

    async listTaskOccurrences(workspaceId, filters = {}) {
      const tasks = await store.list<TaskOccurrence>("task_occurrence", workspaceId);
      return tasks.filter((task) => {
        if (filters.dueDate && task.dueDate !== filters.dueDate) return false;
        if (filters.profileId && task.assigneeProfileId && task.assigneeProfileId !== filters.profileId) return false;
        return true;
      });
    },

    findTaskOccurrence(workspaceId, taskId) {
      return store.find<TaskOccurrence>("task_occurrence", workspaceId, taskId);
    },

    async findTaskOccurrenceForTemplate(workspaceId, routineId, taskTemplateId, dueDate) {
      const tasks = await store.list<TaskOccurrence>("task_occurrence", workspaceId);
      return tasks.find((task) => task.routineId === routineId && task.taskTemplateId === taskTemplateId && task.dueDate === dueDate) ?? null;
    },

    async createTaskOccurrence(input) {
      const timestamp = now();
      return store.insert<TaskOccurrence>("task_occurrence", {
        ...input,
        origin: input.origin ?? (input.routineId ? "routine" : "manual"),
        id: await store.nextId("task_occurrence", input.workspaceId, "task"),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    updateTaskOccurrence(task) {
      return store.update<TaskOccurrence>("task_occurrence", {
        ...task,
        updatedAt: now()
      });
    },

    deleteTaskOccurrence(workspaceId, taskId) {
      return store.delete("task_occurrence", workspaceId, taskId);
    }
  };
}

function createPostgresTrainingRepository(store: JsonbRecordStore): TrainingRepository {
  return {
    listTrainings(workspaceId) {
      return store.list<Training>("training", workspaceId);
    },

    findTraining(workspaceId, trainingId) {
      return store.find<Training>("training", workspaceId, trainingId);
    },

    async createTraining(input) {
      const timestamp = now();
      const trainingId = await store.nextId("training", input.workspaceId, "training");
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
      return store.insert<Training>("training", training);
    },

    updateTraining(training) {
      return store.update<Training>("training", {
        ...training,
        updatedAt: now()
      });
    },

    async deleteTraining(workspaceId, trainingId) {
      const [assignments, attempts] = await Promise.all([
        store.list<TrainingAssignment>("training_assignment", workspaceId),
        store.list<QuizAttempt>("quiz_attempt", workspaceId)
      ]);
      await Promise.all([
        ...assignments
          .filter((assignment) => assignment.trainingId === trainingId)
          .map((assignment) => store.delete("training_assignment", workspaceId, assignment.id)),
        ...attempts
          .filter((attempt) => attempt.trainingId === trainingId)
          .map((attempt) => store.delete("quiz_attempt", workspaceId, attempt.id))
      ]);
      await store.delete("training", workspaceId, trainingId);
    },

    listTrainingAssignments(workspaceId) {
      return store.list<TrainingAssignment>("training_assignment", workspaceId);
    },

    async createTrainingAssignment(input) {
      const timestamp = now();
      return store.insert<TrainingAssignment>("training_assignment", {
        ...input,
        id: await store.nextId("training_assignment", input.workspaceId, "training_assignment"),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    },

    async listQuizAttempts(workspaceId, filters = {}) {
      const attempts = await store.list<QuizAttempt>("quiz_attempt", workspaceId);
      return attempts.filter((attempt) => {
        if (filters.trainingId && attempt.trainingId !== filters.trainingId) return false;
        if (filters.profileId && attempt.profileId !== filters.profileId) return false;
        return true;
      });
    },

    async createQuizAttempt(input) {
      const attempt: QuizAttempt = {
        ...input,
        id: await store.nextId("quiz_attempt", input.workspaceId, "attempt"),
        createdAt: now()
      };
      return store.insert<QuizAttempt>("quiz_attempt", attempt);
    }
  };
}

function createPostgresAnnouncementRepository(store: JsonbRecordStore): AnnouncementRepository {
  return {
    listAnnouncements(workspaceId) {
      return store.list<Announcement>("announcement", workspaceId);
    },

    findAnnouncement(workspaceId, announcementId) {
      return store.find<Announcement>("announcement", workspaceId, announcementId);
    },

    async createAnnouncement(input) {
      const timestamp = now();
      const announcementId = await store.nextId("announcement", input.workspaceId, "announcement");
      const announcement: Announcement = {
        ...input,
        id: announcementId,
        quizQuestions: input.quizQuestions.map((question) => ({
          ...question,
          id: question.id.replace("__announcement__", announcementId),
          announcementId
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return store.insert<Announcement>("announcement", announcement);
    },

    updateAnnouncement(announcement) {
      return store.update<Announcement>("announcement", {
        ...announcement,
        updatedAt: now()
      });
    },

    async deleteAnnouncement(workspaceId, announcementId) {
      const receipts = await store.list<AnnouncementReceipt>("announcement_receipt", workspaceId);
      await Promise.all(receipts
        .filter((receipt) => receipt.announcementId === announcementId)
        .map((receipt) => store.delete("announcement_receipt", workspaceId, receipt.id)));
      await store.delete("announcement", workspaceId, announcementId);
    },

    async listAnnouncementReceipts(workspaceId, filters = {}) {
      const receipts = await store.list<AnnouncementReceipt>("announcement_receipt", workspaceId);
      return receipts.filter((receipt) => {
        if (filters.announcementId && receipt.announcementId !== filters.announcementId) return false;
        if (filters.profileId && receipt.profileId !== filters.profileId) return false;
        return true;
      });
    },

    async upsertAnnouncementReceipt(input) {
      const timestamp = now();
      const existing = input.id
        ? await store.find<AnnouncementReceipt>("announcement_receipt", input.workspaceId, input.id)
        : (await store.list<AnnouncementReceipt>("announcement_receipt", input.workspaceId)).find((receipt) => {
          return receipt.announcementId === input.announcementId && receipt.profileId === input.profileId;
        }) ?? null;
      const receipt: AnnouncementReceipt = {
        ...input,
        id: existing?.id ?? await store.nextId("announcement_receipt", input.workspaceId, "announcement_receipt"),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };

      if (existing) return store.update<AnnouncementReceipt>("announcement_receipt", receipt);
      return store.insert<AnnouncementReceipt>("announcement_receipt", receipt);
    }
  };
}
