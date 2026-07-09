import { describe, expect, it } from "vitest";
import { createProcessService } from "./process.service";
import { createInMemoryProcessRepository } from "./in-memory-process.repository";

describe("process service", () => {
  it("creates draft processes with an initial version", async () => {
    const service = createProcessService(createInMemoryProcessRepository());

    const process = await service.createProcess("workspace_a", "profile_owner", {
      title: "Fechamento de caixa",
      body: "Conferir caixa e guardar comprovantes.",
      areaId: "area_financeiro",
      ownerProfileId: "profile_owner"
    });

    expect(process).toMatchObject({
      workspaceId: "workspace_a",
      title: "Fechamento de caixa",
      status: "draft",
      areaId: "area_financeiro",
      ownerProfileId: "profile_owner"
    });
    expect(process.currentVersion).toMatchObject({
      version: 1,
      title: "Fechamento de caixa",
      body: "Conferir caixa e guardar comprovantes.",
      changeNote: "Criação inicial",
      editorProfileId: "profile_owner"
    });
  });

  it("creates a new version when process content changes", async () => {
    const service = createProcessService(createInMemoryProcessRepository());
    const process = await service.createProcess("workspace_a", "profile_owner", {
      title: "Fechamento de caixa",
      body: "Conferir caixa e guardar comprovantes."
    });

    const updated = await service.createProcessVersion("workspace_a", process.id, "profile_manager", {
      body: "Conferir caixa, fotografar comprovantes e guardar envelope.",
      changeNote: "Exige foto dos comprovantes."
    });

    expect(updated.currentVersion).toMatchObject({
      version: 2,
      body: "Conferir caixa, fotografar comprovantes e guardar envelope.",
      changeNote: "Exige foto dos comprovantes.",
      editorProfileId: "profile_manager"
    });
    expect(updated.versions).toHaveLength(2);
  });

  it("keeps processes isolated by workspace", async () => {
    const service = createProcessService(createInMemoryProcessRepository());
    await service.createProcess("workspace_a", "profile_owner", {
      title: "Atendimento inicial",
      body: "Responder cliente com saudação e pergunta de qualificação."
    });

    await expect(service.listProcesses("workspace_a")).resolves.toHaveLength(1);
    await expect(service.listProcesses("workspace_b")).resolves.toHaveLength(0);
  });

  it("publishes draft processes and rejects publishing across workspaces", async () => {
    const service = createProcessService(createInMemoryProcessRepository());
    const process = await service.createProcess("workspace_a", "profile_owner", {
      title: "Atendimento inicial",
      body: "Responder cliente com saudação e pergunta de qualificação."
    });

    const published = await service.publishProcess("workspace_a", process.id);

    expect(published.status).toBe("published");
    await expect(service.publishProcess("workspace_b", process.id)).rejects.toThrow("PROCESS_NOT_FOUND");
  });
});
