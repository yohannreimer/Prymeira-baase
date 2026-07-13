import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { BuildAppOptions } from "../app";
import type { AiRepository, AiRun } from "../modules/ai/ai.types";
import type { Announcement, AnnouncementReceipt, AnnouncementRepository } from "../modules/announcements/announcement.types";
import { normalizeAccessScope, normalizeAreaAccessIds, type Area, type CompanyRepository, type RoleTemplate, type TeamInvite, type TeamMember } from "../modules/company/company.types";
import type { OnboardingRepository, OnboardingSession } from "../modules/onboarding/onboarding.types";
import type { CompanyProcess, ProcessRepository } from "../modules/processes/process.types";
import type { CompanyRoutine, RoutineRepository, TaskOccurrence } from "../modules/routines/routine.types";
import { normalizeRoutineRecurrence } from "../modules/routines/routine-recurrence";
import type { QuizAttempt, Training, TrainingAssignment, TrainingRepository } from "../modules/trainings/training.types";
import { createPostgresCompanyRepository as createRelationalCompanyRepository } from "../modules/company/postgres-company.repository";
import {
  createJsonbAreaLifecycleRepository,
  createRelationalAreaLifecycleRepository
} from "../modules/company/area-lifecycle.repository";
import { createPostgresProcessRepository as createRelationalProcessRepository } from "../modules/processes/postgres-process.repository";
import { createPostgresRoutineRepository as createRelationalRoutineRepository } from "../modules/routines/postgres-routine.repository";
import { createPostgresStudioRepository } from "../modules/studio/postgres-studio.repository";
import { lockWorkspaceOperationalMutation, withOperationalTransaction, type OperationalClient, type OperationalPool } from "./operational-repository-support";
import type { BaaseOperationalStore } from "../config/runtime";

type Queryable = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type RecordRow<T> = {
  data: T;
};

const tableName = "baase_records";
const postgresSchemaLock = [1111574864, 1768843636];
const postgresSchemaMigrations = [{
  version: 1,
  name: "global_unguessable_team_invite_codes",
  run: rotateLegacyAndDuplicateInviteCodes
}] as const;

