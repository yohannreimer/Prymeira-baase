import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import type { StudioRepository } from "./studio.types";
import type { StudioLinkFetcher, StudioLinkResolver } from "./studio-assets.routes";

const ownerA = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "owner_a"
};

const ownerB = { ...ownerA, "x-baase-profile-id": "owner_b" };
const manager = { ...ownerA, "x-baase-role": "manager", "x-baase-profile-id": "manager_a" };
const employee = { ...ownerA, "x-baase-role": "employee", "x-baase-profile-id": "employee_a" };

describe("Studio asset routes", () => {
  it("uploads a private text asset and creates an exactly ten-minute download URL", async () => {
    const fixture = await createFixture();
    const uploaded = await upload(fixture.app, fixture.documentId, {
      filename: "Notas estratégicas.txt",
      mimeType: "text/plain",
      body: Buffer.from("crescer com qualidade")
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().asset).toMatchObject({
      workspaceId: "workspace_a",
      ownerProfileId: "owner_a",
      documentId: fixture.documentId,
      kind: "file",
      displayName: "Notas-estrategicas.txt",
      mimeType: "text/plain",
      sizeBytes: 21,
      extractionStatus: "pending",
      attemptCount: 0
    });
    expect(uploaded.json().asset.objectKey).toMatch(
      new RegExp(`^workspaces/workspace_a/studio/owner_a/${fixture.documentId}/[^/]+-Notas-estrategicas\\.txt$`)
    );

    const assetId = uploaded.json().asset.id as string;
    const download = await fixture.app.inject({
      method: "GET",
      url: `/studio/assets/${assetId}/download`,
      headers: ownerA
    });
    expect(download.statusCode).toBe(200);
    expect(download.json()).toMatchObject({ expires_in_seconds: 600 });
    expect(download.json().url).toContain("expires_in=600");

    expect((await fixture.app.inject({
      method: "GET",
      url: `/studio/assets/${assetId}/download`,
      headers: ownerB
    })).statusCode).toBe(404);
    expect((await fixture.app.inject({
      method: "GET",
      url: `/studio/assets/${assetId}/download`,
      headers: manager
    })).statusCode).toBe(403);
    expect((await fixture.app.inject({
      method: "GET",
      url: `/studio/assets/${assetId}/download`,
      headers: employee
    })).statusCode).toBe(403);
    expect((await upload(fixture.app, fixture.documentId, {
      filename: "manager.txt", mimeType: "text/plain", body: Buffer.from("blocked")
    }, manager)).statusCode).toBe(403);
    expect((await upload(fixture.app, fixture.documentId, {
      filename: "employee.txt", mimeType: "text/plain", body: Buffer.from("blocked")
    }, employee)).statusCode).toBe(403);
  });

  it("rejects caller scope and unknown route input", async () => {
    const fixture = await createFixture();
    expect((await fixture.app.inject({
      method: "POST",
      url: `/studio/documents/${fixture.documentId}/assets?owner_profile_id=owner_b`,
      headers: ownerA,
      payload: { url: "https://example.com" }
    })).statusCode).toBe(400);
    expect((await fixture.app.inject({
      method: "GET",
      url: "/studio/assets/missing/download?workspaceId=workspace_b",
      headers: ownerA
    })).statusCode).toBe(400);
  });

  it("rejects empty, oversized, and unsupported uploads", async () => {
    const fixture = await createFixture();
    const empty = await upload(fixture.app, fixture.documentId, {
      filename: "empty.txt", mimeType: "text/plain", body: Buffer.alloc(0)
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("STUDIO_ASSET_FILE_EMPTY");

    const unsupported = await upload(fixture.app, fixture.documentId, {
      filename: "payload.exe", mimeType: "application/x-msdownload", body: Buffer.from("MZ")
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json().error.code).toBe("STUDIO_ASSET_MIME_UNSUPPORTED");

    const oversized = await upload(fixture.app, fixture.documentId, {
      filename: "large.txt", mimeType: "text/plain", body: Buffer.alloc(25 * 1024 * 1024 + 1, 1)
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(fixture.objectStorage.keys()).toEqual([]);
  });

  it("removes the stored object when asset persistence fails", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const objectStorage = createInMemoryObjectStorage();
    const app = buildApp({
      objectStorage,
      studioRepository: {
        ...repository,
        async createAsset() {
          throw new Error("database unavailable");
        }
      }
    });

    const response = await upload(app, document.id, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("STUDIO_ASSET_PERSISTENCE_FAILED");
    expect(objectStorage.keys()).toEqual([]);
  });

  it("deletes the private object only after an owner-scoped asset lookup", async () => {
    const fixture = await createFixture();
    const uploaded = await upload(fixture.app, fixture.documentId, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    const assetId = uploaded.json().asset.id as string;

    expect((await fixture.app.inject({
      method: "DELETE", url: `/studio/assets/${assetId}`, headers: ownerB
    })).statusCode).toBe(404);
    expect(fixture.objectStorage.keys()).toHaveLength(1);

    const removed = await fixture.app.inject({
      method: "DELETE", url: `/studio/assets/${assetId}`, headers: ownerA
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });
    expect(fixture.objectStorage.keys()).toEqual([]);
    expect(await fixture.repository.findAsset(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }, assetId
    )).toBeNull();
  });

  it("captures a safe inert link snapshot and persists its final metadata", async () => {
    const resolver: StudioLinkResolver = vi.fn(async () => ["93.184.216.34"]);
    const fetcher: StudioLinkFetcher = vi.fn(async ({ pinnedAddress }) => ({
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Readable.from('<html><head><title>Plano externo</title><script>alert(1)</script></head><body><h1>Meta</h1><p>Crescer com margem.</p></body></html>'),
      pinnedAddress
    }));
    const fixture = await createFixture({ resolver, fetcher });

    const response = await fixture.app.inject({
      method: "POST",
      url: `/studio/documents/${fixture.documentId}/assets`,
      headers: ownerA,
      payload: { url: "https://example.com/start" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().asset).toMatchObject({
      kind: "link_snapshot",
      displayName: "Plano externo",
      objectKey: null,
      sourceUrl: "https://example.com/start",
      finalUrl: "https://example.com/start",
      fetchedAt: "2026-07-13T12:00:00.000Z",
      extractionStatus: "ready"
    });
    expect(response.json().asset.extractedText).toContain("Meta Crescer com margem.");
    expect(response.json().asset.extractedText).not.toContain("alert(1)");
    expect(resolver).toHaveBeenCalledWith("example.com");
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({
      pinnedAddress: "93.184.216.34",
      url: new URL("https://example.com/start")
    }));
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["link-local", "169.254.169.254"],
    ["RFC1918", "10.1.2.3"],
    ["IPv6 loopback", "::1"],
    ["IPv6 private", "fd00::1"],
    ["mapped private", "::ffff:192.168.1.8"],
    ["IPv4-compatible private", "::192.168.1.8"]
  ])("rejects %s link targets before transport", async (_label, address) => {
    const fetcher: StudioLinkFetcher = vi.fn();
    const fixture = await createFixture({ resolver: async () => [address], fetcher });
    const response = await fixture.app.inject({
      method: "POST",
      url: `/studio/documents/${fixture.documentId}/assets`,
      headers: ownerA,
      payload: { url: "http://unsafe.example/" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("STUDIO_LINK_TARGET_FORBIDDEN");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves and pins every redirect target and rejects more than three redirects", async () => {
    const resolver: StudioLinkResolver = vi.fn(async (hostname) => [
      hostname === "one.example" ? "93.184.216.31" : "93.184.216.32"
    ]);
    let requestCount = 0;
    const fetcher: StudioLinkFetcher = vi.fn(async () => {
      requestCount += 1;
      return {
        statusCode: 302,
        headers: { location: `https://${requestCount % 2 ? "two.example" : "one.example"}/${requestCount}` },
        body: Readable.from([])
      };
    });
    const fixture = await createFixture({ resolver, fetcher });

    const response = await fixture.app.inject({
      method: "POST",
      url: `/studio/documents/${fixture.documentId}/assets`,
      headers: ownerA,
      payload: { url: "https://one.example/start" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("STUDIO_LINK_REDIRECT_LIMIT");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(resolver).toHaveBeenCalledTimes(4);
  });

  it("rejects streamed link bodies above five MiB", async () => {
    const fixture = await createFixture({
      resolver: async () => ["93.184.216.34"],
      fetcher: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        body: Readable.from([Buffer.alloc(5 * 1024 * 1024), Buffer.from("x")])
      })
    });
    const response = await fixture.app.inject({
      method: "POST",
      url: `/studio/documents/${fixture.documentId}/assets`,
      headers: ownerA,
      payload: { url: "https://example.com/large" }
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("STUDIO_LINK_RESPONSE_TOO_LARGE");
  });

  it("aborts link transport after ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const fixture = await createFixture({
        resolver: async () => ["93.184.216.34"],
        fetcher: ({ signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
      });
      const pending = fixture.app.inject({
        method: "POST",
        url: `/studio/documents/${fixture.documentId}/assets`,
        headers: ownerA,
        payload: { url: "https://example.com/slow" }
      });
      await vi.advanceTimersByTimeAsync(10_001);
      const response = await pending;
      expect(response.statusCode).toBe(504);
      expect(response.json().error.code).toBe("STUDIO_LINK_TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the ten-second timeout while DNS resolution is pending", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: StudioLinkFetcher = vi.fn();
      const fixture = await createFixture({
        resolver: () => new Promise(() => undefined),
        fetcher
      });
      const pending = fixture.app.inject({
        method: "POST",
        url: `/studio/documents/${fixture.documentId}/assets`,
        headers: ownerA,
        payload: { url: "https://example.com/dns-slow" }
      });
      await vi.advanceTimersByTimeAsync(10_001);
      const response = await pending;
      expect(response.statusCode).toBe(504);
      expect(response.json().error.code).toBe("STUDIO_LINK_TIMEOUT");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

async function createFixture(link: {
  resolver?: StudioLinkResolver;
  fetcher?: StudioLinkFetcher;
} = {}) {
  const repository = createInMemoryStudioRepository();
  const document = await repository.createDocument(documentInput());
  const objectStorage = createInMemoryObjectStorage();
  return {
    app: buildApp({
      studioRepository: repository,
      objectStorage,
      studioLinkResolver: link.resolver,
      studioLinkFetcher: link.fetcher,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    }),
    repository,
    objectStorage,
    documentId: document.id
  };
}

function documentInput(): Parameters<StudioRepository["createDocument"]>[0] {
  return {
    workspaceId: "workspace_a",
    ownerProfileId: "owner_a",
    title: "Plano",
    bodyJson: { type: "doc", content: [] },
    bodyText: "Plano privado",
    captureMode: "text",
    inboxState: "pending_review",
    isFocused: false,
    status: "active"
  };
}

function upload(
  app: ReturnType<typeof buildApp>,
  documentId: string,
  file: { filename: string; mimeType: string; body: Buffer },
  headers: Record<string, string> = ownerA
) {
  const boundary = "----baase-studio-asset-boundary";
  const prefix = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"`,
    `Content-Type: ${file.mimeType}`,
    "",
    ""
  ].join("\r\n"));
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: "POST",
    url: `/studio/documents/${documentId}/assets`,
    headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([prefix, file.body, suffix])
  });
}
