import { afterEach, describe, expect, it, vi } from "vitest";
import { configureBaaseApiAuth } from "../api";
import {
  StudioApiError,
  addStudioDocumentToCollection,
  archiveStudioDocument,
  attachStudioFile,
  attachStudioLink,
  createStudioCollection,
  createStudioCheckpoint,
  createStudioDocument,
  createStudioStructure,
  deleteStudioAsset,
  deleteStudioCollection,
  getStudioAsset,
  getStudioAssetDownload,
  getStudioDocumentAssets,
  getStudioDocument,
  getStudioHome,
  finishStudioRitualSession,
  listStudioCollections,
  listStudioDocumentVersions,
  listStudioDocuments,
  listStudioRitualSessions,
  listStudioStructures,
  removeStudioDocumentFromCollection,
  permanentlyDeleteStudioDocument,
  renameStudioCollection,
  restoreStudioDocument,
  restoreStudioDocumentFromTrash,
  trashStudioDocument,
  restoreStudioDocumentVersion,
  retryStudioAsset,
  searchStudioDocuments,
  createStudioExitCheckpoint,
  mapStudioDocument,
  mapStudioDocumentVersion,
  studioRequest,
  startStudioRitualSession,
  updateStudioDocument,
  updateStudioRitualSession,
  updateStudioStructure
} from "./studio-api";