export async function ensurePostgresSchema(db: OperationalPool) {
  await migratePostgresSchema(db);
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

  async updateTeamInviteIfCurrent(record: TeamInvite, expectedUpdatedAt: string, expectedStatus: TeamInvite["status"]) {
    const result = await this.db.query<RecordRow<TeamInvite>>(
      `UPDATE ${tableName}
       SET data = $3::jsonb, updated_at = $4
       WHERE kind = 'team_invite' AND workspace_id = $1 AND id = $2
         AND data ->> 'updatedAt' = $5 AND data ->> 'status' = $6
       RETURNING data`,
      [record.workspaceId, record.id, JSON.stringify(record), record.updatedAt, expectedUpdatedAt, expectedStatus]
    );
    return result.rows[0]?.data ?? null;
  }

  async deleteTeamInviteIfCurrent(
    workspaceId: string,
    inviteId: string,
    expectedUpdatedAt: string,
    expectedStatus: TeamInvite["status"]
  ) {
    const result = await this.db.query<{ id: string }>(
      `DELETE FROM ${tableName}
       WHERE kind = 'team_invite' AND workspace_id = $1 AND id = $2
         AND data ->> 'updatedAt' = $3 AND data ->> 'status' = $4
       RETURNING id`,
      [workspaceId, inviteId, expectedUpdatedAt, expectedStatus]
    );
    return Boolean(result.rows[0]);
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

  async withWorkspaceOperationalMutation<T>(workspaceId: string, run: (store: JsonbRecordStore) => Promise<T>) {
    const pool = this.db as OperationalPool;
    if (typeof pool.connect !== "function") return run(this);
    return withOperationalTransaction(pool, async (client) => {
      await lockWorkspaceOperationalMutation(client, workspaceId);
      return run(new JsonbRecordStore(client));
    });
  }
}

export type PostgresRepositoryBundleOptions = {
  inviteCodeGenerator?: () => string;
};

type PostgresRepositoryBundle = Required<Pick<
  BuildAppOptions,
  | "companyRepository"
  | "areaLifecycleRepository"
  | "processRepository"
  | "routineRepository"
  | "trainingRepository"
  | "announcementRepository"
  | "onboardingRepository"
  | "aiRepository"
  | "studioRepository"
>>;

async function assertJsonbActiveArea(store: JsonbRecordStore, workspaceId: string, areaId: string | null | undefined) {
  if (!areaId) return;
  const area = await store.find<Area>("area", workspaceId, areaId);
  if (!area || area.archivedAt) throw new Error("AREA_NOT_FOUND");
}

async function assertJsonbActiveRoleTemplate(
  store: JsonbRecordStore,
  workspaceId: string,
  areaId: string | null | undefined,
  roleTemplateId: string | null | undefined
) {
  if (!roleTemplateId) return;
  const role = await store.find<RoleTemplate>("role_template", workspaceId, roleTemplateId);
  if (!role || role.archivedAt) throw new Error("ROLE_TEMPLATE_NOT_FOUND");
  if (areaId && role.areaId !== areaId) throw new Error("ROLE_TEMPLATE_AREA_MISMATCH");
}

async function assertJsonbActivePerson(
  store: JsonbRecordStore,
  workspaceId: string,
  personId: string | null | undefined
) {
  if (!personId) return;
  const person = await store.find<TeamMember>("team_member", workspaceId, personId);
  if (!person || person.status !== "active") throw new Error("PERSON_NOT_FOUND");
}

export function createPostgresRepositoryBundle(
  db: OperationalPool,
  options: PostgresRepositoryBundleOptions = {}
): PostgresRepositoryBundle {
  const store = new JsonbRecordStore(db);
  return {
    companyRepository: createJsonbCompanyRepository(store, options.inviteCodeGenerator ?? generateInviteCode),
    areaLifecycleRepository: createJsonbAreaLifecycleRepository(db),
    processRepository: createJsonbProcessRepository(store),
    routineRepository: createJsonbRoutineRepository(store),
    trainingRepository: createPostgresTrainingRepository(store),
    announcementRepository: createPostgresAnnouncementRepository(store),
    onboardingRepository: createPostgresOnboardingRepository(store),
    aiRepository: createPostgresAiRepository(store),
    studioRepository: createPostgresStudioRepository(db)
  };
}

export function createRelationalOperationalRepositoryBundle(
  db: OperationalPool,
  jsonbCompanyRepository: CompanyRepository
): Pick<BuildAppOptions, "companyRepository" | "areaLifecycleRepository" | "processRepository" | "routineRepository"> {
  return {
    companyRepository: createRelationalCompanyRepository(db, jsonbCompanyRepository),
    areaLifecycleRepository: createRelationalAreaLifecycleRepository(db),
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

function createJsonbCompanyRepository(store: JsonbRecordStore, inviteCodeGenerator: () => string): CompanyRepository {
  return {
    async listAreas(workspaceId) {
      const areas = await store.list<Area>("area", workspaceId);
      return areas.filter((area) => !area.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
    },

    async findAreaById(workspaceId, areaId) {
      const area = await store.find<Area>("area", workspaceId, areaId);
      return area?.archivedAt ? null : area;
    },

    async createArea(input) {
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        const timestamp = now();
        const existingAreas = await lockedStore.list<Area>("area", input.workspaceId);
        const sortOrder = existingAreas.reduce((max, area) => Math.max(max, area.sortOrder), 0) + 1;
        return lockedStore.insert<Area>("area", {
          ...input,
          id: await lockedStore.nextId("area", input.workspaceId, "area"),
          sortOrder,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });
    },

    updateArea(area) {
      return store.withWorkspaceOperationalMutation(area.workspaceId, (lockedStore) => lockedStore.update<Area>("area", {
        ...area,
        updatedAt: now()
      }));
    },

    async deleteArea(workspaceId, areaId) {
      await store.withWorkspaceOperationalMutation(workspaceId, async (lockedStore) => {
        const area = await lockedStore.find<Area>("area", workspaceId, areaId);
        if (!area || area.archivedAt) return;
        await lockedStore.update<Area>("area", { ...area, archivedAt: now(), updatedAt: now() });
      });
    },

    listRoleTemplates(workspaceId) {
      return store.list<RoleTemplate>("role_template", workspaceId).then((roles) => roles.filter((role) => !role.archivedAt));
    },

    async createRoleTemplate(input) {
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, input.workspaceId, input.areaId);
        const timestamp = now();
        return lockedStore.insert<RoleTemplate>("role_template", {
          ...input,
          id: await lockedStore.nextId("role_template", input.workspaceId, "role"),
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });
    },

    async deleteRoleTemplate(workspaceId, roleTemplateId) {
      await store.withWorkspaceOperationalMutation(workspaceId, async (lockedStore) => {
        const role = await lockedStore.find<RoleTemplate>("role_template", workspaceId, roleTemplateId);
        if (!role || role.archivedAt) return;
        await lockedStore.update<RoleTemplate>("role_template", { ...role, archivedAt: now(), updatedAt: now() });
      });
    },

    listTeamMembers(workspaceId) {
      return store.list<TeamMember>("team_member", workspaceId).then((people) => people
        .map(normalizeJsonbTeamMember)
        .filter((person) => person.status !== "archived"));
    },

    findTeamMember(workspaceId, personId) {
      return store.find<TeamMember>("team_member", workspaceId, personId).then((person) => {
        const normalized = person ? normalizeJsonbTeamMember(person) : null;
        return normalized?.status === "archived" ? null : normalized;
      });
    },

    async findTeamMemberByClerkUserId(workspaceId, clerkUserId) {
      return (await store.list<TeamMember>("team_member", workspaceId)).map(normalizeJsonbTeamMember)
        .find((person) => person.clerkUserId === clerkUserId && person.status !== "archived") ?? null;
    },

    async findTeamMemberByCustomerId(workspaceId, customerId) {
      return (await store.list<TeamMember>("team_member", workspaceId)).map(normalizeJsonbTeamMember)
        .find((person) => person.customerId === customerId && person.status !== "archived") ?? null;
    },

    async findUnlinkedTeamMembersByEmail(workspaceId, email) {
      const normalized = email.trim().toLowerCase();
      return (await store.list<TeamMember>("team_member", workspaceId)).map(normalizeJsonbTeamMember)
        .filter((person) => person.status !== "archived" && !person.clerkUserId && !person.customerId && person.email?.trim().toLowerCase() === normalized);
    },

    async hasLinkedOwner(workspaceId) {
      return (await store.list<TeamMember>("team_member", workspaceId)).map(normalizeJsonbTeamMember)
        .some((person) => person.role === "owner" && person.status === "active" && Boolean(person.clerkUserId));
    },

    async createTeamMember(input) {
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, input.workspaceId, input.areaId);
        await assertJsonbActiveRoleTemplate(lockedStore, input.workspaceId, input.areaId, input.roleTemplateId);
        const timestamp = now();
        if (input.clerkUserId && (await lockedStore.list<TeamMember>("team_member", input.workspaceId)).some((person) => normalizeJsonbTeamMember(person).clerkUserId === input.clerkUserId && person.status !== "archived")) {
          throw new Error("TEAM_MEMBER_CLERK_ID_CONFLICT");
        }
        if (input.customerId && (await lockedStore.list<TeamMember>("team_member", input.workspaceId)).some((person) => normalizeJsonbTeamMember(person).customerId === input.customerId && person.status !== "archived")) {
          throw new Error("TEAM_MEMBER_CUSTOMER_ID_CONFLICT");
        }
        return lockedStore.insert<TeamMember>("team_member", {
          ...input,
          id: await lockedStore.nextId("team_member", input.workspaceId, "person"),
          areaAccessIds: normalizeAreaAccessIds(input.areaId, input.areaAccessIds),
          accessScope: normalizeAccessScope(input.role, input.accessScope),
          clerkUserId: input.clerkUserId ?? null,
          customerId: input.customerId ?? null,
          status: input.status ?? "active",
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });
    },

    async deleteTeamMember(workspaceId, personId) {
      return store.withWorkspaceOperationalMutation(workspaceId, async (lockedStore) => {
        const person = await lockedStore.find<TeamMember>("team_member", workspaceId, personId);
        if (!person) return;
        await lockedStore.update<TeamMember>("team_member", { ...normalizeJsonbTeamMember(person), status: "archived", updatedAt: now() });
      });
    },

    updateTeamMember(person) {
      return store.withWorkspaceOperationalMutation(person.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, person.workspaceId, person.areaId);
        await assertJsonbActiveRoleTemplate(lockedStore, person.workspaceId, person.areaId, person.roleTemplateId);
        const others = await lockedStore.list<TeamMember>("team_member", person.workspaceId);
        if (person.clerkUserId && others.some((item) => item.id !== person.id && normalizeJsonbTeamMember(item).clerkUserId === person.clerkUserId && item.status !== "archived")) throw new Error("TEAM_MEMBER_CLERK_ID_CONFLICT");
        if (person.customerId && others.some((item) => item.id !== person.id && normalizeJsonbTeamMember(item).customerId === person.customerId && item.status !== "archived")) throw new Error("TEAM_MEMBER_CUSTOMER_ID_CONFLICT");
        return lockedStore.update<TeamMember>("team_member", {
          ...person,
          areaAccessIds: normalizeAreaAccessIds(person.areaId, person.areaAccessIds),
          accessScope: normalizeAccessScope(person.role, person.accessScope),
          updatedAt: now()
        });
      });
    },

    listTeamInvites(workspaceId) {
      return store.list<TeamInvite>("team_invite", workspaceId);
    },

    findTeamInviteByCode(code) {
      return store.findByTextField<TeamInvite>("team_invite", "code", code);
    },

    async createTeamInvite(input) {
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, input.workspaceId, input.areaId);
        await assertJsonbActiveRoleTemplate(lockedStore, input.workspaceId, input.areaId, input.roleTemplateId);
        const timestamp = now();
        try {
          return await lockedStore.insert<TeamInvite>("team_invite", {
            ...input,
            id: `invite_${randomUUID()}`,
            code: inviteCodeGenerator().trim().toUpperCase(),
            status: "pending",
            createdAt: timestamp,
            updatedAt: timestamp
          });
        } catch (error) {
          if (isInviteCodeConflict(error)) throw new Error("INVITE_CODE_CONFLICT");
          throw error;
        }
      });
    },

    async updateTeamInvite(invite, expected) {
      const snapshot = expected ?? { updatedAt: invite.updatedAt, status: invite.status };
      const updated = await store.updateTeamInviteIfCurrent({
        ...invite,
        updatedAt: nextTimestamp(snapshot.updatedAt)
      }, snapshot.updatedAt, snapshot.status);
      if (updated) return updated;
      if (await store.find<TeamInvite>("team_invite", invite.workspaceId, invite.id)) throw new Error("INVITE_STALE");
      throw new Error("INVITE_NOT_FOUND");
    },

    async deleteTeamInvite(workspaceId, inviteId, expected) {
      const persisted = await store.find<TeamInvite>("team_invite", workspaceId, inviteId);
      if (!persisted) return;
      const snapshot = expected ?? { updatedAt: persisted.updatedAt, status: persisted.status };
      const deleted = await store.deleteTeamInviteIfCurrent(
        workspaceId,
        inviteId,
        snapshot.updatedAt,
        snapshot.status
      );
      if (!deleted) throw new Error("INVITE_STALE");
    },

    async acceptTeamInviteAtomically(invite, member) {
      return store.withWorkspaceOperationalMutation(invite.workspaceId, async (lockedStore) => {
        const persisted = await lockedStore.find<TeamInvite>("team_invite", invite.workspaceId, invite.id);
        if (!persisted || persisted.status === "revoked") throw new Error("INVITE_NOT_FOUND");
        const personId = persisted.personId ?? `person_${persisted.id}`;

        if (persisted.status === "accepted") {
          const person = await lockedStore.find<TeamMember>("team_member", persisted.workspaceId, personId);
          if (!person) throw new Error("INVITE_ACCEPTANCE_INCOMPLETE");
          return { invite: persisted, person };
        }
        if (persisted.updatedAt !== invite.updatedAt) throw new Error("INVITE_STALE");

        await assertJsonbActiveArea(lockedStore, persisted.workspaceId, persisted.areaId);
        await assertJsonbActiveRoleTemplate(lockedStore, persisted.workspaceId, persisted.areaId, persisted.roleTemplateId);
        const existing = await lockedStore.find<TeamMember>("team_member", persisted.workspaceId, personId);
        if (existing) throw new Error("INVITE_ACCEPTANCE_INCOMPLETE");

        const person: TeamMember = {
          ...member,
          id: personId,
          workspaceId: persisted.workspaceId,
          role: persisted.role,
          areaId: persisted.areaId,
          areaAccessIds: normalizeAreaAccessIds(persisted.areaId, persisted.areaAccessIds),
          roleTemplateId: persisted.roleTemplateId,
          accessScope: normalizeAccessScope(persisted.role, persisted.accessScope),
          clerkUserId: member.clerkUserId,
          customerId: member.customerId,
          createdAt: now(),
          updatedAt: now()
        };
        await lockedStore.insert<TeamMember>("team_member", person);
        const acceptedInvite: TeamInvite = {
          ...persisted,
          status: "accepted",
          personId,
          acceptedAt: person.createdAt,
          updatedAt: nextTimestamp(persisted.updatedAt)
        };
        const updated = await lockedStore.updateTeamInviteIfCurrent(
          acceptedInvite,
          persisted.updatedAt,
          "pending"
        );
        if (!updated) throw new Error("INVITE_STALE");
        return { invite: updated, person };
      });
    }
  };
}

