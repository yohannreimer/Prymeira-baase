import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readRuntimeConfig } from "../../config/runtime";
import { initializePostgresRuntime } from "../../server-initialization";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import type { StudioMemoryIndex } from "./studio-memory";

const ownerA = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "owner_a"
};

const ownerB = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "owner_b"
};

const ownerAOtherWorkspace = {
  ...ownerA,
  "x-baase-workspace-id": "workspace_b"
};

const manager = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "manager",
  "x-baase-profile-id": "manager_a"
};

const employee = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "employee",
  "x-baase-profile-id": "employee_a"
};

const documentPayload = {
  title: "Expansão",
  body_json: { type: "doc", content: [] },
  body_text: "Crescer sem perder qualidade",
  capture_mode: "text"
};

function createApp() {
  return buildApp({
    studioRepository: createInMemoryStudioRepository({
      now: () => "2026-07-13T12:00:00.000Z"
    })
  });
}

describe("Studio routes", () => {
  it("returns the safe readiness projection only to the owner", async () => {
    const app = buildApp({
      runtimeConfig: readRuntimeConfig({
        BAASE_RUNTIME_MODE: "pilot",
        BAASE_AUTH_MODE: "local",
        BAASE_STUDIO_ENABLED: "true",
        BAASE_STUDIO_VECTOR_ENABLED: "true"
      }),
      aiProvider: createMockAiProvider(),
      studioVectorPersistent: true,
      studioMaintenanceAvailable: true
    });

    const response = await app.inject({ method: "GET", url: "/studio/readiness", headers: ownerA });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ai: { status: "ready", code: null },
      embeddings: { status: "ready", code: null },
      vector: { status: "ready", code: null },
      maintenance: { status: "ready", code: null }
    });
    expect(JSON.stringify(response.json())).not.toContain(documentPayload.body_text);

    for (const headers of [manager, employee]) {
      const forbidden = await app.inject({ method: "GET", url: "/studio/readiness", headers });
      expect(forbidden.statusCode).toBe(403);
    }
  });

  it("reports unavailable Studio AI and vector capabilities honestly", async () => {
    const app = buildApp({
      runtimeConfig: readRuntimeConfig({
        BAASE_RUNTIME_MODE: "production",
        BAASE_AUTH_MODE: "local",
        BAASE_STUDIO_ENABLED: "true",
        BAASE_STUDIO_VECTOR_ENABLED: "false"
      }),
      studioMaintenanceAvailable: false
    });
    const response = await app.inject({ method: "GET", url: "/studio/readiness", headers: ownerA });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ai: { status: "unavailable", code: "AI_PROVIDER_UNAVAILABLE" },
      embeddings: { status: "unavailable", code: "AI_PROVIDER_UNAVAILABLE" },
      vector: { status: "unavailable", code: "STUDIO_VECTOR_NOT_CONFIGURED" },
      maintenance: { status: "unavailable", code: "STUDIO_MAINTENANCE_UNAVAILABLE" }
    });
  });

  it("maps unavailable Studio AI to a safe 503 response", async () => {
    const unavailableIndex: StudioMemoryIndex = {
      async indexVersion() { return false; },
      async removeDocument() { return false; },
      async findRelated() { throw new Error("AI_PROVIDER_UNAVAILABLE"); }
    };
    const app = buildApp({
      runtimeConfig: readRuntimeConfig({
        BAASE_RUNTIME_MODE: "production",
        BAASE_AUTH_MODE: "local",
        BAASE_STUDIO_ENABLED: "true",
        BAASE_STUDIO_VECTOR_ENABLED: "true"
      }),
      studioMemoryIndex: unavailableIndex
    });
    const created = await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerA,
      payload: documentPayload
    });
    const response = await app.inject({
      method: "GET",
      url: `/studio/documents/${created.json().document.id}/related`,
      headers: ownerA
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toEqual({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "A inteligência artificial do Estúdio está indisponível no momento.",
      details: {}
    });
  });

  it.each(["text", "audio", "file", "image", "link", "mixed"] as const)(
    "creates exactly one initial document version for concurrent %s capture retries",
    async (captureMode) => {
      const app = createApp();
      const captureKey = "34343434-3434-4434-8434-343434343434";
      const request = {
        method: "POST" as const,
        url: "/studio/documents",
        headers: { ...ownerA, "idempotency-key": captureKey },
        payload: { ...documentPayload, capture_mode: captureMode }
      };
      const [left, right] = await Promise.all([app.inject(request), app.inject(request)]);

      expect(left.statusCode).toBe(201);
      expect(right.statusCode).toBe(201);
      expect(right.json().document.id).toBe(left.json().document.id);
      expect(left.json().document.captureKey).toBe(captureKey);
      const versions = await app.inject({
        method: "GET",
        url: `/studio/documents/${left.json().document.id}/versions`,
        headers: ownerA
      });
      expect(versions.json().versions).toHaveLength(1);
      const listed = await app.inject({ method: "GET", url: "/studio/documents", headers: ownerA });
      expect(listed.json().documents).toHaveLength(1);

      const isolated = await app.inject({ ...request, headers: { ...ownerB, "idempotency-key": captureKey } });
      expect(isolated.json().document.id).not.toBe(left.json().document.id);
    }
  );

  it("rejects a malformed document capture key", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/studio/documents",
      headers: { ...ownerA, "idempotency-key": "not-a-uuid" },
      payload: documentPayload
    });
    expect(response.statusCode).toBe(400);
  });

  it("frees an archived capture key and reports a restore collision as 409", async () => {
    const app = createApp();
    const captureKey = "56565656-5656-4656-8656-565656565656";
    const create = () => app.inject({
      method: "POST" as const,
      url: "/studio/documents",
      headers: { ...ownerA, "idempotency-key": captureKey },
      payload: documentPayload
    });
    const original = await create();
    const originalId = original.json().document.id as string;

    expect((await app.inject({
      method: "POST",
      url: `/studio/documents/${originalId}/archive`,
      headers: ownerA
    })).statusCode).toBe(200);
    const replacement = await create();
    expect(replacement.json().document.id).not.toBe(originalId);

    const restore = await app.inject({
      method: "POST",
      url: `/studio/documents/${originalId}/restore`,
      headers: ownerA
    });
    expect(restore.statusCode).toBe(409);
    expect(restore.json().error.code).toBe("STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE");
  });

  it("returns the next configured ritual through the owner-scoped home contract", async () => {
    const app = createApp();
    const createRitual = async ({
      headers,
      title,
      localTime
    }: {
      headers: typeof ownerA;
      title: string;
      localTime: string | null;
    }) => {
      const document = await app.inject({
        method: "POST",
        url: "/studio/documents",
        headers,
        payload: { ...documentPayload, title }
      });
      const documentId = document.json().document.id as string;
      const structure = await app.inject({
        method: "POST",
        url: `/studio/documents/${documentId}/structures`,
        headers,
        payload: {
          kind: "ritual",
          cadence_json: localTime ? {
            frequency: "daily",
            local_time: localTime,
            timezone: "America/Sao_Paulo"
          } : null,
          properties_json: { intention: `Intenção de ${title}` }
        }
      });
      expect(structure.statusCode).toBe(201);
      return structure.json().structure as { id: string; nextRunAt: string | null };
    };

    await createRitual({ headers: ownerA, title: "Revisão livre", localTime: null });
    await createRitual({ headers: ownerA, title: "Revisão mensal", localTime: "11:00" });
    const next = await createRitual({ headers: ownerA, title: "Revisão semanal", localTime: "10:00" });
    await createRitual({ headers: ownerB, title: "Ritual de outro dono", localTime: "09:30" });

    const ownerHome = await app.inject({ method: "GET", url: "/studio/home", headers: ownerA });
    expect(ownerHome.statusCode).toBe(200);
    expect(ownerHome.json().home.nextRituals).toEqual([{
      id: next.id,
      title: "Revisão semanal",
      scheduledFor: next.nextRunAt,
      timezone: "America/Sao_Paulo"
    }]);
    expect(ownerHome.json().home.nextRituals[0]).not.toHaveProperty("overdue");

    const otherHome = await app.inject({ method: "GET", url: "/studio/home", headers: ownerB });
    expect(otherHome.json().home.nextRituals).toEqual([
      expect.objectContaining({ title: "Ritual de outro dono" })
    ]);
  });

  it("allows only owners to access the private Studio", async () => {
    const app = createApp();

    expect((await app.inject({ method: "GET", url: "/studio/home", headers: ownerA })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/studio/home", headers: manager })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/studio/home", headers: employee })).statusCode).toBe(403);
  });

  it("supports owner-scoped document CRUD, lifecycle, versions, home, and pagination", async () => {
    const app = createApp();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerA,
      payload: documentPayload
    });

    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.json().document).toMatchObject({
      workspaceId: "workspace_a",
      ownerProfileId: "owner_a",
      revision: 1,
      status: "active",
      inboxState: "pending_review",
      isFocused: false
    });
    const documentId = createdResponse.json().document.id as string;

    await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerB,
      payload: { ...documentPayload, title: "Documento B" }
    });

    const page = await app.inject({
      method: "GET",
      url: "/studio/documents?status=active&limit=1",
      headers: ownerA
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().documents).toHaveLength(1);
    expect(page.json().documents[0].id).toBe(documentId);

    expect((await app.inject({
      method: "GET",
      url: `/studio/documents/${documentId}`,
      headers: ownerB
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "GET",
      url: `/studio/documents/${documentId}`,
      headers: ownerAOtherWorkspace
    })).statusCode).toBe(404);

    const updated = await app.inject({
      method: "PATCH",
      url: `/studio/documents/${documentId}`,
      headers: ownerA,
      payload: {
        expected_revision: 1,
        body_text: "Crescer com margem saudável",
        inbox_state: "reviewed",
        is_focused: true
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().document).toMatchObject({
      revision: 2,
      bodyText: "Crescer com margem saudável",
      inboxState: "reviewed",
      isFocused: true
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/studio/documents/${documentId}`,
      headers: ownerA,
      payload: { expected_revision: 1, title: "Edição antiga" }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STUDIO_DOCUMENT_CHANGED");

    const versions = await app.inject({
      method: "GET",
      url: `/studio/documents/${documentId}/versions`,
      headers: ownerA
    });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().versions.map((version: { versionNumber: number }) => version.versionNumber))
      .toEqual([1, 2]);

    const home = await app.inject({ method: "GET", url: "/studio/home", headers: ownerA });
    expect(home.json().home).toMatchObject({ pendingReviewCount: 0, nextRituals: [] });
    expect(home.json().home.focusedDocuments.map((document: { id: string }) => document.id)).toEqual([documentId]);

    const archived = await app.inject({
      method: "POST",
      url: `/studio/documents/${documentId}/archive`,
      headers: ownerA
    });
    expect(archived.json().document.status).toBe("archived");
    const activePage = await app.inject({
      method: "GET",
      url: "/studio/documents?status=active",
      headers: ownerA
    });
    expect(activePage.json().documents).toEqual([]);

    const restored = await app.inject({
      method: "POST",
      url: `/studio/documents/${documentId}/restore`,
      headers: ownerA
    });
    expect(restored.json().document).toMatchObject({ status: "active", archivedAt: null });
  });

  it("searches only the current owner's active documents and includes collections", async () => {
    const app = createApp();
    const ownerDocument = (await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerA,
      payload: documentPayload
    })).json().document;
    await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerB,
      payload: { ...documentPayload, title: "Expansão confidencial B" }
    });
    const collection = (await app.inject({
      method: "POST",
      url: "/studio/collections",
      headers: ownerA,
      payload: { name: "Estratégia" }
    })).json().collection;
    await app.inject({
      method: "PUT",
      url: `/studio/collections/${collection.id}/documents/${ownerDocument.id}`,
      headers: ownerA
    });

    const response = await app.inject({
      method: "GET",
      url: "/studio/search?query=expansao&limit=10",
      headers: ownerA
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      expect.objectContaining({
        documentId: ownerDocument.id,
        collections: [{ id: collection.id, name: "Estratégia" }]
      })
    ]);
  });

  it("paginates the current owner's documents with an opaque cursor", async () => {
    const app = createApp();
    const createdIds: string[] = [];
    for (const title of ["Primeiro", "Segundo", "Terceiro"]) {
      const response = await app.inject({
        method: "POST",
        url: "/studio/documents",
        headers: ownerA,
        payload: { ...documentPayload, title }
      });
      createdIds.push(response.json().document.id);
    }

    const first = await app.inject({
      method: "GET",
      url: "/studio/documents?limit=2",
      headers: ownerA
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().documents).toHaveLength(2);
    expect(first.json().collectionsByDocumentId).toEqual(expect.any(Object));
    expect(first.json().nextCursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: "GET",
      url: `/studio/documents?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: ownerA
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().documents).toHaveLength(1);
    expect(second.json().nextCursor).toBeNull();
    expect(new Set([
      ...first.json().documents.map((document: { id: string }) => document.id),
      ...second.json().documents.map((document: { id: string }) => document.id)
    ])).toEqual(new Set(createdIds));
  });

  it("supports owner-scoped collection CRUD and document membership", async () => {
    const app = createApp();
    const document = (await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerA,
      payload: documentPayload
    })).json().document;
    const created = await app.inject({
      method: "POST",
      url: "/studio/collections",
      headers: ownerA,
      payload: { name: "Rascunhos" }
    });
    expect(created.statusCode).toBe(201);
    const collectionId = created.json().collection.id as string;

    const renamed = await app.inject({
      method: "PATCH",
      url: `/studio/collections/${collectionId}`,
      headers: ownerA,
      payload: { name: "  Estratégia  " }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().collection.name).toBe("Estratégia");

    const membership = await app.inject({
      method: "PUT",
      url: `/studio/collections/${collectionId}/documents/${document.id}`,
      headers: ownerA
    });
    expect(membership.statusCode).toBe(200);
    expect(membership.json().membership).toMatchObject({ collectionId, documentId: document.id });

    const ownerBMembership = await app.inject({
      method: "PUT",
      url: `/studio/collections/${collectionId}/documents/${document.id}`,
      headers: ownerB
    });
    expect(ownerBMembership.statusCode).toBe(404);

    const removed = await app.inject({
      method: "DELETE",
      url: `/studio/collections/${collectionId}/documents/${document.id}`,
      headers: ownerA
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: true });

    const list = await app.inject({ method: "GET", url: "/studio/collections", headers: ownerA });
    expect(list.statusCode).toBe(200);
    expect(list.json().collections).toEqual([expect.objectContaining({ id: collectionId, name: "Estratégia" })]);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/studio/collections/${collectionId}`,
      headers: ownerA
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().collection.id).toBe(collectionId);
  });

  it("strictly rejects unknown scope, actor, query, body, and malformed path inputs", async () => {
    const app = createApp();
    const unknownBody = await app.inject({
      method: "POST",
      url: "/studio/documents",
      headers: ownerA,
      payload: { ...documentPayload, owner_profile_id: "owner_b" }
    });
    expect(unknownBody.statusCode).toBe(400);
    expect(unknownBody.json().error.code).toBe("REQUEST_VALIDATION_ERROR");

    const unknownQuery = await app.inject({
      method: "GET",
      url: "/studio/documents?workspace_id=workspace_b",
      headers: ownerA
    });
    expect(unknownQuery.statusCode).toBe(400);

    for (const url of [
      "/studio/documents?limit=0",
      "/studio/documents?status=deleted",
      "/studio/documents?cursor=%25%25%25",
      "/studio/search?query=expansao&limit=101"
    ]) {
      expect((await app.inject({ method: "GET", url, headers: ownerA })).statusCode).toBe(400);
    }

    const malformedOpaqueCursor = await app.inject({
      method: "GET",
      url: "/studio/documents?cursor=a",
      headers: ownerA
    });
    expect(malformedOpaqueCursor.statusCode).toBe(400);
    expect(malformedOpaqueCursor.json().error.code).toBe("STUDIO_DOCUMENT_CURSOR_INVALID");

    expect((await app.inject({
      method: "PATCH",
      url: "/studio/collections/%20",
      headers: ownerA,
      payload: { name: "Inválida" }
    })).statusCode).toBe(400);

    const unknownPatchField = await app.inject({
      method: "PATCH",
      url: "/studio/documents/missing",
      headers: ownerA,
      payload: { expected_revision: 1, title: "Título", actor_profile_id: "owner_b" }
    });
    expect(unknownPatchField.statusCode).toBe(400);

    expect((await app.inject({
      method: "GET",
      url: "/studio/documents/missing/unknown-segment",
      headers: ownerA
    })).statusCode).toBe(404);
  });

  it("returns owner-scoped related thoughts and persists only an explicit accepted relation", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-13T12:00:00.000Z" });
    const source = await repository.createDocument({
      workspaceId: "workspace_a", ownerProfileId: "owner_a", title: "Crescimento", bodyJson: {},
      bodyText: "Expandir com qualidade", captureMode: "text", inboxState: "reviewed", isFocused: false, status: "active"
    });
    const target = await repository.createDocument({
      workspaceId: "workspace_a", ownerProfileId: "owner_a", title: "Capacidade", bodyJson: {},
      bodyText: "Preparar o time", captureMode: "text", inboxState: "reviewed", isFocused: false, status: "active"
    });
    const app = buildApp({ studioRepository: repository, studioMemoryIndex: {
      async indexVersion() { return true; }, async removeDocument() { return true; },
      async findRelated() { return [{ documentId: target.id, versionId: "version", chunkIndex: 0,
        excerpt: "Preparar o time", score: 0.8, vectorScore: 0.75, lexicalScore: 0.2,
        recencyScore: 1, updatedAt: target.updatedAt, cursor: "cursor" }]; }
    } });

    const related = await app.inject({ method: "GET", url: `/studio/documents/${source.id}/related`, headers: ownerA });
    expect(related.statusCode).toBe(200);
    expect(related.json().related[0]).toMatchObject({
      document: { id: target.id }, explanation: "Explora uma ideia próxima, mesmo usando palavras diferentes."
    });
    expect(await repository.listRelations({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).toEqual([]);

    const accepted = await app.inject({ method: "POST", url: `/studio/documents/${source.id}/relations`, headers: ownerA,
      payload: { target_document_id: target.id, relation_type: "related_to" } });
    expect(accepted.statusCode).toBe(200);
    expect((await repository.listRelations({ workspaceId: "workspace_a", ownerProfileId: "owner_a" }))).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/studio/documents/${source.id}/related`, headers: ownerB })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/studio/documents/${source.id}/related`, headers: manager })).statusCode).toBe(403);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL Studio routes", () => {
  it("creates and reads an owner-scoped document after JSONB-mode production initialization", async () => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `baase_studio_routes_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`
    });

    try {
      const repositories = await initializePostgresRuntime(pool, "jsonb");
      const app = buildApp({ studioRepository: repositories.studioRepository });
      const created = await app.inject({
        method: "POST",
        url: "/studio/documents",
        headers: ownerA,
        payload: documentPayload
      });
      expect(created.statusCode).toBe(201);

      const read = await app.inject({
        method: "GET",
        url: `/studio/documents/${created.json().document.id}`,
        headers: ownerA
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().document).toMatchObject({
        workspaceId: "workspace_a",
        ownerProfileId: "owner_a",
        bodyText: documentPayload.body_text
      });
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
});
