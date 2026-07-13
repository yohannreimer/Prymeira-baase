import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { BaaseRuntimeConfig } from "../../config/runtime";
import { createInMemoryAnnouncementRepository } from "../announcements/in-memory-announcement.repository";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";

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

describe("dashboard routes", () => {
  it("summarizes real operational metrics for owner and manager panels", async () => {
    const app = buildApp({ seedDemoData: true });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?date=2026-07-07",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date: "2026-07-07",
      role: "owner",
      metrics: {
        todayTotal: 4,
        todayCompleted: 1,
        executionRate: 25,
        awaitingApproval: 0,
        lateTasks: 0,
        incompleteProcesses: 1
      }
    });
    expect(response.json().areaMetrics).toEqual([
      expect.objectContaining({
        name: "Criacao",
        total: 4,
        completed: 1,
        completionRate: 25
      })
    ]);
    expect(response.json().attentionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "draft_process_process_4",
          title: "Processo \"Conciliacao financeira\" incompleto",
          targetScreen: "processos"
        })
      ])
    );
  });

  it("returns an employee Today summary scoped to assigned work", async () => {
    const app = buildApp({ seedDemoData: true });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      role: "employee",
      employeeToday: {
        total: 4,
        completed: 1,
        pending: 3,
        awaitingApproval: 0,
        late: 0
      }
    });
  });

  it("returns authorized operational oversight metrics scoped to the manager area", async () => {
    const fixture = await buildOperationalOverviewApp();

    const owner = await fixture.app.inject({
      method: "GET",
      url: "/operational-overview?from=2026-07-01&to=2026-07-31",
      headers: fixture.headersFor("profile_owner")
    });

    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(owner.json().lateTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ assigneeProfileId: fixture.people.tech.id, daysLate: 2 })
    ]));
    expect(owner.json().awaitingApprovals).toEqual(expect.arrayContaining([
      expect.objectContaining({ assigneeProfileId: fixture.people.tech.id, title: "Aprovar checklist" })
    ]));
    expect(owner.json().pendingRequiredAnnouncements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.announcementId, profileId: fixture.people.tech.id })
    ]));
    expect(owner.json().trends.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: fixture.people.tech.id, completionOnTimeRate: 50, averageApprovalDurationHours: 19.25 })
    ]));

    const manager = await fixture.app.inject({
      method: "GET",
      url: "/operational-overview?from=2026-07-01&to=2026-07-31",
      headers: fixture.headersFor("profile_manager")
    });

    expect(manager.statusCode).toBe(200);
    expect(manager.json().lateTasks).toEqual([expect.objectContaining({ areaId: fixture.areas.tech.id })]);
    expect(manager.json().lateTasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Atribuição externa do gestor" })
    ]));
    expect(manager.json().awaitingApprovals).toEqual([expect.objectContaining({ areaId: fixture.areas.tech.id })]);
    expect(manager.json().pendingRequiredAnnouncements).toEqual([expect.objectContaining({ profileId: fixture.people.tech.id })]);
    expect(manager.json().trends.people).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: fixture.people.finance.id })
    ]));

    const employee = await fixture.app.inject({
      method: "GET",
      url: "/operational-overview?from=2026-07-01&to=2026-07-31",
      headers: fixture.headersFor("profile_tech")
    });
    expect(employee.statusCode).toBe(403);
  });

  it("uses completion dates in the São Paulo operational period and excludes completed announcement receipts", async () => {
    const fixture = await buildOperationalOverviewApp();

    const response = await fixture.app.inject({
      method: "GET",
      url: "/operational-overview?from=2026-07-30&to=2026-07-30",
      headers: fixture.headersFor("profile_owner")
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().trends.people).toEqual(expect.arrayContaining([
      expect.objectContaining({
        profileId: fixture.people.tech.id,
        completionOnTimeRate: 50
      })
    ]));
    expect(response.json().pendingRequiredAnnouncements).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Leitura já confirmada" })
    ]));
    expect(response.json().pendingRequiredAnnouncements).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Quiz já concluído" })
    ]));
  });

  it("calculates days late using the injected São Paulo date", async () => {
    const fixture = await buildOperationalOverviewApp({ now: () => new Date("2026-07-12T02:30:00.000Z") });

    const response = await fixture.app.inject({
      method: "GET",
      url: "/operational-overview?from=2026-07-01&to=2026-07-31",
      headers: fixture.headersFor("profile_owner")
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().lateTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Tarefa atrasada", daysLate: 1 })
    ]));
  });

  it("rejects invalid operational overview periods", async () => {
    const fixture = await buildOperationalOverviewApp();
    const response = await fixture.app.inject({
      method: "GET",
      url: "/operational-overview?from=2026-07-31&to=2026-07-01",
      headers: fixture.headersFor("profile_owner")
    });

    expect(response.statusCode).toBe(400);
  });
});