const rawDocument = {
  id: "document_1",
  workspace_id: "workspace_a",
  owner_profile_id: "profile_owner",
  capture_key: "45454545-4545-4454-8454-454545454545",
  title: "Plano anual",
  body_json: { type: "doc" },
  body_text: "Crescer com margem.",
  revision: 3,
  capture_mode: "text",
  inbox_state: "reviewed",
  is_focused: true,
  status: "active",
  created_at: "2026-07-10T10:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
  archived_at: null,
  trashed_at: "2026-07-13T10:00:00.000Z",
  pre_trash_status: "archived"
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Studio API client", () => {
  afterEach(() => {
    configureBaaseApiAuth(null);
    vi.restoreAllMocks();
  });

  it("maps snake_case home, document, page, collections, search, and versions payloads", async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === "/api/studio/home") {
        return jsonResponse({
          home: {
            recent_documents: [rawDocument],
            focused_documents: [rawDocument],
            pending_review_count: 2,
            next_rituals: [{
              id: "ritual_1",
              title: "Revisão semanal",
              scheduled_for: "2026-07-17T13:00:00.000Z",
              timezone: "America/Sao_Paulo"
            }]
          }
        });
      }
      if (input === "/api/studio/documents/document_1") return jsonResponse({ document: rawDocument });
      if (input.startsWith("/api/studio/documents?")) return jsonResponse({
        documents: [rawDocument],
        next_cursor: "cursor_2",
        collections_by_document_id: {
          document_1: [{ id: "collection_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", name: "Estratégia", created_at: "2026-07-10", updated_at: "2026-07-11" }]
        }
      });
      if (input === "/api/studio/collections") {
        return jsonResponse({ collections: [{ id: "collection_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", name: "Estratégia", created_at: "2026-07-10", updated_at: "2026-07-11" }] });
      }
      if (input.startsWith("/api/studio/search?")) {
        return jsonResponse({ results: [{ document_id: "document_1", title: "Plano anual", excerpt: "Crescer com margem", updated_at: "2026-07-12", collections: [{ id: "collection_1", name: "Estratégia" }] }] });
      }
      return jsonResponse({ versions: [{ id: "version_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", document_id: "document_1", version_number: 3, body_json: { type: "doc" }, body_text: "Crescer com margem.", origin: "user", actor_profile_id: "profile_owner", ai_run_id: null, created_at: "2026-07-12", title: "Checkpoint de decisão", checkpoint_reason: "manual", source_revision: 3, is_legacy: false }], next_cursor: "cursor_2" });
    });

    await expect(getStudioHome(fetcher)).resolves.toMatchObject({
      pendingReviewCount: 2,
      recentDocuments: [{
        ownerProfileId: "profile_owner",
        captureKey: rawDocument.capture_key,
        bodyText: "Crescer com margem.",
        isFocused: true
      }],
      nextRituals: [{ scheduledFor: "2026-07-17T13:00:00.000Z", timezone: "America/Sao_Paulo" }]
    });
    await expect(getStudioDocument("document_1", fetcher)).resolves.toMatchObject({
      id: "document_1", captureMode: "text", trashedAt: "2026-07-13T10:00:00.000Z", preTrashStatus: "archived"
    });
    await expect(listStudioDocuments({ status: "active", limit: 20, cursor: "cursor 1" }, fetcher)).resolves.toMatchObject({
      items: [{ id: "document_1", inboxState: "reviewed" }],
      nextCursor: "cursor_2",
      collectionsByDocumentId: { document_1: [expect.objectContaining({ id: "collection_1" })] }
    });
    await listStudioDocuments({ status: "active", inbox_state: "pending_review", collection_id: "collection / 1" }, fetcher);
    await expect(listStudioCollections(fetcher)).resolves.toEqual([
      expect.objectContaining({ id: "collection_1", ownerProfileId: "profile_owner", updatedAt: "2026-07-11" })
    ]);
    await expect(searchStudioDocuments("margem & foco", 10, fetcher)).resolves.toEqual([
      expect.objectContaining({ documentId: "document_1", updatedAt: "2026-07-12", collections: [{ id: "collection_1", name: "Estratégia" }] })
    ]);
    await expect(listStudioDocumentVersions("document_1", { limit: 25, cursor: "cursor_1" }, undefined, fetcher)).resolves.toEqual({
      versions: [expect.objectContaining({ documentId: "document_1", versionNumber: 3, actorProfileId: "profile_owner", title: "Checkpoint de decisão", checkpointReason: "manual", sourceRevision: 3, isLegacy: false })],
      nextCursor: "cursor_2"
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/studio/documents?status=active&limit=20&cursor=cursor+1");
    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/studio/documents?status=active&inbox_state=pending_review&collection_id=collection+%2F+1");
    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/studio/search?query=margem+%26+foco&limit=10");
    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/studio/documents/document_1/versions?limit=25&cursor=cursor_1");
  });

  it("maps camelCase checkpoint and trash metadata", () => {
    expect(mapStudioDocument({
      id: "document_camel", workspaceId: "workspace_a", ownerProfileId: "profile_owner", captureKey: null,
      title: null, bodyJson: {}, bodyText: "", revision: 1, captureMode: "text", inboxState: "reviewed",
      isFocused: false, status: "trashed", createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z", archivedAt: null,
      trashedAt: "2026-07-12T10:00:00.000Z", preTrashStatus: "active"
    })).toMatchObject({ trashedAt: "2026-07-12T10:00:00.000Z", preTrashStatus: "active" });
    expect(mapStudioDocumentVersion({
      id: "version_camel", workspaceId: "workspace_a", ownerProfileId: "profile_owner", documentId: "document_camel",
      versionNumber: 1, bodyJson: {}, bodyText: "", origin: "user", actorProfileId: "profile_owner", aiRunId: null,
      createdAt: "2026-07-12T10:00:00.000Z", title: "Checkpoint", checkpointReason: "manual",
      sourceRevision: 1, isLegacy: false
    })).toMatchObject({ title: "Checkpoint", checkpointReason: "manual", sourceRevision: 1, isLegacy: false });
  });

  it("restores an encoded immutable version through the dedicated endpoint", async () => {
    const restoredVersion = {
      id: "version / 2", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
      document_id: "document / 1", version_number: 3, body_json: {}, body_text: "Restaurado",
      origin: "user" as const, actor_profile_id: "profile_owner", ai_run_id: null,
      created_at: "2026-07-16T10:00:00.000Z", checkpoint_reason: "restored" as const,
      source_revision: 5, is_legacy: false
    };
    const fetcher = vi.fn(async () => jsonResponse({
      document: { ...rawDocument, id: "document / 1", revision: 5, body_text: "Restaurado" },
      version: restoredVersion
    }));

    await expect(restoreStudioDocumentVersion(
      "document / 1", "version / 2", { expected_revision: 4 }, undefined, fetcher
    )).resolves.toMatchObject({
      document: { revision: 5, bodyText: "Restaurado" },
      version: { checkpointReason: "restored", sourceRevision: 5 }
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/studio/documents/document%20%2F%201/versions/version%20%2F%202/restore",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expected_revision: 4 }) })
    );
  });

  it("merges JSON and owner auth headers, preserves caller headers and AbortSignal", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse({ ok: true }));

    await studioRequest("/home", {
      method: "POST",
      headers: { "x-request-id": "request_1" },
      body: JSON.stringify({ ready: true }),
      signal: controller.signal
    }, fetcher);

    const [, init] = fetcher.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-request-id")).toBe("request_1");
    expect(headers.get("x-baase-workspace-id")).toBe("workspace_a");
    expect(headers.get("x-baase-role")).toBe("owner");
    expect(headers.get("x-baase-profile-id")).toBe("profile_owner");
    expect(init?.signal).toBe(controller.signal);

    configureBaaseApiAuth({ getToken: async () => "account-token", accountMode: true });
    await studioRequest("/home", {}, fetcher);
    const accountHeaders = new Headers(fetcher.mock.calls[1]![1]?.headers);
    expect(accountHeaders.get("content-type")).toBe("application/json");
    expect(accountHeaders.get("x-baase-workspace-id")).toBeNull();
    expect(accountHeaders.get("authorization")).toBe("Bearer account-token");
  });

  it("preserves structured API errors and safely handles empty or non-JSON failures", async () => {
    const structured = vi.fn(async () => jsonResponse({ error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Atualize e tente novamente." } }, 409));
    const empty = vi.fn(async () => new Response(null, { status: 503 }));
    const text = vi.fn(async () => new Response("gateway unavailable", { status: 502, headers: { "content-type": "text/plain" } }));

    await expect(studioRequest("/documents/document_1", {}, structured)).rejects.toMatchObject({
      name: "StudioApiError",
      status: 409,
      code: "STUDIO_DOCUMENT_CHANGED",
      message: "Atualize e tente novamente."
    });
    await expect(studioRequest("/home", {}, empty)).rejects.toEqual(expect.objectContaining<Partial<StudioApiError>>({ status: 503, code: "STUDIO_API_ERROR" }));
    await expect(studioRequest("/home", {}, text)).rejects.toEqual(expect.objectContaining<Partial<StudioApiError>>({ status: 502, code: "STUDIO_API_ERROR" }));
  });

  it("returns an empty object for successful empty and non-JSON responses", async () => {
    await expect(studioRequest("/home", {}, async () => new Response(null, { status: 204 }))).resolves.toEqual({});
    await expect(studioRequest("/home", {}, async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }))).resolves.toEqual({});
  });

  it("creates captures and sends private attachments without overriding multipart boundaries", async () => {
    const rawAsset = {
      id: "asset_1",
      workspace_id: "workspace_a",
      owner_profile_id: "profile_owner",
      document_id: "document_1",
      kind: "file",
      display_name: "plano.txt",
      source_url: null,
      final_url: null,
      mime_type: "text/plain",
      size_bytes: 5,
      extraction_status: "pending",
      extracted_text: null,
      last_error_code: null,
      created_at: "2026-07-13T12:00:00.000Z",
      updated_at: "2026-07-13T12:00:00.000Z"
    } as const;
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => input.endsWith("/documents")
      ? jsonResponse({ document: rawDocument }, 201)
      : jsonResponse({ asset: input.endsWith("/assets") ? rawAsset : { ...rawAsset, kind: "link_snapshot" } }, 201));
    const controller = new AbortController();

    await createStudioDocument({
      title: null,
      body_json: { type: "doc" },
      body_text: "Crescer com margem.",
      capture_mode: "text",
      capture_key: rawDocument.capture_key
    }, controller.signal, fetcher);
    await attachStudioFile(
      "document_1", new Blob(["plano"], { type: "text/plain" }), "plano.txt",
      "11111111-1111-4111-8111-111111111111", controller.signal, fetcher
    );
    await attachStudioLink(
      "document_1", "https://example.com/plano",
      "22222222-2222-4222-8222-222222222222", controller.signal, fetcher
    );

    const createInit = fetcher.mock.calls[0]![1];
    expect(createInit?.signal).toBe(controller.signal);
    expect(new Headers(createInit?.headers).get("idempotency-key")).toBe(rawDocument.capture_key);
    expect(JSON.parse(String(createInit?.body))).toMatchObject({ capture_mode: "text" });
    expect(JSON.parse(String(createInit?.body))).not.toHaveProperty("capture_key");

    const uploadInit = fetcher.mock.calls[1]![1];
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    expect(new Headers(uploadInit?.headers).has("content-type")).toBe(false);
    expect(new Headers(uploadInit?.headers).get("idempotency-key"))
      .toBe("11111111-1111-4111-8111-111111111111");
    expect(uploadInit?.signal).toBe(controller.signal);

    const linkInit = fetcher.mock.calls[2]![1];
    expect(new Headers(linkInit?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(linkInit?.headers).get("idempotency-key"))
      .toBe("22222222-2222-4222-8222-222222222222");
    expect(JSON.parse(String(linkInit?.body))).toEqual({ url: "https://example.com/plano" });
  });

  it("updates a document with optimistic revision and preserves cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => (
      jsonResponse({ document: { ...rawDocument, revision: 4, body_text: "Nova direção" } })
    ));

    await expect(updateStudioDocument("document / 1", {
      expected_revision: 3,
      title: "Plano revisado",
      body_json: { type: "doc", content: [] },
      body_text: "Nova direção"
    }, controller.signal, fetcher)).resolves.toMatchObject({ revision: 4, bodyText: "Nova direção" });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/studio/documents/document%20%2F%201",
      expect.objectContaining({ method: "PATCH", signal: controller.signal })
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      expected_revision: 3,
      title: "Plano revisado",
      body_json: { type: "doc", content: [] },
      body_text: "Nova direção"
    });
  });

  it("creates a checkpoint with its reason, expected revision, and cancellation signal", async () => {
    const controller = new AbortController();
    const rawVersion = {
      id: "version_2",
      workspace_id: "workspace_a",
      owner_profile_id: "profile_owner",
      document_id: "document_1",
      version_number: 2,
      body_json: { type: "doc" },
      body_text: "Nova direção significativa",
      origin: "user",
      actor_profile_id: "profile_owner",
      ai_run_id: null,
      created_at: "2026-07-15T10:00:00.000Z",
      title: "Plano anual",
      checkpoint_reason: "significant_pause",
      checkpoint_key: "pause:document_1:4",
      source_revision: 4,
      is_legacy: false
    } as const;
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse({ version: rawVersion }, 201));

    await expect(createStudioCheckpoint("document / 1", {
      expected_revision: 4,
      reason: "significant_pause",
      checkpoint_key: "pause:document_1:4"
    }, controller.signal, fetcher, { keepalive: true })).resolves.toMatchObject({
      id: "version_2",
      checkpointReason: "significant_pause",
      checkpointKey: "pause:document_1:4",
      sourceRevision: 4
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/studio/documents/document%20%2F%201/checkpoints",
      expect.objectContaining({ method: "POST", signal: controller.signal, keepalive: true })
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      expected_revision: 4,
      reason: "significant_pause",
      checkpoint_key: "pause:document_1:4"
    });
  });

  it("creates a small navigation checkpoint with keepalive and preserves conflicts", async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.known_revision === 99) return jsonResponse({
        error: { code: "STUDIO_DOCUMENT_CHANGED", message: "O documento mudou." }
      }, 409);
      return jsonResponse({
        document: { ...rawDocument, revision: 4 },
        version: {
          id: "version_exit", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
          document_id: "document_1", version_number: 4, body_json: rawDocument.body_json, body_text: rawDocument.body_text,
          origin: "user", actor_profile_id: "profile_owner", ai_run_id: null,
          created_at: "2026-07-15T10:00:00.000Z", title: rawDocument.title,
          checkpoint_reason: "document_exit", source_revision: 4, is_legacy: false
        }
      });
    });
    const input = { known_revision: 3 };

    await expect(createStudioExitCheckpoint("document / 1", input, fetcher)).resolves.toMatchObject({
      document: { revision: 4 },
      version: { checkpointReason: "document_exit", sourceRevision: 4 }
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/studio/documents/document%20%2F%201/exit-checkpoint",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toBe(JSON.stringify({ known_revision: 3 }));
    expect(new TextEncoder().encode(String(fetcher.mock.calls[0]?.[1]?.body)).byteLength).toBeLessThan(64 * 1024);
    await expect(createStudioExitCheckpoint("document_1", { known_revision: 99 }, fetcher))
      .rejects.toMatchObject({ status: 409, code: "STUDIO_DOCUMENT_CHANGED" });
  });

  it("maps, creates, and updates strategic structures through the API contract", async () => {
    const controller = new AbortController();
    const rawStructure = {
      id: "structure_1",
      workspace_id: "workspace_a",
      owner_profile_id: "profile_owner",
      document_id: "document_1",
      kind: "goal",
      lifecycle_status: "active",
      revision: 1,
      horizon_at: null,
      metric_json: null,
      cadence_json: null,
      next_run_at: null,
      properties_json: { desired_outcome: "Crescer com margem" },
      created_at: "2026-07-14T10:00:00.000Z",
      updated_at: "2026-07-14T10:00:00.000Z",
      archived_at: null
    } as const;
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (!init?.method) return jsonResponse({ structures: [rawStructure], next_cursor: "cursor_2" });
      const payload = JSON.parse(String(init.body));
      return jsonResponse({ structure: {
        ...rawStructure,
        document_id: input.includes("/documents/") ? "document / 1" : rawStructure.document_id,
        revision: init.method === "PATCH" ? 2 : 1,
        properties_json: payload.properties_json
      } }, init.method === "POST" ? 201 : 200);
    });

    await expect(listStudioStructures({ kind: "goal", lifecycle_status: "active", document_id: "document / 1", cursor: "cursor 1", limit: 25 }, fetcher, controller.signal))
      .resolves.toMatchObject({ items: [{ documentId: "document_1", propertiesJson: { desired_outcome: "Crescer com margem" } }], nextCursor: "cursor_2" });
    await createStudioStructure("document / 1", {
      kind: "goal", horizon_at: null, metric_json: null,
      properties_json: { desired_outcome: "Expandir" }
    }, controller.signal, fetcher);
    await updateStudioStructure("structure / 1", {
      expected_revision: 1,
      properties_json: { desired_outcome: "Expandir com margem" }
    }, controller.signal, fetcher);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/studio/structures?kind=goal&lifecycle_status=active&document_id=document+%2F+1&cursor=cursor+1&limit=25",
      "/api/studio/documents/document%20%2F%201/structures",
      "/api/studio/structures/structure%20%2F%201"
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.signal)).toEqual([controller.signal, controller.signal, controller.signal]);
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toMatchObject({ expected_revision: 1 });
  });

  it("maps ritual sessions and preserves optimistic revisions across session routes", async () => {
    const rawSession = {
      id: "session_1",
      workspace_id: "workspace_a",
      owner_profile_id: "profile_owner",
      ritual_id: "ritual / 1",
      status: "ready" as const,
      revision: 3,
      context_json: { preparedAt: "2026-07-14T12:00:00.000Z" },
      preparation_json: { proposal: { agenda: [] } },
      answers_json: { "O que mudou?": "Mais clareza" },
      synthesis_json: null,
      prepare_ai_run_id: "run_prepare",
      synthesis_ai_run_id: null,
      failure_code: null,
      created_at: "2026-07-14T12:00:00.000Z",
      updated_at: "2026-07-14T12:01:00.000Z",
      completed_at: null
    };
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST" && input.endsWith("/finish")) {
        return jsonResponse({ session: { ...rawSession, status: "completed", revision: 5, completed_at: "2026-07-14T12:15:00.000Z" } });
      }
      if (init?.method === "PATCH") return jsonResponse({ session: { ...rawSession, status: "in_progress", revision: 4 } });
      if (init?.method === "POST") return jsonResponse({ session: rawSession }, 201);
      return jsonResponse({ sessions: [rawSession], next_cursor: "cursor_2" });
    });

    await expect(listStudioRitualSessions("ritual / 1", { limit: 1 }, undefined, fetcher)).resolves.toMatchObject({
      items: [{ ritualId: "ritual / 1", ownerProfileId: "profile_owner", answersJson: { "O que mudou?": "Mais clareza" } }],
      nextCursor: "cursor_2"
    });
    await expect(startStudioRitualSession("ritual / 1", undefined, fetcher)).resolves.toMatchObject({ status: "ready", revision: 3 });
    await expect(updateStudioRitualSession("session / 1", {
      expected_revision: 3,
      answers: { "O que merece foco?": "Clientes" }
    }, undefined, fetcher)).resolves.toMatchObject({ status: "in_progress", revision: 4 });
    await expect(finishStudioRitualSession("session / 1", {
      expected_revision: 4,
      answers: {},
      request_synthesis: true
    }, undefined, fetcher)).resolves.toMatchObject({ status: "completed", revision: 5 });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/studio/rituals/ritual%20%2F%201/sessions?limit=1",
      "/api/studio/rituals/ritual%20%2F%201/sessions",
      "/api/studio/ritual-sessions/session%20%2F%201",
      "/api/studio/ritual-sessions/session%20%2F%201/finish"
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({});
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      expected_revision: 3,
      answers: { "O que merece foco?": "Clientes" }
    });
  });

  it("archives, restores, trashes, permanently deletes, and changes collection membership with encoded owner-scoped routes", async () => {
    const controller = new AbortController();
    const rawCollection = {
      id: "collection / 1", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
      name: "Estratégia", created_at: "2026-07-10", updated_at: "2026-07-11"
    };
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => init?.method === "DELETE" && input.startsWith("/api/studio/documents/")
      ? new Response(null, { status: 204 })
      : input.includes("/collections/")
      ? jsonResponse({ membership: {}, removed: true, collections: init?.method === "DELETE" ? [] : [rawCollection] })
      : jsonResponse({ document: { ...rawDocument, status: input.endsWith("/archive") ? "archived" : "active" } }));

    await archiveStudioDocument("document / 1", controller.signal, fetcher);
    await restoreStudioDocument("document / 1", controller.signal, fetcher);
    await trashStudioDocument("document / 1", controller.signal, fetcher);
    await restoreStudioDocumentFromTrash("document / 1", controller.signal, fetcher);
    await permanentlyDeleteStudioDocument("document / 1", controller.signal, fetcher);
    await expect(addStudioDocumentToCollection("collection / 1", "document / 1", controller.signal, fetcher))
      .resolves.toEqual([expect.objectContaining({ id: "collection / 1", name: "Estratégia" })]);
    await expect(removeStudioDocumentFromCollection("collection / 1", "document / 1", controller.signal, fetcher))
      .resolves.toEqual([]);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/studio/documents/document%20%2F%201/archive",
      "/api/studio/documents/document%20%2F%201/restore",
      "/api/studio/documents/document%20%2F%201/trash",
      "/api/studio/documents/document%20%2F%201/restore-from-trash",
      "/api/studio/documents/document%20%2F%201",
      "/api/studio/collections/collection%20%2F%201/documents/document%20%2F%201",
      "/api/studio/collections/collection%20%2F%201/documents/document%20%2F%201"
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "POST", "POST", "DELETE", "PUT", "DELETE"]);
    expect(fetcher.mock.calls.every(([, init]) => init?.signal === controller.signal)).toBe(true);
  });

  it("creates, renames, and deletes collections through encoded routes", async () => {
    const controller = new AbortController();
    const rawCollection = {
      id: "collection / 1", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
      name: "Estratégia", created_at: "2026-07-10", updated_at: "2026-07-11"
    };
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => jsonResponse({
      collection: { ...rawCollection, name: init?.method === "PATCH" ? "Conselho" : rawCollection.name }
    }));

    await expect(createStudioCollection("Estratégia", controller.signal, fetcher)).resolves.toMatchObject({ name: "Estratégia" });
    await expect(renameStudioCollection(rawCollection.id, "Conselho", controller.signal, fetcher)).resolves.toMatchObject({ name: "Conselho" });
    await deleteStudioCollection(rawCollection.id, controller.signal, fetcher);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/studio/collections",
      "/api/studio/collections/collection%20%2F%201",
      "/api/studio/collections/collection%20%2F%201"
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "PATCH", "DELETE"]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ name: "Estratégia" });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ name: "Conselho" });
    expect(fetcher.mock.calls.every(([, init]) => init?.signal === controller.signal)).toBe(true);
  });

  it("loads every persisted asset for a document", async () => {
    const rawAsset = {
      id: "asset_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
      document_id: "document_1", idempotency_key: "33333333-3333-4333-8333-333333333333",
      kind: "audio", display_name: "reflexao.wav", source_url: null, final_url: null,
      mime_type: "audio/wav", size_bytes: 52, extraction_status: "ready",
      extracted_text: "Uma direção clara.", last_error_code: null, attempt_count: 1,
      next_attempt_at: null, created_at: "2026-07-13T12:00:00.000Z",
      updated_at: "2026-07-13T12:01:00.000Z"
    } as const;
    const controller = new AbortController();
    const fetcher = vi.fn(async () => jsonResponse({ assets: [rawAsset] }));

    await expect(getStudioDocumentAssets("document_1", controller.signal, fetcher)).resolves.toEqual([
      expect.objectContaining({ id: "asset_1", idempotencyKey: rawAsset.idempotency_key, extractedText: "Uma direção clara." })
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/studio/documents/document_1/assets",
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("reads processing state, requests retry, and obtains the authorized original", async () => {
    const rawAsset = {
      id: "asset_1",
      workspace_id: "workspace_a",
      owner_profile_id: "profile_owner",
      document_id: "document_1",
      kind: "audio",
      display_name: "reflexao.wav",
      source_url: null,
      final_url: null,
      mime_type: "audio/wav",
      size_bytes: 52,
      extraction_status: "failed",
      extracted_text: null,
      last_error_code: "STUDIO_ASSET_PROCESSING_FAILED",
      attempt_count: 1,
      next_attempt_at: null,
      created_at: "2026-07-13T12:00:00.000Z",
      updated_at: "2026-07-13T12:01:00.000Z"
    } as const;
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => input.endsWith("/download")
      ? jsonResponse({ url: "https://private.example/audio", expires_in_seconds: 600 })
      : jsonResponse({ asset: input.endsWith("/retry")
        ? { ...rawAsset, extraction_status: "pending", attempt_count: 0, last_error_code: null }
        : rawAsset }));
    const controller = new AbortController();

    await expect(getStudioAsset("asset_1", controller.signal, fetcher)).resolves.toMatchObject({
      extractionStatus: "failed",
      attemptCount: 1,
      nextAttemptAt: null
    });
    await expect(retryStudioAsset("asset_1", controller.signal, fetcher)).resolves.toMatchObject({
      extractionStatus: "pending",
      attemptCount: 0
    });
    await expect(getStudioAssetDownload("asset_1", controller.signal, fetcher)).resolves.toEqual({
      url: "https://private.example/audio",
      expiresInSeconds: 600
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/studio/assets/asset_1",
      "/api/studio/assets/asset_1/retry",
      "/api/studio/assets/asset_1/download"
    ]);
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe("{}");
    expect(fetcher.mock.calls.every(([, init]) => init?.signal === controller.signal)).toBe(true);
  });

  it("deletes an owner-scoped Studio asset through the material lifecycle endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const controller = new AbortController();

    await expect(deleteStudioAsset("asset / 1", controller.signal, fetcher)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/studio/assets/asset%20%2F%201",
      expect.objectContaining({ method: "DELETE", signal: controller.signal })
    );
  });
});
