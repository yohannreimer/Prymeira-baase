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

describe("template routes", () => {
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