const accountBearer = (subject: string) => `Bearer header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;

const operationalRuntimeConfig: BaaseRuntimeConfig = {
  mode: "production",
  auth: { mode: "account", accountApiUrl: "https://hub.prymeiradigital.com.br/api" },
  persistence: "postgres",
  operationalStore: "jsonb",
  demoSeedEnabled: false,
  ai: { structured: "openai", transcription: "deepgram" },
  objectStorage: { provider: "memory", s3: null },
  ok: true,
  warnings: []
};

async function buildOperationalOverviewApp(options: { now?: () => Date } = {}) {
  const companyRepository = createInMemoryCompanyRepository();
  const routineRepository = createInMemoryRoutineRepository();
  const announcementRepository = createInMemoryAnnouncementRepository();
  const workspaceId = "workspace_a";
  const [techArea, financeArea] = await Promise.all([
    companyRepository.createArea({ workspaceId, name: "Técnica", description: null }),
    companyRepository.createArea({ workspaceId, name: "Financeiro", description: null })
  ]);
  const profiles = [
    { id: "profile_owner", name: "Dono", email: "owner@example.com", role: "owner" as const, areaId: null, areaAccessIds: [], accessScope: "workspace" as const },
    { id: "profile_manager", name: "Gestor técnico", email: "manager@example.com", role: "manager" as const, areaId: null, areaAccessIds: [techArea.id], accessScope: "area" as const },
    { id: "profile_tech", name: "Técnica", email: "tech@example.com", role: "employee" as const, areaId: techArea.id, areaAccessIds: [], accessScope: "assigned_only" as const },
    { id: "profile_finance", name: "Financeiro", email: "finance@example.com", role: "employee" as const, areaId: financeArea.id, areaAccessIds: [], accessScope: "assigned_only" as const }
  ];
  const people = new Map<string, Awaited<ReturnType<typeof companyRepository.createTeamMember>>>();
  for (const profile of profiles) {
    people.set(profile.id, await companyRepository.createTeamMember({
      workspaceId,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      areaId: profile.areaId,
      areaAccessIds: profile.areaAccessIds,
      accessScope: profile.accessScope,
      roleTemplateId: null,
      clerkUserId: profile.id,
      customerId: `customer_${profile.id}`,
      createdByProfileId: "profile_owner"
    }));
  }
  const tech = people.get("profile_tech")!;
  const finance = people.get("profile_finance")!;
  const task = (input: Parameters<typeof routineRepository.createTaskOccurrence>[0]) => routineRepository.createTaskOccurrence(input);
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Tarefa atrasada", areaId: techArea.id, processId: null, assigneeProfileId: tech.id, approvalMode: "direct", evidencePolicy: "optional", status: "pending", dueDate: "2026-07-10", evidence: null, submittedByProfileId: null, submittedAt: null, reviewedByProfileId: null, reviewedAt: null, reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Aprovar checklist", areaId: techArea.id, processId: null, assigneeProfileId: tech.id, approvalMode: "approval_required", evidencePolicy: "optional", status: "awaiting_approval", dueDate: "2026-07-20", evidence: null, submittedByProfileId: tech.id, submittedAt: "2026-07-18T09:00:00.000Z", reviewedByProfileId: null, reviewedAt: null, reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "No prazo", areaId: techArea.id, processId: null, assigneeProfileId: tech.id, approvalMode: "approval_required", evidencePolicy: "optional", status: "completed", dueDate: "2026-07-21", evidence: null, submittedByProfileId: tech.id, submittedAt: "2026-07-20T10:00:00.000Z", reviewedByProfileId: people.get("profile_manager")!.id, reviewedAt: "2026-07-21T10:00:00.000Z", reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Fora do prazo", areaId: techArea.id, processId: null, assigneeProfileId: tech.id, approvalMode: "direct", evidencePolicy: "optional", status: "completed", dueDate: "2026-07-21", evidence: null, submittedByProfileId: tech.id, submittedAt: "2026-07-22T10:00:00.000Z", reviewedByProfileId: null, reviewedAt: null, reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Financeiro externo", areaId: financeArea.id, processId: null, assigneeProfileId: finance.id, approvalMode: "direct", evidencePolicy: "optional", status: "pending", dueDate: "2026-07-10", evidence: null, submittedByProfileId: null, submittedAt: null, reviewedByProfileId: null, reviewedAt: null, reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Atribuição externa do gestor", areaId: financeArea.id, processId: null, assigneeProfileId: people.get("profile_manager")!.id, approvalMode: "direct", evidencePolicy: "optional", status: "pending", dueDate: "2026-07-10", evidence: null, submittedByProfileId: null, submittedAt: null, reviewedByProfileId: null, reviewedAt: null, reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Concluída após vencimento fora do período", areaId: techArea.id, processId: null, assigneeProfileId: tech.id, approvalMode: "direct", evidencePolicy: "optional", status: "completed", dueDate: "2026-07-29", evidence: null, submittedByProfileId: tech.id, submittedAt: "2026-07-30T12:00:00.000Z", reviewedByProfileId: null, reviewedAt: null, reviewComment: null });
  await task({ workspaceId, origin: "manual", routineId: null, taskTemplateId: null, title: "Concluída no limite de fuso", areaId: techArea.id, processId: null, assigneeProfileId: tech.id, approvalMode: "approval_required", evidencePolicy: "optional", status: "completed", dueDate: "2026-07-30", evidence: null, submittedByProfileId: tech.id, submittedAt: "2026-07-30T12:00:00.000Z", reviewedByProfileId: people.get("profile_manager")!.id, reviewedAt: "2026-07-31T02:30:00.000Z", reviewComment: null });

  const announcement = await announcementRepository.createAnnouncement({ workspaceId, title: "Leitura obrigatória", body: "Leia.", type: "simple", status: "published", requirement: "read_confirmation", audience: { type: "area", areaId: techArea.id }, relatedProcessId: null, relatedTrainingId: null, quizQuestions: [], createdByProfileId: people.get("profile_owner")!.id, publishedAt: "2026-07-01T08:00:00.000Z", archivedAt: null });
  await announcementRepository.upsertAnnouncementReceipt({ workspaceId, announcementId: announcement.id, profileId: tech.id, status: "pending", quizScore: null, passed: null, answers: [], readAt: "2026-07-01T09:00:00.000Z", confirmedAt: null, quizCompletedAt: null });
  const confirmedAnnouncement = await announcementRepository.createAnnouncement({ workspaceId, title: "Leitura já confirmada", body: "Leia.", type: "simple", status: "published", requirement: "read_confirmation", audience: { type: "person", profileId: tech.id }, relatedProcessId: null, relatedTrainingId: null, quizQuestions: [], createdByProfileId: people.get("profile_owner")!.id, publishedAt: "2026-07-01T08:00:00.000Z", archivedAt: null });
  await announcementRepository.upsertAnnouncementReceipt({ workspaceId, announcementId: confirmedAnnouncement.id, profileId: tech.id, status: "confirmed", quizScore: null, passed: null, answers: [], readAt: "2026-07-01T09:00:00.000Z", confirmedAt: "2026-07-01T09:01:00.000Z", quizCompletedAt: null });
  const completedQuizAnnouncement = await announcementRepository.createAnnouncement({ workspaceId, title: "Quiz já concluído", body: "Responda.", type: "simple", status: "published", requirement: "quiz_confirmation", audience: { type: "person", profileId: tech.id }, relatedProcessId: null, relatedTrainingId: null, quizQuestions: [], createdByProfileId: people.get("profile_owner")!.id, publishedAt: "2026-07-01T08:00:00.000Z", archivedAt: null });
  await announcementRepository.upsertAnnouncementReceipt({ workspaceId, announcementId: completedQuizAnnouncement.id, profileId: tech.id, status: "quiz_completed", quizScore: 100, passed: true, answers: [], readAt: "2026-07-01T09:00:00.000Z", confirmedAt: null, quizCompletedAt: "2026-07-01T09:01:00.000Z" });

  const app = buildApp({
    companyRepository,
    routineRepository,
    announcementRepository,
    runtimeConfig: operationalRuntimeConfig,
    now: options.now ?? (() => new Date("2026-07-12T15:00:00.000Z")),
    accountAccessFetch: async (input, init) => {
      const authorization = new Headers(init?.headers).get("authorization")!;
      const token = authorization.slice("Bearer ".length);
      const [, payload] = token.split(".");
      const profile = profiles.find((candidate) => candidate.id === JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")).sub)!;
      if (String(input).endsWith("/me/products")) return new Response(JSON.stringify({ customer: { email: profile.email, name: profile.name } }), { status: 200 });
      return new Response(JSON.stringify({ allowed: true, workspace_id: workspaceId, product_key: "base", product_role: profile.role, customer_id: `customer_${profile.id}`, customer_name: profile.name, status: "active", reason: "active_entitlement" }), { status: 200 });
    }
  });

  return {
    app,
    headersFor: (profileId: string) => ({ authorization: accountBearer(profileId) }),
    areas: { tech: techArea, finance: financeArea },
    people: { tech, finance },
    announcementId: announcement.id
  };
}
