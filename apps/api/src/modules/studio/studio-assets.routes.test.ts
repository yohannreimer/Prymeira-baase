import { request as createHttpRequest, type ClientRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createS3ObjectStorage } from "../../storage/s3-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import type { AiProvider } from "../ai/ai.types";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import type { StudioRepository } from "./studio.types";
import type { StudioLinkFetcher, StudioLinkResolver } from "./studio-assets.routes";
import { createStudioUploadSemaphore } from "./studio-asset-upload";

const ownerA = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "owner_a"
};

const ownerB = { ...ownerA, "x-baase-profile-id": "owner_b" };
const manager = { ...ownerA, "x-baase-role": "manager", "x-baase-profile-id": "manager_a" };
const employee = { ...ownerA, "x-baase-role": "employee", "x-baase-profile-id": "employee_a" };

function ownerScope() {
  return { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
}

describe("Studio asset routes", () => {
  it("lists persisted assets by document without accepting caller-selected scope", async () => {
    const fixture = await createFixture();
    const uploaded = await upload(fixture.app, fixture.documentId, {
      filename: "reflexao.wav", mimeType: "audio/wav", body: validWav()
    }, ownerA, "55555555-5555-4555-8555-555555555555");

    const listed = await fixture.app.inject({
      method: "GET", url: `/studio/documents/${fixture.documentId}/assets`, headers: ownerA
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().assets).toMatchObject([{ id: uploaded.json().asset.id, kind: "audio" }]);
    expect((await fixture.app.inject({
      method: "GET", url: `/studio/documents/${fixture.documentId}/assets`, headers: ownerB
    })).statusCode).toBe(404);
    expect((await fixture.app.inject({
      method: "GET", url: `/studio/documents/${fixture.documentId}/assets`, headers: employee
    })).statusCode).toBe(403);
    expect((await fixture.app.inject({
      method: "GET", url: `/studio/documents/${fixture.documentId}/assets?owner_profile_id=owner_b`, headers: ownerA
    })).statusCode).toBe(400);
  });

  it("reuses the same persisted asset after a lost file response", async () => {
    const fixture = await createFixture();
    const key = "66666666-6666-4666-8666-666666666666";
    const first = await upload(fixture.app, fixture.documentId, {
      filename: "plano.txt", mimeType: "text/plain", body: Buffer.from("privado")
    }, ownerA, key);
    const replay = await upload(fixture.app, fixture.documentId, {
      filename: "plano.txt", mimeType: "text/plain", body: Buffer.from("privado")
    }, ownerA, key);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().asset.id).toBe(first.json().asset.id);
    expect(fixture.objectStorage.keys()).toHaveLength(1);
    expect(await fixture.repository.listDocumentAssets(ownerScope(), fixture.documentId)).toHaveLength(1);
  });

  it("converges concurrent link retries to one owner-scoped asset", async () => {
    const fixture = await createFixture({
      resolver: async () => ["93.184.216.34"],
      fetcher: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        body: Readable.from(Buffer.from("<html><title>Direção</title><body>Crescer com qualidade</body></html>"))
      })
    });
    const request = {
      method: "POST" as const,
      url: `/studio/documents/${fixture.documentId}/assets`,
      headers: { ...ownerA, "idempotency-key": "77777777-7777-4777-8777-777777777777" },
      payload: { url: "https://example.com/plano" }
    };
    const [left, right] = await Promise.all([fixture.app.inject(request), fixture.app.inject(request)]);

    expect([left.statusCode, right.statusCode].every((status) => status === 200 || status === 201)).toBe(true);
    expect([left.statusCode, right.statusCode]).toContain(201);
    expect(right.json().asset.id).toBe(left.json().asset.id);
    expect(await fixture.repository.listDocumentAssets(ownerScope(), fixture.documentId)).toHaveLength(1);
  });

  it("rejects malformed asset idempotency keys before capture work starts", async () => {
    let fetchCalls = 0;
    const fixture = await createFixture({
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error("should not fetch");
      }
    });
    const response = await fixture.app.inject({
      method: "POST",
      url: `/studio/documents/${fixture.documentId}/assets`,
      headers: { ...ownerA, "idempotency-key": "not-a-uuid" },
      payload: { url: "https://example.com/plano" }
    });

    expect(response.statusCode).toBe(400);
    expect(fetchCalls).toBe(0);
  });

  it("exposes owner-scoped processing status and retries a preserved audio asset", async () => {
    let transcriptionCalls = 0;
    const aiProvider: AiProvider = {
      ...createMockAiProvider(),
      async generateStructured() {
        return {};
      },
      async transcribeAudio() {
        transcriptionCalls += 1;
        if (transcriptionCalls === 1) throw new Error("provider unavailable");
        return { text: "Escolher uma direção com calma.", confidence: 0.91, durationSeconds: 4 };
      }
    };
    const fixture = await createFixture({ aiProvider });
    const uploaded = await upload(fixture.app, fixture.documentId, {
      filename: "reflexao.wav",
      mimeType: "audio/wav",
      body: validWav()
    });
    const assetId = uploaded.json().asset.id as string;

    const pending = await fixture.app.inject({ method: "GET", url: `/studio/assets/${assetId}`, headers: ownerA });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().asset).toMatchObject({ extractionStatus: "pending", kind: "audio" });
    expect((await fixture.app.inject({ method: "GET", url: `/studio/assets/${assetId}`, headers: ownerB })).statusCode).toBe(404);
    expect((await fixture.app.inject({ method: "GET", url: `/studio/assets/${assetId}`, headers: employee })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: "POST", url: `/studio/assets/${assetId}/retry`, headers: manager })).statusCode).toBe(403);
    expect((await fixture.app.inject({
      method: "POST",
      url: `/studio/assets/${assetId}/retry?owner_profile_id=owner_b`,
      headers: ownerA,
      payload: {}
    })).statusCode).toBe(400);

    await expect(fixture.app.studioAssetProcessor.processNext()).rejects.toThrow("provider unavailable");
    const failed = await fixture.app.inject({ method: "GET", url: `/studio/assets/${assetId}`, headers: ownerA });
    expect(failed.json().asset).toMatchObject({
      extractionStatus: "failed",
      attemptCount: 1,
      lastErrorCode: "STUDIO_ASSET_PROCESSING_FAILED"
    });
    const download = await fixture.app.inject({ method: "GET", url: `/studio/assets/${assetId}/download`, headers: ownerA });
    expect(download.statusCode).toBe(200);

    const retried = await fixture.app.inject({ method: "POST", url: `/studio/assets/${assetId}/retry`, headers: ownerA, payload: {} });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().asset).toMatchObject({
      extractionStatus: "pending",
      attemptCount: 0,
      lastErrorCode: null,
      nextAttemptAt: null
    });

    await expect(fixture.app.studioAssetProcessor.processNext()).resolves.toMatchObject({ extractionStatus: "ready" });
    const ready = await fixture.app.inject({ method: "GET", url: `/studio/assets/${assetId}`, headers: ownerA });
    expect(ready.json().asset).toMatchObject({
      extractionStatus: "ready",
      extractedText: "Escolher uma direção com calma."
    });
    const idempotent = await fixture.app.inject({ method: "POST", url: `/studio/assets/${assetId}/retry`, headers: ownerA, payload: {} });
    expect(idempotent.statusCode).toBe(200);
    expect(idempotent.json().asset.extractionStatus).toBe("ready");
  });

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

  it("fails fast when the bounded upload spool is saturated", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const semaphore = createStudioUploadSemaphore(1);
    const release = semaphore.tryAcquire()!;
    try {
      const app = buildApp({ studioRepository: repository, studioUploadSemaphore: semaphore });
      const response = await upload(app, document.id, {
        filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("STUDIO_ASSET_UPLOAD_BUSY");
    } finally {
      release();
    }
  });

  it("times out a stalled multipart receive and releases its bounded owner after abort settlement", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const boundary = "----baase-studio-stalled-receive";
    const prefix = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="stalled.txt"',
      "Content-Type: text/plain",
      "",
      "partial"
    ].join("\r\n"));
    let started = false;
    const stalledBody = new Readable({
      read() {
        if (started) return;
        started = true;
        this.push(prefix);
      }
    });
    const semaphore = createStudioUploadSemaphore(1);
    const app = buildApp({
      studioRepository: repository,
      studioUploadSemaphore: semaphore,
      studioUploadPutTimeoutMs: 15,
      studioUploadLeaseMs: 100
    });

    const response = await app.inject({
      method: "POST",
      url: `/studio/documents/${document.id}/assets`,
      headers: { ...ownerA, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: stalledBody
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "OBJECT_STORAGE_UNAVAILABLE",
      details: { upload_timeout: true }
    });
    await vi.waitFor(() => {
      const release = semaphore.tryAcquire();
      expect(release).toBeTypeOf("function");
      release?.();
    });
    expect(await repository.listAssetUploadIntents(ownerScope())).toEqual([]);
    stalledBody.destroy();
  });

  it("flushes a structured timeout before closing a live stalled multipart connection", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const semaphore = createStudioUploadSemaphore(1);
    const app = buildApp({
      studioRepository: repository,
      studioUploadSemaphore: semaphore,
      studioUploadPutTimeoutMs: 50,
      studioUploadLeaseMs: 200
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const boundary = "----baase-studio-live-stalled-receive";
    const clientErrors: NodeJS.ErrnoException[] = [];
    let client: ClientRequest | undefined;
    try {
      let responseStarted = false;
      let resolveConnectionClosed!: () => void;
      const connectionClosed = new Promise<void>((resolve) => {
        resolveConnectionClosed = resolve;
      });
      const response = await new Promise<{ statusCode: number | undefined; body: string }>((resolve, reject) => {
        client = createHttpRequest({
          host: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: `/studio/documents/${document.id}/assets`,
          headers: {
            ...ownerA,
            connection: "keep-alive",
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "transfer-encoding": "chunked"
          }
        }, (incoming) => {
          responseStarted = true;
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          incoming.on("end", () => resolve({
            statusCode: incoming.statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          }));
        });
        client.on("error", (error: NodeJS.ErrnoException) => {
          clientErrors.push(error);
          if (!responseStarted) reject(error);
        });
        client.on("close", resolveConnectionClosed);
        client.flushHeaders();
        client.write([
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="stalled.txt"'
        ].join("\r\n"));
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).error).toMatchObject({
        code: "OBJECT_STORAGE_UNAVAILABLE",
        details: { upload_timeout: true }
      });
      await connectionClosed;
      expect(clientErrors).toEqual([]);
      expect(client!.destroyed).toBe(true);
      await vi.waitFor(() => {
        const release = semaphore.tryAcquire();
        expect(release).toBeTypeOf("function");
        release?.();
      });
    } finally {
      client?.destroy();
      await app.close();
    }
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

  it("transitions the durable upload intent to cleanup after a crash following object put", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const objectStorage = createInMemoryObjectStorage();
    const app = buildApp({
      objectStorage,
      studioRepository: {
        ...repository,
        async finalizeAssetUpload() {
          throw new Error("database unavailable");
        }
      }
    });

    const response = await upload(app, document.id, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("STUDIO_ASSET_PERSISTENCE_FAILED");
    expect(response.json().error.details).toEqual({ cleanup_pending: true });
    expect(objectStorage.keys()).toHaveLength(1);
    expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{
      status: "cleanup_pending",
      objectKey: objectStorage.keys()[0]
    }]);
  });

  it("reconciles an ambiguous commit to the valid asset without scheduling object deletion", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const objectStorage = createInMemoryObjectStorage();
    const app = buildApp({
      objectStorage,
      studioRepository: {
        ...repository,
        async finalizeAssetUpload(input) {
          await repository.finalizeAssetUpload(input);
          throw new Error("commit result lost");
        }
      }
    });
    const response = await upload(app, document.id, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().asset.objectKey).toBe(objectStorage.keys()[0]);
    expect(objectStorage.keys()).toHaveLength(1);
    expect(await repository.listAssetUploadIntents(ownerScope())).toEqual([]);
  });

  it("disarms the storage deadline after Complete and awaits one idempotent durable finalization", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]
    });
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const memoryStorage = createInMemoryObjectStorage();
    const lifecycle: string[] = [];
    const objectStorage = {
      ...memoryStorage,
      async completeAtomicUploadFromStream(
        input: Parameters<typeof memoryStorage.completeAtomicUploadFromStream>[0],
        options?: { signal?: AbortSignal }
      ) {
        await memoryStorage.completeAtomicUploadFromStream(input, options);
        lifecycle.push("complete");
      }
    };
    let releaseFinalize: (() => void) | undefined;
    const finalizeGate = new Promise<void>((resolve) => { releaseFinalize = resolve; });
    let finalizeStarted!: () => void;
    const started = new Promise<void>((resolve) => { finalizeStarted = resolve; });
    let captured: Parameters<typeof repository.finalizeAssetUpload>[0] | undefined;
    let finalizeCalls = 0;
    const app = buildApp({
      objectStorage,
      studioRepository: {
        ...repository,
        async finalizeAssetUpload(input) {
          finalizeCalls += 1;
          captured = input;
          lifecycle.push("finalize");
          finalizeStarted();
          await finalizeGate;
          return repository.finalizeAssetUpload(input);
        }
      },
      studioUploadPutTimeoutMs: 15,
      studioUploadLeaseMs: 100,
      studioUploadLeaseHeartbeatMs: 5
    });
    let pending: ReturnType<typeof upload> | undefined;
    try {
      pending = upload(app, document.id, {
        filename: "slow-finalize.txt", mimeType: "text/plain", body: Buffer.from("private")
      });
      await started;
      expect(lifecycle).toEqual(["complete", "finalize"]);
      expect(memoryStorage.keys()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(30);
      releaseFinalize!();

      const response = await pending;
      expect(response.statusCode).toBe(201);
      expect(finalizeCalls).toBe(1);
      expect(memoryStorage.keys()).toHaveLength(1);
      expect(response.json().asset.objectKey).toBe(memoryStorage.keys()[0]);
      expect(await repository.listAssetUploadIntents(ownerScope())).toEqual([]);
      const retry = await repository.finalizeAssetUpload(captured!);
      expect(retry.id).toBe(response.json().asset.id);
      expect(await repository.findAssetByObjectKey(ownerScope(), retry.objectKey!)).toMatchObject({ id: retry.id });
    } finally {
      releaseFinalize?.();
      vi.useRealTimers();
      await pending?.catch(() => undefined);
    }
  });

  it("leaves the durable pending intent when reconciliation is temporarily unavailable", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const document = await repository.createDocument(documentInput());
    const objectStorage = createInMemoryObjectStorage();
    const app = buildApp({
      objectStorage,
      studioRepository: {
        ...repository,
        async finalizeAssetUpload() { throw new Error("database unavailable"); },
        async reconcileAssetUploadFailure() { throw new Error("database unavailable"); }
      },
      now: () => new Date(clock)
    });
    const response = await upload(app, document.id, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "STUDIO_ASSET_PERSISTENCE_FAILED",
      details: { upload_intent_pending: true }
    });
    expect(objectStorage.keys()).toHaveLength(1);
    expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{ status: "uploading" }]);
    clock = "2026-07-13T12:15:00.000Z";
    await app.studioAssetUploadCleanupProcessor.processNext();
    expect(objectStorage.keys()).toEqual([]);
    expect(await repository.listAssetUploadIntents(ownerScope())).toEqual([]);
  });

  it("keeps a slow multipart completion leased beyond the former fifteen-minute cleanup threshold", async () => {
    let clock = new Date("2026-07-13T12:00:00.000Z");
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    const repository = createInMemoryStudioRepository({ now: () => clock.toISOString() });
    const document = await repository.createDocument(documentInput());
    const memoryStorage = createInMemoryObjectStorage();
    const objectStorage = {
      ...memoryStorage,
      async completeAtomicUploadFromStream(
        input: Parameters<typeof memoryStorage.completeAtomicUploadFromStream>[0],
        options?: { signal?: AbortSignal }
      ) {
        await putGate;
        return memoryStorage.completeAtomicUploadFromStream(input, options);
      }
    };
    const app = buildApp({
      studioRepository: repository,
      objectStorage,
      now: () => clock,
      studioUploadPutTimeoutMs: 20 * 60_000,
      studioUploadLeaseMs: 30 * 60_000,
      studioUploadLeaseHeartbeatMs: 60 * 60_000
    });
    const pending = upload(app, document.id, {
      filename: "slow.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    await vi.waitFor(async () => {
      expect(await repository.listAssetUploadIntents(ownerScope())).toHaveLength(1);
    });
    clock = new Date("2026-07-13T12:16:00.000Z");
    expect(await repository.claimNextAssetUploadCleanup(clock.toISOString())).toBeNull();
    releasePut();
    expect((await pending).statusCode).toBe(201);
    expect(await repository.listAssetUploadIntents(ownerScope())).toEqual([]);
  });

  it("aborts multipart completion at its hard deadline and moves the intent to cleanup", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-13T12:00:00.000Z" });
    const document = await repository.createDocument(documentInput());
    const memoryStorage = createInMemoryObjectStorage();
    let abortObserved = false;
    const objectStorage = {
      ...memoryStorage,
      async completeAtomicUploadFromStream(
        _input: Parameters<typeof memoryStorage.completeAtomicUploadFromStream>[0],
        options?: { signal?: AbortSignal }
      ) {
        return new Promise<void>((_resolve, reject) => {
          const abort = () => {
            abortObserved = true;
            reject(options?.signal?.reason);
          };
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
    };
    const app = buildApp({
      studioRepository: repository,
      objectStorage,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      studioUploadPutTimeoutMs: 15,
      studioUploadLeaseMs: 100,
      studioUploadLeaseHeartbeatMs: 20
    });
    const response = await upload(app, document.id, {
      filename: "timeout.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "OBJECT_STORAGE_UNAVAILABLE",
      details: { upload_timeout: true }
    });
    expect(abortObserved).toBe(true);
    await vi.waitFor(async () => {
      expect(await repository.listAssetUploadIntents(ownerScope()))
        .toMatchObject([{ status: "cleanup_pending" }]);
    });
  });

  it("returns at the deadline while an abort-ignoring begin retains ownership until late settlement", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-13T12:00:00.000Z" });
    const document = await repository.createDocument(documentInput());
    const memoryStorage = createInMemoryObjectStorage();
    let releaseBegin!: () => void;
    const beginGate = new Promise<void>((resolve) => { releaseBegin = resolve; });
    let beginCalls = 0;
    const semaphore = createStudioUploadSemaphore(1);
    const objectStorage = {
      ...memoryStorage,
      async beginAtomicUpload(
        input: Parameters<typeof memoryStorage.beginAtomicUpload>[0],
        options?: { signal?: AbortSignal }
      ) {
        beginCalls += 1;
        if (beginCalls === 1) await beginGate;
        return memoryStorage.beginAtomicUpload(input, beginCalls === 1 ? undefined : options);
      }
    };
    const app = buildApp({
      studioRepository: repository,
      objectStorage,
      studioUploadSemaphore: semaphore,
      studioUploadPutTimeoutMs: 15,
      studioUploadLeaseMs: 100
    });

    const response = await upload(app, document.id, {
      filename: "stalled-begin.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.details).toEqual({ upload_timeout: true });
    expect((await upload(app, document.id, {
      filename: "busy.txt", mimeType: "text/plain", body: Buffer.from("private")
    })).json().error.code).toBe("STUDIO_ASSET_UPLOAD_BUSY");
    expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{
      status: "uploading",
      storageSessionState: "creating",
      storageUploadId: null
    }]);

    releaseBegin();
    await vi.waitFor(async () => {
      expect(memoryStorage.atomicUploadIds()).toEqual([]);
      expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{
        status: "cleanup_pending",
        storageSessionState: "abort_pending",
        storageUploadId: expect.any(String)
      }]);
    });
    await vi.waitFor(() => {
      const release = semaphore.tryAcquire();
      expect(release).toBeTypeOf("function");
      release?.();
    });
  });

  it("returns at the deadline while an abort-ignoring attach retains ownership until late settlement", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-13T12:00:00.000Z" });
    const document = await repository.createDocument(documentInput());
    const memoryStorage = createInMemoryObjectStorage();
    let releaseAttach!: () => void;
    const attachGate = new Promise<void>((resolve) => { releaseAttach = resolve; });
    let attachCalls = 0;
    const semaphore = createStudioUploadSemaphore(1);
    const app = buildApp({
      studioRepository: {
        ...repository,
        async attachAssetUploadSession(input) {
          attachCalls += 1;
          if (attachCalls === 1) await attachGate;
          return repository.attachAssetUploadSession(input);
        }
      },
      objectStorage: memoryStorage,
      studioUploadSemaphore: semaphore,
      studioUploadPutTimeoutMs: 15,
      studioUploadLeaseMs: 100
    });

    const response = await upload(app, document.id, {
      filename: "stalled-attach.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.details).toEqual({ upload_timeout: true });
    expect((await upload(app, document.id, {
      filename: "busy.txt", mimeType: "text/plain", body: Buffer.from("private")
    })).json().error.code).toBe("STUDIO_ASSET_UPLOAD_BUSY");
    expect(memoryStorage.atomicUploadIds()).toHaveLength(1);

    releaseAttach();
    await vi.waitFor(async () => {
      expect(memoryStorage.atomicUploadIds()).toEqual([]);
      expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{
        status: "cleanup_pending",
        storageSessionState: "abort_pending",
        storageUploadId: expect.any(String)
      }]);
    });
    await vi.waitFor(() => {
      const release = semaphore.tryAcquire();
      expect(release).toBeTypeOf("function");
      release?.();
    });
  });

  it.each(["false", "error"] as const)(
    "aborts immediately when multipart lease renewal returns %s",
    async (renewalFailure) => {
      const repository = createInMemoryStudioRepository({ now: () => "2026-07-13T12:00:00.000Z" });
      const document = await repository.createDocument(documentInput());
      const memoryStorage = createInMemoryObjectStorage();
      let releasePart!: () => void;
      const partGate = new Promise<void>((resolve) => { releasePart = resolve; });
      let abortObserved = false;
      const objectStorage = {
        ...memoryStorage,
        async completeAtomicUploadFromStream(
          input: Parameters<typeof memoryStorage.completeAtomicUploadFromStream>[0],
          options?: { signal?: AbortSignal }
        ) {
          options?.signal?.addEventListener("abort", () => { abortObserved = true; }, { once: true });
          await partGate;
          return memoryStorage.completeAtomicUploadFromStream({ ...input, body: Readable.from("private") });
        }
      };
      const app = buildApp({
        studioRepository: {
          ...repository,
          async renewAssetUploadIntentLease() {
            if (renewalFailure === "error") throw new Error("database unavailable");
            return false;
          }
        },
        objectStorage,
        studioUploadPutTimeoutMs: 1_000,
        studioUploadLeaseMs: 2_000,
        studioUploadLeaseHeartbeatMs: 5
      });
      const response = await upload(app, document.id, {
        filename: `lease-${renewalFailure}.txt`, mimeType: "text/plain", body: Buffer.from("private")
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toMatchObject({
        code: "OBJECT_STORAGE_UNAVAILABLE",
        details: { upload_lease_lost: true }
      });
      expect(abortObserved).toBe(true);
      expect(memoryStorage.keys()).toEqual([]);
      expect(memoryStorage.atomicUploadIds()).toHaveLength(1);
      expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{
        status: "uploading",
        storageSessionState: "active"
      }]);
      releasePart();
      await vi.waitFor(async () => {
        expect(memoryStorage.atomicUploadIds()).toEqual([]);
        expect(await repository.listAssetUploadIntents(ownerScope())).toMatchObject([{
          status: "cleanup_pending",
          storageSessionState: "abort_pending"
        }]);
      });
    }
  );

  it("releases the request while an abort-ignoring part settles late without publishing", async () => {
    let clock = new Date("2026-07-13T12:00:00.000Z");
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    const repository = createInMemoryStudioRepository({ now: () => clock.toISOString() });
    const document = await repository.createDocument(documentInput());
    const memoryStorage = createInMemoryObjectStorage();
    let abortObserved = false;
    let completionCalls = 0;
    let lateBody = "";
    const objectStorage = {
      ...memoryStorage,
      async completeAtomicUploadFromStream(
        input: Parameters<typeof memoryStorage.completeAtomicUploadFromStream>[0],
        options?: { signal?: AbortSignal }
      ) {
        completionCalls += 1;
        if (completionCalls > 1) return memoryStorage.completeAtomicUploadFromStream(input, options);
        options?.signal?.addEventListener("abort", () => { abortObserved = true; }, { once: true });
        await putGate;
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        lateBody = Buffer.concat(chunks).toString("utf8");
      }
    };
    const app = buildApp({
      studioRepository: repository,
      objectStorage,
      studioUploadSemaphore: createStudioUploadSemaphore(1),
      now: () => clock,
      studioUploadPutTimeoutMs: 15,
      studioUploadLeaseMs: 100,
      studioUploadLeaseHeartbeatMs: 5
    });
    const response = await upload(app, document.id, {
      filename: "late.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(response.statusCode).toBe(503);
    expect(abortObserved).toBe(true);
    clock = new Date("2026-07-13T12:16:00.000Z");
    await app.studioAssetUploadCleanupProcessor.processNext();
    expect(memoryStorage.keys()).toEqual([]);
    expect(await repository.listAssetUploadIntents(ownerScope())).toEqual([]);
    const next = await upload(app, document.id, {
      filename: "next.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(next.statusCode).toBe(503);
    expect(next.json().error.code).toBe("STUDIO_ASSET_UPLOAD_BUSY");
    releasePut();
    await vi.waitFor(async () => {
      const released = await upload(app, document.id, {
        filename: "released.txt", mimeType: "text/plain", body: Buffer.from("private")
      });
      expect(released.statusCode).toBe(201);
    });
    const publishedKeys = [...memoryStorage.keys()];
    expect(publishedKeys).toHaveLength(1);
    expect(memoryStorage.keys()).toEqual(publishedKeys);
    expect(lateBody).toBe("private");
  });

  it("bounds ignored multipart part buffers and owners to configured concurrency", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const pendingParts = new Map<number, Buffer>();
    const partResolvers = new Map<number, (value: { ETag: string }) => void>();
    let uploadNumber = 0;
    let stallParts = true;
    const commands: unknown[] = [];
    const client = {
      send: vi.fn((command: unknown) => {
        commands.push(command);
        if (command instanceof HeadBucketCommand) return Promise.resolve({});
        if (command instanceof CreateMultipartUploadCommand) {
          return Promise.resolve({ UploadId: `upload-${++uploadNumber}` });
        }
        if (command instanceof UploadPartCommand) {
          if (!stallParts) return Promise.resolve({ ETag: "released-etag" });
          const id = Number(command.input.UploadId?.split("-").at(-1));
          pendingParts.set(id, command.input.Body as Buffer);
          return new Promise<{ ETag: string }>((resolve) => {
            partResolvers.set(id, (value) => {
              pendingParts.delete(id);
              resolve(value);
            });
          });
        }
        if (command instanceof AbortMultipartUploadCommand) return Promise.resolve({});
        if (command instanceof CompleteMultipartUploadCommand) return Promise.resolve({});
        return Promise.reject(new Error("unexpected command"));
      })
    };
    const objectStorage = createS3ObjectStorage({
      region: "us-east-1",
      bucket: "private",
      accessKeyId: "test",
      secretAccessKey: "test",
      forcePathStyle: true
    }, client);
    const app = buildApp({
      studioRepository: repository,
      objectStorage,
      studioUploadSemaphore: createStudioUploadSemaphore(2),
      studioUploadPutTimeoutMs: 2_000,
      studioUploadLeaseMs: 4_000
    });
    const body = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const first = upload(app, document.id, { filename: "first.txt", mimeType: "text/plain", body });
    const second = upload(app, document.id, { filename: "second.txt", mimeType: "text/plain", body });
    await vi.waitFor(() => expect(pendingParts.size).toBe(2));
    expect([...pendingParts.values()].every((part) => part.length <= 5 * 1024 * 1024)).toBe(true);
    expect((await first).statusCode).toBe(503);
    expect((await second).statusCode).toBe(503);
    const busy = await upload(app, document.id, {
      filename: "third.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    expect(busy.statusCode).toBe(503);
    expect(busy.json().error.code).toBe("STUDIO_ASSET_UPLOAD_BUSY");

    partResolvers.get(1)!({ ETag: "etag-1" });
    partResolvers.get(2)!({ ETag: "etag-2" });
    await vi.waitFor(() => expect(pendingParts.size).toBe(0));
    expect(commands.some((command) => command instanceof CompleteMultipartUploadCommand)).toBe(false);
    stallParts = false;
    await vi.waitFor(async () => {
      const released = await upload(app, document.id, {
        filename: "released.txt", mimeType: "text/plain", body: Buffer.from("private")
      });
      expect(released.statusCode).toBe(201);
    });
    expect(commands.filter((command) => command instanceof CompleteMultipartUploadCommand)).toHaveLength(1);
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
    expect(removed.statusCode).toBe(204);
    expect(fixture.objectStorage.keys()).toEqual([]);
    expect(await fixture.repository.findAsset(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }, assetId
    )).toBeNull();
    expect(await fixture.repository.findAssetIncludingDeleting(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }, assetId
    )).toBeNull();
  });

  it("returns accepted with a durable tombstone when immediate storage cleanup fails", async () => {
    const fixture = await createFixture();
    const uploaded = await upload(fixture.app, fixture.documentId, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    const assetId = uploaded.json().asset.id as string;
    fixture.objectStorage.failNextDelete(new Error("storage unavailable"));

    const removed = await fixture.app.inject({
      method: "DELETE", url: `/studio/assets/${assetId}`, headers: ownerA
    });
    expect(removed.statusCode).toBe(202);
    expect(removed.json()).toEqual({ ok: true, cleanup_pending: true });
    expect(await fixture.repository.findAssetIncludingDeleting(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }, assetId
    )).toMatchObject({ lifecycleStatus: "deleting" });
    expect(await fixture.repository.listAssetCleanupJobs(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }
    )).toHaveLength(1);
  });

  it("returns accepted and retains the tombstone when immediate database finalization fails", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument(documentInput());
    const objectStorage = createInMemoryObjectStorage();
    const app = buildApp({
      objectStorage,
      studioRepository: {
        ...repository,
        async completeAssetCleanup() { throw new Error("database unavailable"); }
      }
    });
    const uploaded = await upload(app, document.id, {
      filename: "notes.txt", mimeType: "text/plain", body: Buffer.from("private")
    });
    const assetId = uploaded.json().asset.id as string;
    const removed = await app.inject({ method: "DELETE", url: `/studio/assets/${assetId}`, headers: ownerA });
    expect(removed.statusCode).toBe(202);
    expect(await repository.findAssetIncludingDeleting(ownerScope(), assetId))
      .toMatchObject({ lifecycleStatus: "deleting" });
    expect(await repository.listAssetCleanupJobs(ownerScope())).toHaveLength(1);
  });

  it("rejects spoofed PDF/audio signatures and extra multipart fields", async () => {
    const fixture = await createFixture();
    for (const candidate of [
      { filename: "fake.pdf", mimeType: "application/pdf", body: Buffer.from("plain text") },
      { filename: "fake.mp3", mimeType: "audio/mpeg", body: Buffer.from("plain text") }
    ]) {
      const response = await upload(fixture.app, fixture.documentId, candidate);
      expect(response.statusCode).toBe(415);
      expect(response.json().error.code).toBe("STUDIO_ASSET_MIME_MISMATCH");
    }

    const multipartCases = [
      [
        'Content-Disposition: form-data; name="note"', "", "not allowed",
        "PART", 'Content-Disposition: form-data; name="file"; filename="notes.txt"',
        "Content-Type: text/plain", "", "private"
      ],
      [
        'Content-Disposition: form-data; name="file"; filename="notes.txt"',
        "Content-Type: text/plain", "", "private",
        "PART", 'Content-Disposition: form-data; name="note"', "", "not allowed"
      ],
      [
        'Content-Disposition: form-data; name="file"; filename="notes.txt"',
        "Content-Type: text/plain", "", "private",
        "PART", 'Content-Disposition: form-data; name="file"; filename="second.txt"',
        "Content-Type: text/plain", "", "not allowed"
      ]
    ];
    for (const [index, parts] of multipartCases.entries()) {
      const boundary = `----baase-studio-extra-part-${index}`;
      const payload = Buffer.from([
        `--${boundary}`,
        ...parts.flatMap((part) => part === "PART" ? [`--${boundary}`] : [part]),
        `--${boundary}--`,
        ""
      ].join("\r\n"));
      const extra = await fixture.app.inject({
        method: "POST",
        url: `/studio/documents/${fixture.documentId}/assets`,
        headers: { ...ownerA, "content-type": `multipart/form-data; boundary=${boundary}` },
        payload
      });
      expect(extra.statusCode, `multipart case ${index}`).toBe(400);
      expect(extra.json().error.code).toBe("STUDIO_ASSET_MULTIPART_INVALID");
    }
    expect(fixture.objectStorage.keys()).toEqual([]);
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
  aiProvider?: AiProvider;
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
      aiProvider: link.aiProvider,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    }),
    repository,
    objectStorage,
    documentId: document.id
  };
}

function validWav() {
  const dataBytes = 8;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
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
  headers: Record<string, string> = ownerA,
  idempotencyKey?: string
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
    headers: {
      ...headers,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload: Buffer.concat([prefix, file.body, suffix])
  });
}
