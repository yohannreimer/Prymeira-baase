import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { BaaseRuntimeConfig } from "../../config/runtime";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryAnnouncementRepository } from "./in-memory-announcement.repository";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "profile_owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "employee",
  "x-baase-profile-id": "profile_employee"
};

const accountBearer = (subject: string) => `Bearer header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;
const accountRuntimeConfig: BaaseRuntimeConfig = {
  mode: "production",
  auth: { mode: "account", accountApiUrl: "https://hub.example.test/api" },
  persistence: "memory",
  operationalStore: "jsonb",
  demoSeedEnabled: false,
  ai: { structured: "mock", transcription: "mock" },
  objectStorage: { provider: "memory", s3: null },
  ok: true,
  warnings: []
};

describe("announcement routes", () => {
  it("delivers area, role, and person announcements only to their operational members and keeps the author", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const announcementRepository = createInMemoryAnnouncementRepository();
    const area = await companyRepository.createArea({ workspaceId: "workspace_a", name: "Técnica", description: null });
    const role = await companyRepository.createRoleTemplate({ workspaceId: "workspace_a", areaId: area.id, name: "Especialista", description: null });
    const owner = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Yohann Reimer", email: "owner@example.test", role: "owner", areaId: null,
      areaAccessIds: [], roleTemplateId: null, accessScope: "workspace", clerkUserId: "user_owner", customerId: "customer_owner", createdByProfileId: "person_owner"
    });
    const areaMember = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Ana Técnica", email: "area@example.test", role: "employee", areaId: area.id,
      areaAccessIds: [area.id], roleTemplateId: null, accessScope: "area", clerkUserId: "user_area", customerId: "customer_area", createdByProfileId: owner.id
    });
    const roleMember = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Rui Especialista", email: "role@example.test", role: "employee", areaId: null,
      areaAccessIds: [], roleTemplateId: role.id, accessScope: "workspace", clerkUserId: "user_role", customerId: "customer_role", createdByProfileId: owner.id
    });
    const personMember = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Bia Pessoa", email: "person@example.test", role: "employee", areaId: null,
      areaAccessIds: [], roleTemplateId: null, accessScope: "workspace", clerkUserId: "user_person", customerId: "customer_person", createdByProfileId: owner.id
    });
    const users = {
      user_owner: { customerId: "customer_owner", email: owner.email!, name: owner.name, role: "owner" },
      user_area: { customerId: "customer_area", email: areaMember.email!, name: areaMember.name, role: "employee" },
      user_role: { customerId: "customer_role", email: roleMember.email!, name: roleMember.name, role: "employee" },
      user_person: { customerId: "customer_person", email: personMember.email!, name: personMember.name, role: "employee" }
    } as const;
    const subjectFromAuthorization = (authorization: string | null) => {
      const payload = authorization?.split(".")[1] ?? "";
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub as keyof typeof users;
    };
    const app = buildApp({
      runtimeConfig: accountRuntimeConfig,
      companyRepository,
      announcementRepository,
      accountAccessFetch: async (_input, init) => {
        const user = users[subjectFromAuthorization(new Headers(init?.headers).get("authorization"))];
        if (String(_input).endsWith("/me/products")) return new Response(JSON.stringify({ customer: { email: user.email, name: user.name } }));
        return new Response(JSON.stringify({
          allowed: true, workspace_id: "workspace_a", workspace_name: "Baase", workspace_role: user.role,
          product_key: "base", product_role: user.role, customer_id: user.customerId, customer_name: user.name, status: "active", reason: "active"
        }));
      }
    });

    async function createAndPublish(title: string, audience: Record<string, string>) {
      const created = await app.inject({
        method: "POST", url: "/announcements", headers: { authorization: accountBearer("user_owner") },
        payload: { title, body: title, type: "simple", requirement: "none", ...audience }
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().announcement.createdByProfileId).toBe(owner.id);
      await app.inject({ method: "POST", url: `/announcements/${created.json().announcement.id}/publish`, headers: { authorization: accountBearer("user_owner") } });
    }

    await createAndPublish("Somente Técnica", { audience_type: "area", area_id: area.id });
    await createAndPublish("Somente Especialista", { audience_type: "role", role_template_id: role.id });
    await createAndPublish("Somente Bia", { audience_type: "person", profile_id: personMember.id });

    for (const [subject, expectedTitle] of [["user_area", "Somente Técnica"], ["user_role", "Somente Especialista"], ["user_person", "Somente Bia"]] as const) {
      const response = await app.inject({ method: "GET", url: "/announcements", headers: { authorization: accountBearer(subject) } });
      expect(response.statusCode).toBe(200);
      expect(response.json().announcements.map((announcement: { title: string }) => announcement.title)).toEqual([expectedTitle]);
    }

    const today = await app.inject({ method: "GET", url: "/today?date=2026-07-07", headers: { authorization: accountBearer("user_area") } });
    expect(today.json().announcements.map((announcement: { title: string }) => announcement.title)).toEqual(["Somente Técnica"]);
  });

  it("applies access scope to Today announcements and preserves only manageable drafts on reload", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const announcementRepository = createInMemoryAnnouncementRepository();
    const [technicalArea, financialArea] = await Promise.all([
      companyRepository.createArea({ workspaceId: "workspace_a", name: "Técnica", description: null }),
      companyRepository.createArea({ workspaceId: "workspace_a", name: "Financeira", description: null })
    ]);
    const [technicalRole, financialRole] = await Promise.all([
      companyRepository.createRoleTemplate({ workspaceId: "workspace_a", areaId: technicalArea.id, name: "Técnico", description: null }),
      companyRepository.createRoleTemplate({ workspaceId: "workspace_a", areaId: financialArea.id, name: "Financeiro", description: null })
    ]);
    const owner = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Owner", email: "owner@example.test", role: "owner", areaId: null,
      areaAccessIds: [], roleTemplateId: null, accessScope: "workspace", clerkUserId: "user_owner", customerId: "customer_owner", createdByProfileId: "seed"
    });
    const manager = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Gestora técnica", email: "manager@example.test", role: "manager", areaId: technicalArea.id,
      areaAccessIds: [technicalArea.id], roleTemplateId: technicalRole.id, accessScope: "area", clerkUserId: "user_manager", customerId: "customer_manager", createdByProfileId: owner.id
    });
    const assignedOnly = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Pessoa técnica", email: "assigned@example.test", role: "employee", areaId: technicalArea.id,
      areaAccessIds: [technicalArea.id], roleTemplateId: technicalRole.id, accessScope: "assigned_only", clerkUserId: "user_assigned", customerId: "customer_assigned", createdByProfileId: owner.id
    });
    const financialPerson = await companyRepository.createTeamMember({
      workspaceId: "workspace_a", name: "Pessoa financeira", email: "financial@example.test", role: "employee", areaId: financialArea.id,
      areaAccessIds: [financialArea.id], roleTemplateId: financialRole.id, accessScope: "area", clerkUserId: "user_financial", customerId: "customer_financial", createdByProfileId: owner.id
    });
    const users = {
      user_owner: owner,
      user_manager: manager,
      user_assigned: assignedOnly,
      user_financial: financialPerson
    } as const;
    const app = buildApp({
      runtimeConfig: accountRuntimeConfig,
      companyRepository,
      announcementRepository,
      accountAccessFetch: async (_input, init) => {
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        const subject = JSON.parse(Buffer.from(authorization.split(".")[1]!, "base64url").toString("utf8")).sub as keyof typeof users;
        const user = users[subject];
        if (String(_input).endsWith("/me/products")) return new Response(JSON.stringify({ customer: { email: user.email, name: user.name } }));
        return new Response(JSON.stringify({
          allowed: true, workspace_id: "workspace_a", workspace_name: "Baase", workspace_role: user.role,
          product_key: "base", product_role: user.role, customer_id: user.customerId, customer_name: user.name, status: "active", reason: "active"
        }));
      }
    });
    const headersFor = (subject: keyof typeof users) => ({ authorization: accountBearer(subject) });
    const create = async (title: string, audience: Record<string, unknown>, subject: keyof typeof users = "user_owner") => {
      const response = await app.inject({
        method: "POST", url: "/announcements", headers: headersFor(subject),
        payload: { title, body: title, type: "simple", requirement: "none", ...audience }
      });
      return response;
    };
    const publish = async (response: Awaited<ReturnType<typeof create>>) => {
      await app.inject({ method: "POST", url: `/announcements/${response.json().announcement.id}/publish`, headers: headersFor("user_owner") });
    };

    await publish(await create("Para todos", { audience_type: "all" }));
    await publish(await create("Para a área", { audience_type: "area", area_id: technicalArea.id }));
    await publish(await create("Para o cargo", { audience_type: "role", role_template_id: technicalRole.id }));
    await publish(await create("Para a pessoa", { audience_type: "person", profile_id: assignedOnly.id }));
    await create("Rascunho técnico", { audience_type: "area", area_id: technicalArea.id }, "user_manager");
    const managerRoleDraft = await create("Rascunho por cargo", { audience_type: "role", role_template_id: technicalRole.id }, "user_manager");
    expect(managerRoleDraft.statusCode).toBe(201);
    const managerPersonDraft = await create("Rascunho por pessoa", { audience_type: "person", profile_id: assignedOnly.id }, "user_manager");
    expect(managerPersonDraft.statusCode).toBe(201);
    expect((await app.inject({
      method: "POST",
      url: `/announcements/${managerRoleDraft.json().announcement.id}/publish`,
      headers: headersFor("user_manager")
    })).statusCode).toBe(200);
    const financialDraft = await create("Rascunho financeiro", { audience_type: "area", area_id: financialArea.id });

    const today = await app.inject({ method: "GET", url: "/today?date=2026-07-12", headers: headersFor("user_assigned") });
    expect(today.statusCode).toBe(200);
    expect(today.json().announcements.map((announcement: { title: string }) => announcement.title)).toEqual([
      "Para todos",
      "Para a área",
      "Para o cargo",
      "Para a pessoa",
      "Rascunho por cargo"
    ]);

    const managerList = await app.inject({ method: "GET", url: "/announcements", headers: headersFor("user_manager") });
    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().announcements.map((announcement: { title: string }) => announcement.title)).toContain("Rascunho técnico");
    expect(managerList.json().announcements.map((announcement: { title: string }) => announcement.title)).not.toContain("Rascunho financeiro");
    expect((await app.inject({
      method: "POST",
      url: `/announcements/${financialDraft.json().announcement.id}/publish`,
      headers: headersFor("user_manager")
    })).statusCode).toBe(403);

    for (const audience of [
      { audience_type: "all" },
      { audience_type: "area", area_id: financialArea.id },
      { audience_type: "role", role_template_id: financialRole.id },
      { audience_type: "person", profile_id: financialPerson.id }
    ]) {
      const response = await create("Fora do escopo", audience, "user_manager");
      expect(response.statusCode).toBe(403);
    }

    expect((await create("Sem id de área", { audience_type: "area" })).statusCode).toBe(400);
    const missingRole = await create("Cargo inexistente", { audience_type: "role", role_template_id: "role_missing" });
    expect(missingRole.statusCode).toBe(422);
    expect(missingRole.json().error.code).toBe("ANNOUNCEMENT_AUDIENCE_ROLE_NOT_FOUND");
    const foreignPerson = await create("Pessoa de outro workspace", { audience_type: "person", profile_id: "person_missing" });
    expect(foreignPerson.statusCode).toBe(422);
    expect(foreignPerson.json().error.code).toBe("ANNOUNCEMENT_AUDIENCE_PERSON_NOT_FOUND");
  });

  it("creates, publishes, lists, and confirms an announcement", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Novo fluxo de aprovação",
        body: "Toda peça precisa passar pelo gestor antes de ir ao cliente.",
        type: "process_change",
        requirement: "read_confirmation",
        audience_type: "all",
        related_process_id: "process_1"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const announcement = createResponse.json().announcement;
    expect(announcement).toMatchObject({
      title: "Novo fluxo de aprovação",
      status: "draft",
      requirement: "read_confirmation",
      audience: { type: "all" }
    });

    const publishResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/publish`,
      headers: ownerHeaders
    });
    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().announcement.status).toBe("published");

    const employeeListResponse = await app.inject({
      method: "GET",
      url: "/announcements",
      headers: employeeHeaders
    });
    expect(employeeListResponse.statusCode).toBe(200);
    expect(employeeListResponse.json().announcements).toEqual([
      expect.objectContaining({
        id: announcement.id,
        status: "published",
        receipt: expect.objectContaining({
          profileId: "profile_employee",
          status: "pending"
        })
      })
    ]);

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders
    });
    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json().receipt).toMatchObject({
      announcementId: announcement.id,
      profileId: "profile_employee",
      status: "confirmed"
    });

    const receiptsResponse = await app.inject({
      method: "GET",
      url: `/announcement-receipts?announcement_id=${announcement.id}`,
      headers: ownerHeaders
    });
    expect(receiptsResponse.statusCode).toBe(200);
    expect(receiptsResponse.json().receipts).toEqual([
      expect.objectContaining({
        announcementId: announcement.id,
        profileId: "profile_employee",
        status: "confirmed"
      })
    ]);
  });

  it("requires a passing quiz answer when confirmation uses quiz", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Mudança no atendimento",
        body: "A partir de hoje o primeiro retorno deve acontecer em até 15 minutos.",
        type: "simple",
        requirement: "quiz_confirmation",
        audience_type: "all",
        quiz_questions: [
          {
            prompt: "Qual é o prazo do primeiro retorno?",
            options: [
              { id: "a", label: "15 minutos" },
              { id: "b", label: "2 dias" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });
    const announcement = createResponse.json().announcement;
    await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/publish`,
      headers: ownerHeaders
    });

    const wrongResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders,
      payload: {
        answers: [{ question_id: announcement.quizQuestions[0].id, option_id: "b" }]
      }
    });
    const correctResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders,
      payload: {
        answers: [{ question_id: announcement.quizQuestions[0].id, option_id: "a" }]
      }
    });

    expect(wrongResponse.statusCode).toBe(200);
    expect(wrongResponse.json().receipt).toMatchObject({
      status: "pending",
      quizScore: 0,
      passed: false
    });
    expect(correctResponse.statusCode).toBe(200);
    expect(correctResponse.json().receipt).toMatchObject({
      status: "quiz_completed",
      quizScore: 100,
      passed: true
    });
  });

  it("rejects announcement creation for employees", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: employeeHeaders,
      payload: {
        title: "Comunicado indevido",
        body: "Funcionário não pode publicar.",
        type: "simple",
        requirement: "read_confirmation",
        audience_type: "all"
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("deletes announcements and their receipts", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Mudança no processo comercial",
        body: "Registrar toda oportunidade no sistema.",
        type: "process_change",
        requirement: "read_confirmation",
        audience_type: "all"
      }
    });
    const announcement = createResponse.json().announcement;

    await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/publish`,
      headers: ownerHeaders
    });
    await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/announcements/${announcement.id}`,
      headers: ownerHeaders
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    const listResponse = await app.inject({
      method: "GET",
      url: "/announcements",
      headers: ownerHeaders
    });
    const receiptsResponse = await app.inject({
      method: "GET",
      url: `/announcement-receipts?announcement_id=${announcement.id}`,
      headers: ownerHeaders
    });

    expect(listResponse.json().announcements).toEqual([]);
    expect(receiptsResponse.json().receipts).toEqual([]);
  });
});