function normalizeJsonbTeamMember(person: TeamMember): TeamMember {
  return {
    ...person,
    areaAccessIds: normalizeAreaAccessIds(person.areaId, person.areaAccessIds),
    accessScope: normalizeAccessScope(person.role, person.accessScope),
    clerkUserId: person.clerkUserId ?? null,
    customerId: person.customerId ?? null
  };
}

function generateInviteCode() {
  return `BAASE-${randomUUID().replaceAll("-", "").toUpperCase()}`;
}

async function migratePostgresSchema(db: OperationalPool) {
  await withOperationalTransaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", postgresSchemaLock);
    await client.query(`CREATE TABLE IF NOT EXISTS ${tableName} (
      kind TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (kind, workspace_id, id)
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS baase_records_workspace_kind_idx
      ON ${tableName} (workspace_id, kind)`);
    await client.query(`CREATE TABLE IF NOT EXISTS baase_postgres_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    for (const migration of postgresSchemaMigrations) {
      const applied = await client.query<{ version: number }>(
        "SELECT version FROM baase_postgres_schema_migrations WHERE version=$1",
        [migration.version]
      );
      if (applied.rows[0]) continue;
      await migration.run(client);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS baase_records_team_invite_code_uidx
        ON ${tableName} ((data ->> 'code')) WHERE kind = 'team_invite'`);
      await client.query(
        "INSERT INTO baase_postgres_schema_migrations (version,name) VALUES ($1,$2)",
        [migration.version, migration.name]
      );
    }
  });
}

