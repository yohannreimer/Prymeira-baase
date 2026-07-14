import { afterEach, describe, expect, it, vi } from "vitest";
import { configureBaaseApiAuth } from "../api";
import {
  StudioApiError,
  attachStudioFile,
  attachStudioLink,
  createStudioDocument,
  getStudioDocument,
  getStudioHome,
  listStudioCollections,
  listStudioDocumentVersions,
  listStudioDocuments,
  searchStudioDocuments,
  studioRequest
} from "./studio-api";

const rawDocument = {
  id: "document_1",
  workspace_id: "workspace_a",
  owner_profile_id: "profile_owner",
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
  archived_at: null
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
            next_rituals: [{ id: "ritual_1", title: "Revisão semanal", scheduled_for: "2026-07-17T13:00:00.000Z" }]
          }
        });
      }
      if (input === "/api/studio/documents/document_1") return jsonResponse({ document: rawDocument });
      if (input.startsWith("/api/studio/documents?")) return jsonResponse({ documents: [rawDocument], next_cursor: "cursor_2" });
      if (input === "/api/studio/collections") {
        return jsonResponse({ collections: [{ id: "collection_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", name: "Estratégia", created_at: "2026-07-10", updated_at: "2026-07-11" }] });
      }
      if (input.startsWith("/api/studio/search?")) {
        return jsonResponse({ results: [{ document_id: "document_1", title: "Plano anual", excerpt: "Crescer com margem", updated_at: "2026-07-12", collections: [{ id: "collection_1", name: "Estratégia" }] }] });
      }
      return jsonResponse({ versions: [{ id: "version_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", document_id: "document_1", version_number: 3, body_json: { type: "doc" }, body_text: "Crescer com margem.", origin: "user", actor_profile_id: "profile_owner", ai_run_id: null, created_at: "2026-07-12" }] });
    });

    await expect(getStudioHome(fetcher)).resolves.toMatchObject({
      pendingReviewCount: 2,
      recentDocuments: [{ ownerProfileId: "profile_owner", bodyText: "Crescer com margem.", isFocused: true }],
      nextRituals: [{ scheduledFor: "2026-07-17T13:00:00.000Z" }]
    });
    await expect(getStudioDocument("document_1", fetcher)).resolves.toMatchObject({ id: "document_1", captureMode: "text" });
    await expect(listStudioDocuments({ status: "active", limit: 20, cursor: "cursor 1" }, fetcher)).resolves.toMatchObject({
      items: [{ id: "document_1", inboxState: "reviewed" }],
      nextCursor: "cursor_2"
    });
    await expect(listStudioCollections(fetcher)).resolves.toEqual([
      expect.objectContaining({ id: "collection_1", ownerProfileId: "profile_owner", updatedAt: "2026-07-11" })
    ]);
    await expect(searchStudioDocuments("margem & foco", 10, fetcher)).resolves.toEqual([
      expect.objectContaining({ documentId: "document_1", updatedAt: "2026-07-12", collections: [{ id: "collection_1", name: "Estratégia" }] })
    ]);
    await expect(listStudioDocumentVersions("document_1", fetcher)).resolves.toEqual([
      expect.objectContaining({ documentId: "document_1", versionNumber: 3, actorProfileId: "profile_owner" })
    ]);

    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/studio/documents?status=active&limit=20&cursor=cursor+1");
    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/studio/search?query=margem+%26+foco&limit=10");
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
      capture_mode: "text"
    }, controller.signal, fetcher);
    await attachStudioFile("document_1", new Blob(["plano"], { type: "text/plain" }), "plano.txt", controller.signal, fetcher);
    await attachStudioLink("document_1", "https://example.com/plano", controller.signal, fetcher);

    const createInit = fetcher.mock.calls[0]![1];
    expect(createInit?.signal).toBe(controller.signal);
    expect(JSON.parse(String(createInit?.body))).toMatchObject({ capture_mode: "text" });

    const uploadInit = fetcher.mock.calls[1]![1];
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    expect(new Headers(uploadInit?.headers).has("content-type")).toBe(false);
    expect(uploadInit?.signal).toBe(controller.signal);

    const linkInit = fetcher.mock.calls[2]![1];
    expect(new Headers(linkInit?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(linkInit?.body))).toEqual({ url: "https://example.com/plano" });
  });
});
