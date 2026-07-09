import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";

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

const setupPayload = {
  segment: "Agência de marketing",
  areas: [
    { name: "Atendimento", description: "Entrada e relacionamento com clientes." },
    { name: "Criação", description: "Produção e revisão de entregáveis." }
  ],
  roles: [
    { area_name: "Atendimento", name: "Gestor de atendimento", description: "Garante ritmo e qualidade." },
    { area_name: "Criação", name: "Designer", description: "Executa criativos e revisões." }
  ],
  people: [
    {
      name: "Marina Alves",
      email: "marina@estudionorte.com",
      role: "manager",
      area_name: "Atendimento",
      role_name: "Gestor de atendimento"
    },
    {
      name: "Bruno Costa",
      email: "bruno@estudionorte.com",
      role: "employee",
      area_name: "Criação",
      role_name: "Designer"
    }
  ],
  processes: [
    {
      title: "Onboarding de cliente novo",
      summary: "Como iniciar uma conta sem depender da memória do dono.",
      body: "1. Registrar fechamento. 2. Coletar acessos. 3. Criar pasta e board. 4. Fazer kickoff interno.",
      area_name: "Atendimento"
    }
  ],
  routines: [
    {
      title: "Abertura do dia",
      area_name: "Atendimento",
      task_titles: ["Conferir prioridades", "Registrar pendências", "Atualizar status da equipe"]
    }
  ],
  trainings: [
    {
      title: "Padrão de execução da área",
      description: "Aula curta criada a partir do onboarding inicial.",
      material_body: "Execute pelo processo publicado, registre evidência e sinalize bloqueios cedo.",
      quiz_prompt: "Qual é o comportamento esperado ao finalizar uma entrega?"
    }
  ],
  announcement: {
    title: "Nova base operacional",
    body: "A empresa agora terá processos, rotinas e treinamentos centralizados no Baase."
  }
};

describe("onboarding routes", () => {
  it("creates a complete starter company setup from generated suggestions", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/setup",
      headers: ownerHeaders,
      payload: setupPayload
    });

    expect(response.statusCode).toBe(201);
    const setup = response.json().setup;

    expect(setup.areas).toHaveLength(2);
    expect(setup.role_templates).toHaveLength(2);
    expect(setup.people).toHaveLength(2);
    expect(setup.processes).toMatchObject([{ title: "Onboarding de cliente novo", status: "published" }]);
    expect(setup.routines).toMatchObject([{ title: "Abertura do dia", status: "active" }]);
    expect(setup.trainings).toMatchObject([{ title: "Padrão de execução da área", status: "published" }]);
    expect(setup.announcements).toMatchObject([{ title: "Nova base operacional", status: "draft" }]);

    expect(setup.role_templates[0].areaId).toBe(setup.areas[0].id);
    expect(setup.people[1]).toMatchObject({
      name: "Bruno Costa",
      areaId: setup.areas[1].id,
      roleTemplateId: setup.role_templates[1].id
    });
    expect(setup.processes[0].areaId).toBe(setup.areas[0].id);
    expect(setup.routines[0].taskTemplates).toHaveLength(3);

    const [areas, roles, people, processes, routines, trainings, announcements] = await Promise.all([
      app.inject({ method: "GET", url: "/areas", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/roles", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/people", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/routines", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/trainings", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/announcements", headers: ownerHeaders })
    ]);

    expect(areas.json().areas).toHaveLength(2);
    expect(roles.json().role_templates).toHaveLength(2);
    expect(people.json().people).toHaveLength(2);
    expect(processes.json().processes[0].status).toBe("published");
    expect(routines.json().routines[0].title).toBe("Abertura do dia");
    expect(trainings.json().trainings[0].status).toBe("published");
    expect(announcements.json().announcements).toMatchObject([{ title: "Nova base operacional", status: "draft" }]);
  });

  it("rejects starter setup creation for employees", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/setup",
      headers: employeeHeaders,
      payload: setupPayload
    });

    expect(response.statusCode).toBe(403);
  });
});