async function rotateLegacyAndDuplicateInviteCodes(db: OperationalClient) {
  const hasInvites = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM ${tableName} WHERE kind='team_invite') exists`
  );
  if (!hasInvites.rows[0]?.exists) return;
  await db.query(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);
  const records = await db.query<{ workspace_id: string; id: string; data: TeamInvite }>(
    `SELECT workspace_id, id, data FROM ${tableName}
     WHERE kind = 'team_invite' ORDER BY created_at, workspace_id, id FOR UPDATE`
  );
  const usedCodes = new Set<string>();
  for (const record of records.rows) {
    const code = record.data.code?.toUpperCase();
    const needsRotation = !code || /^BAASE-[0-9]{4}$/.test(code) || usedCodes.has(code);
    if (!needsRotation) {
      usedCodes.add(code);
      continue;
    }

    let replacement = generateInviteCode();
    while (usedCodes.has(replacement)) replacement = generateInviteCode();
    const updatedAt = nextTimestamp(record.data.updatedAt);
    const updated = await db.query<{ id: string }>(
      `UPDATE ${tableName}
       SET data = jsonb_set(
         jsonb_set(data, '{code}', $3::jsonb, TRUE),
         '{updatedAt}', $4::jsonb, TRUE
       ), updated_at = $5
       WHERE kind = 'team_invite' AND workspace_id = $1 AND id = $2
         AND data ->> 'updatedAt' = $6
         AND data ->> 'code' IS NOT DISTINCT FROM $7
       RETURNING id`,
      [
        record.workspace_id,
        record.id,
        JSON.stringify(replacement),
        JSON.stringify(updatedAt),
        updatedAt,
        record.data.updatedAt,
        record.data.code
      ]
    );
    if (!updated.rows[0]) throw new Error("INVITE_CODE_MIGRATION_STALE");
    usedCodes.add(replacement);
  }
}

function isInviteCodeConflict(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "23505"
    && "constraint" in error && error.constraint === "baase_records_team_invite_code_uidx";
}

function createJsonbProcessRepository(store: JsonbRecordStore): ProcessRepository {
  return {
    async listProcesses(workspaceId) {
      return (await store.list<CompanyProcess>("process", workspaceId)).map(normalizeJsonbProcess);
    },

    async findProcess(workspaceId, processId) {
      const process = await store.find<CompanyProcess>("process", workspaceId, processId);
      return process ? normalizeJsonbProcess(process) : null;
    },

    async createProcess(input) {
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, input.workspaceId, input.areaId);
        const owner = input.owner === undefined
          ? input.ownerProfileId ? { type: "person" as const, personId: input.ownerProfileId } : null
          : input.owner;
        if (owner?.type === "person") await assertJsonbActivePerson(lockedStore, input.workspaceId, owner.personId);
        if (owner?.type === "role") await assertJsonbActiveRoleTemplate(lockedStore, input.workspaceId, input.areaId, owner.roleTemplateId);
        const timestamp = now();
        const processId = await lockedStore.nextId("process", input.workspaceId, "process");
        const versions = input.versions.map((version) => ({
          ...version,
          id: `version_${processId}_${version.version}`,
          processId
        }));
        const process: CompanyProcess = {
          ...input,
          owner,
          id: processId,
          materials: (input.materials ?? []).map((material) => ({
            ...material,
            id: material.id.replace("material_new_", `material_${processId}_`),
            processId,
            workspaceId: input.workspaceId,
            createdAt: material.createdAt || timestamp
          })),
          versions,
          currentVersion: versions.find((version) => version.version === input.currentVersion.version)!,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        return lockedStore.insert<CompanyProcess>("process", process);
      });
    },

    updateProcess(process) {
      return store.withWorkspaceOperationalMutation(process.workspaceId, async (lockedStore) => {
        const persisted = await lockedStore.find<CompanyProcess>("process", process.workspaceId, process.id);
        if (!persisted) throw new Error("PROCESS_NOT_FOUND");
        if ((persisted.areaId ?? null) !== (process.areaId ?? null)) {
          await assertJsonbActiveArea(lockedStore, process.workspaceId, process.areaId);
        }
        const owner = Object.prototype.hasOwnProperty.call(process, "owner")
          ? process.owner ?? null
          : process.ownerProfileId ? { type: "person" as const, personId: process.ownerProfileId } : null;
        if (owner?.type === "person") await assertJsonbActivePerson(lockedStore, process.workspaceId, owner.personId);
        if (owner?.type === "role") await assertJsonbActiveRoleTemplate(lockedStore, process.workspaceId, process.areaId, owner.roleTemplateId);
        return lockedStore.update<CompanyProcess>("process", {
          ...process,
          owner,
          updatedAt: now()
        });
      });
    },

    deleteProcess(workspaceId, processId) {
      return store.delete("process", workspaceId, processId);
    },

    async listProcessMaterials(workspaceId, processId) {
      const process = await store.find<CompanyProcess>("process", workspaceId, processId);
      return process ? normalizeJsonbProcess(process).materials! : [];
    },

    async findProcessMaterial(workspaceId, processId, materialId) {
      const process = await store.find<CompanyProcess>("process", workspaceId, processId);
      return process
        ? normalizeJsonbProcess(process).materials!.find((item) => item.id === materialId) ?? null
        : null;
    },

    async addProcessMaterial(input) {
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        const process = await lockedStore.find<CompanyProcess>("process", input.workspaceId, input.processId);
        if (!process) throw new Error("PROCESS_NOT_FOUND");
        const material = {
          ...input,
          id: await lockedStore.nextId("process_material", input.workspaceId, "material"),
          createdAt: now()
        };
        await lockedStore.update<CompanyProcess>("process", {
          ...normalizeJsonbProcess(process),
          materials: [...(process.materials ?? []), material],
          updatedAt: now()
        });
        return material;
      });
    },

    async removeProcessMaterial(workspaceId, processId, materialId) {
      return store.withWorkspaceOperationalMutation(workspaceId, async (lockedStore) => {
        const process = await lockedStore.find<CompanyProcess>("process", workspaceId, processId);
        if (!process) throw new Error("PROCESS_NOT_FOUND");
        const material = process.materials?.find((item) => item.id === materialId) ?? null;
        if (!material) return null;
        await lockedStore.update<CompanyProcess>("process", {
          ...normalizeJsonbProcess(process),
          materials: process.materials!.filter((item) => item.id !== materialId),
          updatedAt: now()
        });
        return material;
      });
    }
  };
}

function normalizeJsonbProcess(process: CompanyProcess): CompanyProcess {
  const owner = Object.prototype.hasOwnProperty.call(process, "owner")
    ? process.owner ?? null
    : process.ownerProfileId ? { type: "person" as const, personId: process.ownerProfileId } : null;
  return { ...process, owner, materials: process.materials ?? [] };
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
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, input.workspaceId, input.areaId);
        const timestamp = now();
        const routineId = await lockedStore.nextId("routine", input.workspaceId, "routine");
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
        return lockedStore.insert<CompanyRoutine>("routine", routine);
      });
    },

    updateRoutine(routine) {
      return store.withWorkspaceOperationalMutation(routine.workspaceId, async (lockedStore) => {
        const persisted = await lockedStore.find<CompanyRoutine>("routine", routine.workspaceId, routine.id);
        if (!persisted) throw new Error("ROUTINE_NOT_FOUND");
        if ((persisted.areaId ?? null) !== (routine.areaId ?? null)) {
          await assertJsonbActiveArea(lockedStore, routine.workspaceId, routine.areaId);
        }
        const recurrence = normalizeRoutineRecurrence(routine);
        return lockedStore.update<CompanyRoutine>("routine", {
          ...routine,
          ...recurrence,
          updatedAt: nextTimestamp(routine.updatedAt)
        });
      });
    },

    async deleteRoutine(workspaceId, routineId) {
      await store.withWorkspaceOperationalMutation(workspaceId, async (lockedStore) => {
        const tasks = await lockedStore.list<TaskOccurrence>("task_occurrence", workspaceId);
        await Promise.all(tasks
          .filter((task) => task.routineId === routineId)
          .map((task) => lockedStore.delete("task_occurrence", workspaceId, task.id)));
        await lockedStore.delete("routine", workspaceId, routineId);
      });
    },

    async listTaskOccurrences(workspaceId, filters = {}) {
      const tasks = await store.list<TaskOccurrence>("task_occurrence", workspaceId);
      return tasks.filter((task) => {
        if (filters.dueDate && task.dueDate !== filters.dueDate) return false;
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
      return store.withWorkspaceOperationalMutation(input.workspaceId, async (lockedStore) => {
        await assertJsonbActiveArea(lockedStore, input.workspaceId, input.areaId);
        const timestamp = now();
        const routineRevisionSnapshot = input.routineRevisionSnapshot ?? (input.routineId
          ? (await lockedStore.find<CompanyRoutine>("routine", input.workspaceId, input.routineId))?.updatedAt ?? null
          : null);
        return lockedStore.insert<TaskOccurrence>("task_occurrence", {
          ...input,
          origin: input.origin ?? (input.routineId ? "routine" : "manual"),
          routineRevisionSnapshot,
          id: await lockedStore.nextId("task_occurrence", input.workspaceId, "task"),
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });
    },

    async reconcileRoutineOccurrences(routine, dueDate, desired) {
      return store.withWorkspaceOperationalMutation(routine.workspaceId, async (lockedStore) => {
        const persistedRoutine = await lockedStore.find<CompanyRoutine>("routine", routine.workspaceId, routine.id);
        if (!persistedRoutine) throw new Error("ROUTINE_NOT_FOUND");
        if (persistedRoutine.updatedAt !== routine.updatedAt) throw new Error("ROUTINE_STALE");

        const existing = (await lockedStore.list<TaskOccurrence>("task_occurrence", routine.workspaceId))
          .filter((task) => task.routineId === routine.id && task.dueDate === dueDate);
        const existingByKey = new Map(existing.map((task) => [routineOccurrenceKey(task), task]));
        const desiredByKey = new Map(desired.map((task) => [routineOccurrenceKey(task), task]));
        const removedObjectKeys = new Set<string>();

        for (const [key, input] of desiredByKey) {
          const task = existingByKey.get(key);
          if (!task) {
            const timestamp = now();
            await lockedStore.insert<TaskOccurrence>("task_occurrence", {
              ...input,
              origin: input.origin ?? "routine",
              routineRevisionSnapshot: input.routineRevisionSnapshot ?? routine.updatedAt,
              id: await lockedStore.nextId("task_occurrence", routine.workspaceId, "task"),
              createdAt: timestamp,
              updatedAt: timestamp
            });
            continue;
          }
          if (!isPendingTask(task)) continue;
          const revisionChanged = task.routineRevisionSnapshot !== routine.updatedAt;
          const next: TaskOccurrence = {
            ...task,
            ...input,
            checklistItems: revisionChanged ? input.checklistItems : task.checklistItems,
            routineRevisionSnapshot: routine.updatedAt,
            id: task.id,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
          };
          if (sameRoutineOccurrence(task, next)) continue;
          await lockedStore.update<TaskOccurrence>("task_occurrence", {
            ...next,
            updatedAt: nextTimestamp(task.updatedAt)
          });
          const previousObjectKey = task.evidence?.attachment?.objectKey;
          const nextObjectKey = next.evidence?.attachment?.objectKey;
          if (previousObjectKey && previousObjectKey !== nextObjectKey) removedObjectKeys.add(previousObjectKey);
        }

        for (const task of existing) {
          if (!desiredByKey.has(routineOccurrenceKey(task)) && isPendingTask(task)) {
            await lockedStore.delete("task_occurrence", routine.workspaceId, task.id);
            const objectKey = task.evidence?.attachment?.objectKey;
            if (objectKey) removedObjectKeys.add(objectKey);
          }
        }

        const activeTasks = await lockedStore.list<TaskOccurrence>("task_occurrence", routine.workspaceId);
        const activeObjectKeys = new Set(activeTasks.flatMap((task) => task.evidence?.attachment?.objectKey ? [task.evidence.attachment.objectKey] : []));
        return {
          tasks: activeTasks.filter((task) => task.routineId === routine.id && task.dueDate === dueDate),
          removedObjectKeys: [...removedObjectKeys].filter((objectKey) => !activeObjectKeys.has(objectKey))
        };
      });
    },

    updateTaskOccurrence(task) {
      return store.withWorkspaceOperationalMutation(task.workspaceId, async (lockedStore) => {
        const persisted = await lockedStore.find<TaskOccurrence>("task_occurrence", task.workspaceId, task.id);
        if (!persisted) throw new Error("TASK_NOT_FOUND");
        if ((persisted.areaId ?? null) !== (task.areaId ?? null)) {
          await assertJsonbActiveArea(lockedStore, task.workspaceId, task.areaId);
        }
        return lockedStore.update<TaskOccurrence>("task_occurrence", {
          ...task,
          updatedAt: now()
        });
      });
    },

    async deleteTaskOccurrence(workspaceId, taskId) {
      return store.withWorkspaceOperationalMutation(workspaceId, async (lockedStore) => {
        const task = await lockedStore.find<TaskOccurrence>("task_occurrence", workspaceId, taskId);
        if (!task || !isPendingTask(task)) return false;
        await lockedStore.delete("task_occurrence", workspaceId, taskId);
        return true;
      });
    }
  };
}

function routineOccurrenceKey(task: Pick<TaskOccurrence, "routineId" | "taskTemplateId" | "assigneeProfileId">) {
  return `${task.taskTemplateId ?? `${task.routineId ?? "manual"}__shared`}__${task.assigneeProfileId ?? "shared"}`;
}

function isPendingTask(task: TaskOccurrence) {
  return task.status === "pending" && task.submittedAt === null;
}

function sameRoutineOccurrence(left: TaskOccurrence, right: TaskOccurrence) {
  return left.origin === right.origin
    && left.routineId === right.routineId
    && left.taskTemplateId === right.taskTemplateId
    && left.title === right.title
    && left.areaNameSnapshot === right.areaNameSnapshot
    && left.routineTitleSnapshot === right.routineTitleSnapshot
    && left.stepTitleSnapshot === right.stepTitleSnapshot
    && left.routineRevisionSnapshot === right.routineRevisionSnapshot
    && left.areaId === right.areaId
    && left.processId === right.processId
    && left.assigneeProfileId === right.assigneeProfileId
    && left.dueHint === right.dueHint
    && left.approvalMode === right.approvalMode
    && left.evidencePolicy === right.evidencePolicy
    && left.status === right.status
    && left.dueDate === right.dueDate
    && JSON.stringify(left.checklistItems ?? []) === JSON.stringify(right.checklistItems ?? []);
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
