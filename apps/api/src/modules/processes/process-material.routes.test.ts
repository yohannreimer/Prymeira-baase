import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryProcessRepository } from "./in-memory-process.repository";
import { createProcessService } from "./process.service";

const managerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "manager",
  "x-baase-profile-id": "profile_manager"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "employee",
  "x-baase-profile-id": "profile_employee"
};

describe("process material routes", () => {
  it("uploads a file and only attaches it after object storage succeeds", async () => {
    const objectStorage = createInMemoryObjectStorage();
    const { app, processId } = await createFixture(objectStorage);

    const response = await uploadFixture(app, `/processes/${processId}/materials/files`, "checklist.pdf", "application/pdf");

    expect(response.statusCode).toBe(201);
    expect(response.json().material).toMatchObject({
      kind: "file",
      title: "checklist.pdf",
      contentType: "application/pdf",
      sizeBytes: 16
    });
    expect(objectStorage.keys()).toHaveLength(1);
  });

  it("does not persist a material when object storage fails", async () => {
    const objectStorage = createInMemoryObjectStorage();
    objectStorage.failNextPut(new Error("storage unavailable"));
    const { app, processId, processRepository } = await createFixture(objectStorage);

    const response = await uploadFixture(app, `/processes/${processId}/materials/files`, "checklist.pdf", "application/pdf");

    expect(response.statusCode).toBe(503);
    expect(await processRepository.listProcessMaterials("workspace_a", processId)).toEqual([]);
  });

  it("removes the uploaded object when material persistence fails", async () => {
    const objectStorage = createInMemoryObjectStorage();
    const { processId, processRepository } = await createFixture(objectStorage);
    const app = buildApp({
      processRepository: {
        ...processRepository,
        async addProcessMaterial() {
          throw new Error("database unavailable");
        }
      },
      objectStorage
    });

    const response = await uploadFixture(app, `/processes/${processId}/materials/files`, "checklist.pdf", "application/pdf");

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("PROCESS_MATERIAL_PERSISTENCE_FAILED");
    expect(objectStorage.keys()).toEqual([]);
  });

  it("creates expiring downloads and removes file metadata with the stored object", async () => {
    const objectStorage = createInMemoryObjectStorage();
    const { app, processId, processRepository } = await createFixture(objectStorage);
    const uploaded = await uploadFixture(app, `/processes/${processId}/materials/files`, "checklist.pdf", "application/pdf");
    const materialId = uploaded.json().material.id;

    const download = await app.inject({
      method: "GET",
      url: `/processes/${processId}/materials/${materialId}/download`,
      headers: employeeHeaders
    });
    expect(download.statusCode).toBe(200);
    expect(download.json().url).toContain("memory://");

    const removed = await app.inject({
      method: "DELETE",
      url: `/processes/${processId}/materials/${materialId}`,
      headers: managerHeaders
    });
    expect(removed.statusCode).toBe(200);
    expect(await processRepository.listProcessMaterials("workspace_a", processId)).toEqual([]);
    expect(objectStorage.keys()).toEqual([]);
  });

  it("preserves uploaded files while replacing editable link materials", async () => {
    const objectStorage = createInMemoryObjectStorage();
    const { app, processId } = await createFixture(objectStorage);
    await uploadFixture(app, `/processes/${processId}/materials/files`, "checklist.pdf", "application/pdf");

    const edited = await app.inject({
      method: "PATCH",
      url: `/processes/${processId}`,
      headers: managerHeaders,
      payload: {
        body: "Conferir entradas e saídas.",
        change_note: "Inclui a fonte oficial.",
        materials: [{ kind: "link", title: "Planilha", url: "https://example.com/planilha" }]
      }
    });

    expect(edited.statusCode).toBe(200);
    expect(edited.json().process.materials).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "file", title: "checklist.pdf" }),
      expect.objectContaining({ kind: "link", title: "Planilha" })
    ]));
  });
});

async function createFixture(objectStorage: ReturnType<typeof createInMemoryObjectStorage>) {
  const processRepository = createInMemoryProcessRepository();
  const process = await createProcessService(processRepository).createProcess("workspace_a", "profile_manager", {
    title: "Fechamento de caixa",
    body: "Conferir entradas e saídas."
  });
  return {
    app: buildApp({ processRepository, objectStorage }),
    processId: process.id,
    processRepository
  };
}

async function uploadFixture(
  app: ReturnType<typeof buildApp>,
  url: string,
  filename: string,
  contentType: string
) {
  const boundary = "----baase-material-boundary";
  const payload = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
    "arquivo de teste",
    `--${boundary}--`,
    ""
  ].join("\r\n"));

  return app.inject({
    method: "POST",
    url,
    headers: { ...managerHeaders, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload
  });
}
