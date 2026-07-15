import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { BaaseRuntimeConfig } from "../../config/runtime";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { curatedTemplates } from "./template-library";
import type { RoutineTemplate } from "./template.types";

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

const accountBearer = (subject: string) => `Bearer header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;

const operationalRuntimeConfig: BaaseRuntimeConfig = {
  mode: "production",
  auth: { mode: "account", accountApiUrl: "https://hub.prymeiradigital.com.br/api" },
  persistence: "postgres",
  operationalStore: "jsonb",
  demoSeedEnabled: false,
  ai: { structured: "openai", transcription: "deepgram" },
  objectStorage: { provider: "memory", s3: null },
  studio: {
    enabled: false,
    vectorConfigured: false,
    aiModel: "gpt-5.6-terra",
    embeddingModel: "text-embedding-3-small"
  },
  ok: true,
  warnings: []
};

async function buildOperationalTemplateApp() {
  const companyRepository = createInMemoryCompanyRepository();
  const members = [
    { id: "profile_owner", name: "Owner", email: "owner@example.com", role: "owner" as const, areaId: null, areaAccessIds: [], accessScope: "workspace" as const },
    { id: "profile_gestor_financeiro", name: "Gestor Financeiro", email: "financeiro@example.com", role: "manager" as const, areaId: "area_financeiro", areaAccessIds: ["area_financeiro"], accessScope: "area" as const }
  ];

  for (const member of members) {
    await companyRepository.createTeamMember({
      workspaceId: "workspace_a",
      name: member.name,
      email: member.email,
      role: member.role,
      areaId: member.areaId,
      areaAccessIds: member.areaAccessIds,
      accessScope: member.accessScope,
      roleTemplateId: null,
      clerkUserId: member.id,
      customerId: `customer_${member.id}`,
      createdByProfileId: "profile_owner"
    });
  }

  const app = buildApp({
    companyRepository,
    runtimeConfig: operationalRuntimeConfig,
    accountAccessFetch: async (input, init) => {
      const authorization = new Headers(init?.headers).get("authorization")!;
      const token = authorization.slice("Bearer ".length);
      const [, payload] = token.split(".");
      const subject = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")).sub as string;
      const member = members.find((candidate) => candidate.id === subject)!;

      if (String(input).endsWith("/me/products")) {
        return new Response(JSON.stringify({ customer: { email: member.email, name: member.name } }), { status: 200 });
      }

      return new Response(JSON.stringify({
        allowed: true,
        workspace_id: "workspace_a",
        workspace_name: "Workspace A",
        workspace_role: member.role,
        product_key: "base",
        product_role: member.role,
        customer_id: `customer_${member.id}`,
        customer_name: member.name,
        status: "active",
        reason: "active_entitlement"
      }), { status: 200 });
    }
  });

  return { app, headersFor: (profileId: string) => ({ authorization: accountBearer(profileId) }) };
}

describe("template routes", () => {
  it("keeps unscoped routine templates owner-only and permits area-scoped routine templates", async () => {
    const { app, headersFor } = await buildOperationalTemplateApp();
    const scopedTemplate: RoutineTemplate = {
      id: "routine_finance_scoped_test",
      title: "Rotina Financeira",
      description: "Rotina de teste para Financeiro.",
      segment: "general_ops",
      area: "Financeiro",
      kind: "routine",
      category: "Financeiro",
      tag: "Teste",
      icon: "ph-wallet",
      suggestedUse: "Teste de escopo.",
      adaptPrompt: "Teste de escopo.",
      content: {
        title: "Rotina Financeira",
        areaId: "area_financeiro",
        taskTemplates: [{ title: "Conferir saldo" }]
      }
    };
    curatedTemplates.push(scopedTemplate);

    try {
      const financeUnscoped = await app.inject({
        method: "POST",
        url: "/templates/routine_daily_social/use",
        headers: headersFor("profile_gestor_financeiro")
      });
      const ownerUnscoped = await app.inject({
        method: "POST",
        url: "/templates/routine_daily_social/use",
        headers: headersFor("profile_owner")
      });
      const financeScoped = await app.inject({
        method: "POST",
        url: `/templates/${scopedTemplate.id}/use`,
        headers: headersFor("profile_gestor_financeiro")
      });

      expect(financeUnscoped.statusCode).toBe(403);
      expect(financeUnscoped.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
      expect(financeUnscoped.json()).not.toHaveProperty("routine");
      expect(ownerUnscoped.statusCode).toBe(201);
      expect(ownerUnscoped.json().routine.areaId).toBeNull();
      expect(financeScoped.statusCode).toBe(201);
      expect(financeScoped.json().routine.areaId).toBe("area_financeiro");
    } finally {
      curatedTemplates.splice(curatedTemplates.findIndex((template) => template.id === scopedTemplate.id), 1);
    }
  });

  it("lists templates filtered by segment, area and kind", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/templates?segment=marketing_agency&area=Atendimento&kind=process",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().templates).toEqual([
      expect.objectContaining({
        id: "process_client_onboarding",
        kind: "process",
        segment: "marketing_agency",
        area: "Atendimento",
        title: "Onboarding de cliente novo"
      })
    ]);
    expect(response.json().filters).toMatchObject({
      segments: expect.arrayContaining(["marketing_agency"]),
      areas: expect.arrayContaining(["Atendimento"]),
      kinds: ["process", "routine", "training"]
    });
  });

  it("uses process, routine and training templates to create real operational content", async () => {
    const app = buildApp();

    const processResponse = await app.inject({
      method: "POST",
      url: "/templates/process_client_onboarding/use",
      headers: ownerHeaders
    });
    const routineResponse = await app.inject({
      method: "POST",
      url: "/templates/routine_daily_social/use",
      headers: ownerHeaders
    });
    const trainingResponse = await app.inject({
      method: "POST",
      url: "/templates/training_evidence_standard/use",
      headers: ownerHeaders
    });

    expect(processResponse.statusCode).toBe(201);
    expect(processResponse.json()).toMatchObject({
      kind: "process",
      process: {
        title: "Onboarding de cliente novo",
        status: "draft",
        currentVersion: {
          body: expect.stringContaining("Coletar acessos")
        }
      }
    });
    expect(routineResponse.statusCode).toBe(201);
    expect(routineResponse.json()).toMatchObject({
      kind: "routine",
      routine: {
        title: "Abertura do dia — Social",
        status: "active"
      }
    });
    expect(routineResponse.json().routine.taskTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Conferir calendário editorial" })
      ])
    );
    expect(trainingResponse.statusCode).toBe(201);
    expect(trainingResponse.json()).toMatchObject({
      kind: "training",
      training: {
        title: "Como registrar evidências",
        status: "draft"
      }
    });
    expect(trainingResponse.json().training.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "lesson", title: "Aula curta" })
      ])
    );
    expect(trainingResponse.json().training.quizQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prompt: expect.stringContaining("evidência") })
      ])
    );
  });

  it("blocks employees from using templates", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/templates/process_client_onboarding/use",
      headers: employeeHeaders
    });

    expect(response.statusCode).toBe(403);
  });
});
