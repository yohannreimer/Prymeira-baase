import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { ensureOperationalSchema } from "../../db/operational-schema";
import { createConfiguredPostgresRepositoryBundle } from "../../db/postgres";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";

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
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL Studio routes", () => {
  it("creates and reads an owner-scoped document through the configured relational repository", async () => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `baase_studio_routes_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`
    });

    try {
      await ensureOperationalSchema(pool);
      const repositories = createConfiguredPostgresRepositoryBundle(pool, "relational");
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
