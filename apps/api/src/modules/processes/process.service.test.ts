import { describe, expect, it } from "vitest";
import { createProcessService } from "./process.service";
import { createInMemoryProcessRepository } from "./in-memory-process.repository";

describe("process service", () => {
  it("recovers a draft process by its durable creation identity", async () => {
    const repository = createInMemoryProcessRepository();
    let throwAfterCreate = true;
    const service = createProcessService({
      ...repository,
      async createProcess(input) {
        const created = await repository.createProcess(input);
        if (throwAfterCreate) {
          throwAfterCreate = false;
          throw new Error("lost response after commit");
        }
        return created;
      }
    });

    const created = await service.createProcess("workspace_a", "profile_owner", {
      title: "Processo estratégico",
      body: "Corpo inicial"
    }, { resourceId: "process_studio_durable" });
    const repeated = await createProcessService(repository).createProcess(
      "workspace_a", "profile_owner", { title: "Não sobrescrever", body: "Outro corpo" },
      { resourceId: "process_studio_durable" }
    );

    expect(created.id).toBe("process_studio_durable");
    expect(repeated).toEqual(created);
    await expect(repository.listProcesses("workspace_a")).resolves.toHaveLength(1);
  });

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

  it("creates a process with one repository mutation and real initial version identity", async () => {
    const base = createInMemoryProcessRepository();
    let updates = 0;
    const service = createProcessService({
      ...base,
      async updateProcess(process) {
        updates += 1;
        return base.updateProcess(process);
      }
    });

    const process = await service.createProcess("workspace_a", "profile_owner", {
      title: "Processo atomico",
      body: "Uma unica gravacao."
    });

    expect(updates).toBe(0);
    expect(process.currentVersion.processId).toBe(process.id);
    expect(process.currentVersion.id).toBe(`version_${process.id}_1`);
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
