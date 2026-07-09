import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { BaaseRuntimeConfig } from "./config/runtime";
import { createInMemoryCompanyRepository } from "./modules/company/in-memory-company.repository";

describe("Baase API app", () => {
  it("responds to health checks", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "baase-api",
      product_key: "base"
    });
  });

  it("reports runtime readiness for real pilot checks", async () => {
    const runtimeConfig: BaaseRuntimeConfig = {
      mode: "pilot",
      auth: {
        mode: "local",
        accountApiUrl: null
      },
      persistence: "postgres",
      demoSeedEnabled: false,
      ai: {
        structured: "openai",
        transcription: "deepgram"
      },
      ok: true,
      warnings: []
    };
    const app = buildApp({ runtimeConfig });
    const response = await app.inject({ method: "GET", url: "/readiness" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "baase-api",
      mode: "pilot",
      auth: {
        mode: "local",
        account_api_configured: false
      },
      persistence: "postgres",
      demo_seed_enabled: false,
      ai: {
        structured: "openai",
        transcription: "deepgram"
      },
      warnings: []
    });
  });

  it("resolves the current operational profile from request context", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: {
        "x-baase-workspace-id": "workspace_a",
        "x-baase-profile-id": "profile_manager",
        "x-baase-role": "manager"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspace: {
        id: "workspace_a",
        name: "Estúdio Norte"
      },
      profile: {
        id: "profile_manager",
        role: "manager",
        display_name: "Rafael Nunes",
        initials: "RN",
        area_name: "Criação"
      },
      home_route: "/gestor"
    });
  });

  it("uses Account Hub access decisions as the production request context", async () => {
    const accountRequests: Array<{ url: string; authorization: string | null }> = [];
    const runtimeConfig: BaaseRuntimeConfig = {
      mode: "production",
      auth: {
        mode: "account",
        accountApiUrl: "https://hub.prymeiradigital.com.br/api"
      },
      persistence: "postgres",
      demoSeedEnabled: false,
      ai: {
        structured: "openai",
        transcription: "deepgram"
      },
      ok: true,
      warnings: []
    };
    const app = buildApp({
      runtimeConfig,
      accountAccessFetch: async (input, init) => {
        accountRequests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization")
        });
        return new Response(JSON.stringify({
          allowed: true,
          workspace_id: "hub_workspace",
          workspace_role: "owner",
          product_key: "base",
          product_role: "admin",
          status: "active",
          reason: "active_entitlement"
        }), { status: 200 });
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: {
        authorization: "Bearer clerk-token",
        "x-baase-workspace-id": "spoofed_workspace",
        "x-baase-profile-id": "spoofed_profile",
        "x-baase-role": "employee"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(accountRequests).toEqual([{
      url: "https://hub.prymeiradigital.com.br/api/access-check?product_key=base",
      authorization: "Bearer clerk-token"
    }]);
    expect(response.json()).toMatchObject({
      workspace: {
        id: "hub_workspace"
      },
      profile: {
        id: "account_admin",
        role: "owner"
      },
      home_route: "/painel"
    });
  });

  it("denies private routes when Account Hub denies Baase access", async () => {
    const runtimeConfig: BaaseRuntimeConfig = {
      mode: "production",
      auth: {
        mode: "account",
        accountApiUrl: "https://hub.prymeiradigital.com.br/api"
      },
      persistence: "postgres",
      demoSeedEnabled: false,
      ai: {
        structured: "openai",
        transcription: "deepgram"
      },
      ok: true,
      warnings: []
    };
    const app = buildApp({
      runtimeConfig,
      accountAccessFetch: async () => new Response(JSON.stringify({
        allowed: false,
        product_key: "base",
        status: "locked",
        reason: "no_entitlement",
        upgrade_url: "https://hub.prymeiradigital.com.br/planos?product_key=base"
      }), { status: 200 })
    });

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: {
        authorization: "Bearer clerk-token"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "PRODUCT_ACCESS_DENIED",
        message: "Acesso ao Baase não liberado para este usuário.",
        details: {
          product_key: "base",
          reason: "no_entitlement",
          upgrade_url: "https://hub.prymeiradigital.com.br/planos?product_key=base"
        }
      }
    });
  });

  it("uses the onboarding company name as the workspace name after setup", async () => {
    const app = buildApp();
    const headers = {
      "x-baase-workspace-id": "workspace_a",
      "x-baase-profile-id": "profile_owner",
      "x-baase-role": "owner"
    };

    await app.inject({
      method: "POST",
      url: "/onboarding/session",
      headers,
      payload: { current_step: "identity" }
    });
    await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers,
      payload: {
        company_name: "Holand",
        segment: "Outro",
        custom_segment: "Software CAD/CAM",
        normalized_segment: "Software CAD/CAM"
      }
    });

    const response = await app.inject({ method: "GET", url: "/me", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().workspace).toMatchObject({
      id: "workspace_a",
      name: "Holand"
    });
  });

  it("uses the real owner team member as the owner profile when one exists", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const app = buildApp({ companyRepository });
    const headers = {
      "x-baase-workspace-id": "workspace_a",
      "x-baase-profile-id": "profile_owner",
      "x-baase-role": "owner"
    };
    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers,
      payload: { name: "Financeiro e Administrativo" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Responsável Financeiro e Administrativo"
      }
    });
    await app.inject({
      method: "POST",
      url: "/people",
      headers,
      payload: {
        name: "Yohann Reimer",
        email: "yohann@holand.com.br",
        role: "owner",
        area_id: areaResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id
      }
    });

    const response = await app.inject({ method: "GET", url: "/me", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile).toMatchObject({
      id: "profile_owner",
      role: "owner",
      display_name: "Yohann Reimer",
      initials: "YR",
      area_name: "Financeiro e Administrativo"
    });
  });

  it("can boot the local server with demo operational data", async () => {
    const app = buildApp({ seedDemoData: true });
    const headers = {
      "x-baase-workspace-id": "workspace_a",
      "x-baase-profile-id": "profile_employee",
      "x-baase-role": "employee"
    };

    const todayResponse = await app.inject({ method: "GET", url: "/today?date=2026-07-07", headers });
    const processesResponse = await app.inject({ method: "GET", url: "/processes", headers });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks).toHaveLength(4);
    expect(processesResponse.statusCode).toBe(200);
    expect(processesResponse.json().processes[0]).toMatchObject({
      title: "Onboarding de cliente novo",
      status: "published"
    });
  });

  it("creates and lists workspace invites for onboarding employees", async () => {
    const app = buildApp();
    const headers = {
      "x-baase-workspace-id": "workspace_a",
      "x-baase-profile-id": "profile_owner",
      "x-baase-role": "owner"
    };

    const createResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers,
      payload: {
        name: "Bianca Ramos",
        email: "bianca@estudionorte.com",
        role: "employee",
        area_id: "area_criacao"
      }
    });
    const listResponse = await app.inject({ method: "GET", url: "/invites", headers });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().invite).toMatchObject({
      name: "Bianca Ramos",
      role: "employee",
      status: "pending"
    });
    expect(createResponse.json().invite.code).toMatch(/^BAASE-/);
    expect(listResponse.json().invites).toHaveLength(1);
  });

  it("publishes trainings created after local demo seed data", async () => {
    const app = buildApp({ seedDemoData: true });
    const headers = {
      "x-baase-workspace-id": "workspace_a",
      "x-baase-profile-id": "profile_owner",
      "x-baase-role": "owner"
    };

    const createResponse = await app.inject({
      method: "POST",
      url: "/trainings",
      headers,
      payload: {
        title: "Treinamento novo",
        description: "Teste com seed.",
        materials: [{ kind: "lesson", title: "Aula curta", body: "Conteudo", url: null }],
        quiz_questions: []
      }
    });
    const trainingId = createResponse.json().training.id;
    const publishResponse = await app.inject({
      method: "POST",
      url: `/trainings/${trainingId}/publish`,
      headers
    });

    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().training.status).toBe("published");
  });

  it("returns training and announcement pendencies in the employee Today inbox", async () => {
    const app = buildApp();
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

    const trainingResponse = await app.inject({
      method: "POST",
      url: "/trainings",
      headers: ownerHeaders,
      payload: {
        title: "Atendimento em 15 minutos",
        materials: [{ kind: "lesson", title: "Aula curta", body: "Responda rápido." }],
        quiz_questions: [
          {
            prompt: "Qual é o prazo?",
            options: [
              { id: "a", label: "15 minutos" },
              { id: "b", label: "2 dias" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });
    const trainingId = trainingResponse.json().training.id;
    await app.inject({ method: "POST", url: `/trainings/${trainingId}/publish`, headers: ownerHeaders });
    await app.inject({
      method: "POST",
      url: `/trainings/${trainingId}/assignments`,
      headers: ownerHeaders,
      payload: { audience_type: "all", due_date: "2026-07-10" }
    });

    const announcementResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Novo padrão de atendimento",
        body: "Confirme que entendeu o prazo de primeiro retorno.",
        type: "simple",
        requirement: "read_confirmation",
        audience_type: "all"
      }
    });
    const announcementId = announcementResponse.json().announcement.id;
    await app.inject({ method: "POST", url: `/announcements/${announcementId}/publish`, headers: ownerHeaders });

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json()).toMatchObject({
      tasks: expect.any(Array),
      training_assignments: [
        expect.objectContaining({
          trainingId,
          profileId: "profile_employee",
          status: "pending",
          training: expect.objectContaining({ title: "Atendimento em 15 minutos" })
        })
      ],
      announcements: [
        expect.objectContaining({
          id: announcementId,
          title: "Novo padrão de atendimento",
          receipt: expect.objectContaining({ status: "pending" })
        })
      ]
    });
  });
});
