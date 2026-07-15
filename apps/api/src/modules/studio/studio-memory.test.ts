import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import type { OperationalPool } from "../../db/operational-repository-support";
import { createPostgresStudioMemoryIndex, StudioVectorPrerequisiteError } from "./postgres-studio-memory";
import {
  STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES,
  STUDIO_MEMORY_CHUNK_OVERLAP_GRAPHEMES,
  chunkStudioText,
  createInMemoryStudioMemoryIndex,
  createStudioMemoryIndexProcessor,
  embedStudioTexts,
  type StudioMemoryEmbedder,
  type StudioMemoryIndex
} from "./studio-memory";
import { createStudioService } from "./studio.service";
import type { StudioDocument, StudioDocumentVersion, StudioOwnerScope } from "./studio.types";

const ownerA = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
const ownerB = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };
const fixedNow = "2026-07-14T12:00:00.000Z";

describe("Studio semantic memory", () => {
  it("keeps vector setup out of pg-mem migrations and scopes SQL before distance ranking", () => {
    const schema = readFileSync(resolve(process.cwd(), "src/db/operational-schema.ts"), "utf8");
    const adapter = readFileSync(resolve(process.cwd(), "src/modules/studio/postgres-studio-memory.ts"), "utf8");
    expect(schema).not.toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(schema).not.toContain("studio_memory_chunks");
    expect(adapter).toContain("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public");
    const scopedFilter = adapter.indexOf("WHERE workspace_id=$1 AND owner_profile_id=$2");
    const distance = adapter.indexOf("OPERATOR(public.<=>)");
    expect(scopedFilter).toBeGreaterThan(-1);
    expect(distance).toBeGreaterThan(scopedFilter);
    expect(adapter).toContain("SELECT pg_advisory_xact_lock($1,$2)");
    expect(adapter).toContain("row.revision !== expected.documentRevision");
    expect(adapter).toContain("row.version_id !== expected.versionId");
    expect(adapter).toContain("claim_token=$6 AND lease_expires_at IS NOT NULL AND lease_expires_at>NOW()");
  });

  it("chunks at paragraph boundaries without breaking Unicode and keeps bounded overlap", () => {
    const first = "🧭".repeat(1_100);
    const second = "ação ".repeat(180);
    const chunks = chunkStudioText(`${first}\n\n${second}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => graphemeLength(chunk) <= STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES)).toBe(true);
    expect(chunks.join("")).not.toContain("�");
    const overlap = [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(chunks[0]!)]
      .slice(-STUDIO_MEMORY_CHUNK_OVERLAP_GRAPHEMES).map((item) => item.segment).join("").trim();
    expect(chunks[1]).toContain(overlap);
  });

  it("isolates owners, excludes the source, and lets lexical evidence rescue a weaker vector", async () => {
    const embedder = conditionalEmbedder((input) => {
      if (input === "fluxo caixa urgente") return [1, 0];
      if (input.includes("fluxo caixa urgente")) return [0.8, 0.6];
      return [1, 0];
    });
    const memory = createInMemoryStudioMemoryIndex({ embedder, now: () => fixedNow });
    const semantic = fixture(ownerA, "semantic", "Planejar contratações", 1);
    const lexical = fixture(ownerA, "lexical", "fluxo caixa urgente para amanhã", 1);
    const privateOther = fixture(ownerB, "private", "fluxo caixa urgente sigiloso", 1);
    await memory.indexVersion(ownerA, semantic.document, semantic.version);
    await memory.indexVersion(ownerA, lexical.document, lexical.version);
    await memory.indexVersion(ownerB, privateOther.document, privateOther.version);

    const results = await memory.findRelated(ownerA, {
      documentId: semantic.document.id,
      query: "fluxo caixa urgente",
      limit: 10
    });

    expect(results.map((item) => item.documentId)).toEqual([lexical.document.id]);
    expect(results[0]!.lexicalScore).toBe(1);
    expect(results.every((item) => item.documentId !== privateOther.document.id)).toBe(true);
  });

  it("atomically replaces a version, ignores stale jobs, and removes a document", async () => {
    const memory = createInMemoryStudioMemoryIndex({ embedder: constantEmbedder(), now: () => fixedNow });
    const original = fixture(ownerA, "doc", "texto original", 1);
    await memory.indexVersion(ownerA, original.document, original.version);
    await memory.indexVersion(ownerA, original.document, {
      ...original.version,
      bodyText: "texto substituído sem vestígio"
    });
    let result = await memory.findRelated(ownerA, { query: "substituído", limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]!.excerpt).not.toContain("original");

    const newest = { ...original.version, id: "version_2", versionNumber: 2, bodyText: "versão mais nova" };
    await memory.indexVersion(ownerA, original.document, newest);
    await memory.indexVersion(ownerA, original.document, original.version);
    result = await memory.findRelated(ownerA, { query: "versão", limit: 10 });
    expect(result[0]).toMatchObject({ versionId: "version_2" });

    await memory.removeDocument(ownerA, original.document.id);
    await expect(memory.findRelated(ownerA, { query: "versão", limit: 10 })).resolves.toEqual([]);
  });

  it("uses deterministic tie ordering and stable cursors with a bounded limit", async () => {
    const memory = createInMemoryStudioMemoryIndex({ embedder: constantEmbedder(), now: () => fixedNow });
    for (const id of ["c", "a", "b"]) {
      const item = fixture(ownerA, id, "mesmo conteúdo", 1);
      await memory.indexVersion(ownerA, item.document, item.version);
    }
    const first = await memory.findRelated(ownerA, { query: "conteúdo", limit: 2 });
    const second = await memory.findRelated(ownerA, { query: "conteúdo", limit: 2, cursor: first[1]!.cursor });
    expect(first.map((item) => item.documentId)).toEqual(["a", "b"]);
    expect(second.map((item) => item.documentId)).toEqual(["c"]);
    await expect(memory.findRelated(ownerA, { query: "x", limit: 2, cursor: "bad!" }))
      .rejects.toThrow("STUDIO_MEMORY_CURSOR_INVALID");
  });

  it("batches embeddings and rejects provider count, dimension, and finite-value violations", async () => {
    const calls: string[][] = [];
    const dimensions: Array<number | undefined> = [];
    const embedder: StudioMemoryEmbedder = {
      async createEmbeddings(input) {
        calls.push(input.inputs);
        dimensions.push(input.dimensions);
        return input.inputs.map(() => [1, 0]);
      }
    };
    await expect(embedStudioTexts(embedder, "model", ["a", "b", "c", "d", "e"], 2, 2))
      .resolves.toHaveLength(5);
    expect(calls.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(dimensions).toEqual([2, 2, 2]);
    await expect(embedStudioTexts({ createEmbeddings: async () => [] }, "model", ["a"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_LENGTH_MISMATCH");
    await expect(embedStudioTexts({ createEmbeddings: async () => [[1], [1, 2]] }, "model", ["a", "b"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_DIMENSION_MISMATCH");
    await expect(embedStudioTexts({ createEmbeddings: async () => [[Number.NaN]] }, "model", ["a"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_NON_FINITE");
    await expect(embedStudioTexts({ createEmbeddings: async () => [[0, 0]] }, "model", ["a"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_ZERO_VECTOR");
  });

  it("indexes a version with 1536-dimensional mock embeddings", async () => {
    const memory = createInMemoryStudioMemoryIndex({
      embedder: createMockAiProvider(),
      dimensions: 1_536
    });
    const item = fixture(ownerA, "mock-1536", "conteúdo indexável", 1);

    await expect(memory.indexVersion(ownerA, item.document, item.version)).resolves.toBe(true);
  });

  it("enqueues every committed version and records index failure independently from saved content", async () => {
    let clock = "2026-07-14T10:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const service = createStudioService(repository, { now: () => clock });
    const document = await service.createDocument(ownerA, "owner_a", {
      title: "Privado",
      body_json: {},
      body_text: "continua salvo",
      capture_mode: "text"
    });
    clock = "2026-07-14T10:01:00.000Z";
    await service.updateDocument(ownerA, "owner_a", document.id, {
      revision: document.revision,
      body_text: "continua salvo após edição"
    });
    expect(await repository.listIndexJobs(ownerA)).toHaveLength(2);

    const processor = createStudioMemoryIndexProcessor({
      repository,
      memoryIndex: createInMemoryStudioMemoryIndex({
        embedder: { createEmbeddings: vi.fn(async () => { throw new Error("PROVIDER_DOWN"); }) }
      }),
      now: () => clock
    });
    await expect(processor.processNext()).rejects.toThrow("PROVIDER_DOWN");
    expect((await repository.listIndexJobs(ownerA))[0]).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "PROVIDER_DOWN"
    });
    await expect(repository.findDocument(ownerA, document.id)).resolves.toMatchObject({
      bodyText: "continua salvo após edição"
    });
  });

  it("prevents a stale archive generation from deleting a newer restored index", async () => {
    let clock = "2026-07-14T10:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const service = createStudioService(repository, { now: () => clock });
    const baseMemory = createInMemoryStudioMemoryIndex({ embedder: constantEmbedder(), now: () => clock });
    const created = await service.createDocument(ownerA, "owner_a", input("conteúdo restaurado"));
    const initialProcessor = createStudioMemoryIndexProcessor({ repository, memoryIndex: baseMemory, now: () => clock });
    await initialProcessor.processNext();

    clock = "2026-07-14T10:00:01.000Z";
    await service.archiveDocument(ownerA, "owner_a", created.id);
    let releaseArchive!: () => void;
    const archiveBarrier = new Promise<void>((resolve) => { releaseArchive = resolve; });
    let archiveEntered!: () => void;
    const enteredArchive = new Promise<void>((resolve) => { archiveEntered = resolve; });
    const delayedMemory: StudioMemoryIndex = {
      indexVersion: (...args) => baseMemory.indexVersion(...args),
      async removeDocument(...args) {
        archiveEntered();
        await archiveBarrier;
        return baseMemory.removeDocument(...args);
      },
      findRelated: (...args) => baseMemory.findRelated(...args)
    };
    const staleProcessor = createStudioMemoryIndexProcessor({ repository, memoryIndex: delayedMemory, now: () => clock });
    const staleArchive = staleProcessor.processNext();
    await enteredArchive;

    clock = "2026-07-14T10:00:02.000Z";
    await service.restoreDocument(ownerA, "owner_a", created.id);
    const restoreProcessor = createStudioMemoryIndexProcessor({ repository, memoryIndex: baseMemory, now: () => clock });
    await restoreProcessor.processNext();
    releaseArchive();
    await staleArchive;

    const related = await baseMemory.findRelated(ownerA, { query: "restaurado", limit: 10 });
    expect(related).toHaveLength(1);
    expect(related[0]).toMatchObject({ documentId: created.id });
  });

  it("prevents stale active indexing from recreating memory after a newer archive", async () => {
    let clock = "2026-07-14T10:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const service = createStudioService(repository, { now: () => clock });
    let releaseEmbedding!: () => void;
    const embeddingBarrier = new Promise<void>((resolve) => { releaseEmbedding = resolve; });
    let embeddingEntered!: () => void;
    const enteredEmbedding = new Promise<void>((resolve) => { embeddingEntered = resolve; });
    const memory = createInMemoryStudioMemoryIndex({
      embedder: {
        async createEmbeddings({ inputs }) {
          if (inputs.some((value) => value.includes("edição lenta"))) {
            embeddingEntered();
            await embeddingBarrier;
          }
          return inputs.map(() => [1, 0]);
        }
      },
      now: () => clock
    });
    const created = await service.createDocument(ownerA, "owner_a", input("conteúdo inicial"));
    await createStudioMemoryIndexProcessor({ repository, memoryIndex: memory, now: () => clock }).processNext();
    clock = "2026-07-14T10:00:01.000Z";
    await service.updateDocument(ownerA, "owner_a", created.id, {
      revision: created.revision,
      body_text: "edição lenta"
    });
    const staleActive = createStudioMemoryIndexProcessor({ repository, memoryIndex: memory, now: () => clock })
      .processNext();
    await enteredEmbedding;

    clock = "2026-07-14T10:00:02.000Z";
    await service.archiveDocument(ownerA, "owner_a", created.id);
    await createStudioMemoryIndexProcessor({ repository, memoryIndex: memory, now: () => clock }).processNext();
    releaseEmbedding();
    await staleActive;

    await expect(memory.findRelated(ownerA, { query: "conteúdo", limit: 10 })).resolves.toEqual([]);
  });

  it("aborts a hung provider and keeps each processor single-flight", async () => {
    const repository = createInMemoryStudioRepository({ now: () => fixedNow });
    const service = createStudioService(repository, { now: () => fixedNow });
    await service.createDocument(ownerA, "owner_a", input("aguardando embedding"));
    const createEmbeddings = vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise<number[][]>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const processor = createStudioMemoryIndexProcessor({
      repository,
      memoryIndex: createInMemoryStudioMemoryIndex({ embedder: { createEmbeddings } }),
      now: () => fixedNow
    });
    const controller = new AbortController();
    const first = processor.processNext(controller.signal);
    const second = processor.processNext();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(createEmbeddings).toHaveBeenCalledTimes(1));
    controller.abort(new Error("STUDIO_MEMORY_PROVIDER_ABORTED"));
    await expect(first).rejects.toThrow("STUDIO_MEMORY_PROVIDER_ABORTED");
    expect(await repository.listIndexJobs(ownerA)).toEqual([
      expect.objectContaining({
        status: "failed",
        attemptCount: 1,
        lastErrorCode: "STUDIO_MEMORY_PROVIDER_ABORTED"
      })
    ]);
  });

  it("renews the lease while embedding and completes only under the live claim", async () => {
    const repository = createInMemoryStudioRepository();
    const service = createStudioService(repository);
    await service.createDocument(ownerA, "owner_a", input("embedding demorado"));
    const renew = vi.spyOn(repository, "renewIndexJobLease");
    const processor = createStudioMemoryIndexProcessor({
      repository,
      leaseMs: 60,
      memoryIndex: createInMemoryStudioMemoryIndex({
        embedder: {
          async createEmbeddings({ inputs, signal }) {
            await abortableDelay(150, signal);
            return inputs.map(() => [1, 0]);
          }
        }
      })
    });

    await expect(processor.processNext()).resolves.toMatchObject({ status: "completed" });
    expect(renew.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await repository.listIndexJobs(ownerA)).toEqual([
      expect.objectContaining({ status: "completed", claimToken: null, leaseExpiresAt: null })
    ]);
  });

  it("rejects late claim writes and terminalizes a job at its maximum attempts", async () => {
    let clock = "2026-07-14T10:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const service = createStudioService(repository, { now: () => clock });
    await service.createDocument(ownerA, "owner_a", input("tentativa terminal"));
    const claim = await repository.claimNextIndexJob(clock, 10, 1);
    expect(claim?.status).toBe("processing");
    clock = "2026-07-14T10:00:00.020Z";

    await expect(repository.completeIndexJob({
      ...ownerA,
      jobId: claim!.id,
      claimToken: claim!.claimToken!
    })).resolves.toBe(false);
    await expect(repository.renewIndexJobLease({
      ...ownerA,
      jobId: claim!.id,
      claimToken: claim!.claimToken!,
      now: clock,
      leaseExpiresAt: "2026-07-14T10:00:01.000Z"
    })).resolves.toBe(false);
    await expect(repository.claimNextIndexJob(clock, 10, 1)).resolves.toBeNull();
    expect(await repository.listIndexJobs(ownerA)).toEqual([
      expect.objectContaining({
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: null,
        lastErrorCode: "STUDIO_MEMORY_INDEX_MAX_ATTEMPTS"
      })
    ]);
  });

  it("bounds document chunks, embedding batches, and provider calls", async () => {
    const createEmbeddings = vi.fn(async ({ inputs }: { inputs: string[] }) => inputs.map(() => [1, 0]));
    const memory = createInMemoryStudioMemoryIndex({ embedder: { createEmbeddings }, batchSize: 32 });
    const boundedBody = "x".repeat(1_200 + 255 * 1_050);
    const oversizedBody = "x".repeat(1_200 + 256 * 1_050);
    expect(chunkStudioText(boundedBody)).toHaveLength(256);
    expect(chunkStudioText(oversizedBody)).toHaveLength(257);

    const bounded = fixture(ownerA, "bounded", boundedBody, 1);
    await expect(memory.indexVersion(ownerA, bounded.document, bounded.version)).resolves.toBe(true);
    expect(createEmbeddings).toHaveBeenCalledTimes(8);
    const oversized = fixture(ownerA, "oversized", oversizedBody, 1);
    await expect(memory.indexVersion(ownerA, oversized.document, oversized.version))
      .rejects.toThrow("STUDIO_MEMORY_DOCUMENT_TOO_LARGE");
    expect(createEmbeddings).toHaveBeenCalledTimes(8);
  });

  it("serializes vector setup across adapters on one transaction session", async () => {
    const setupPool = createSerializedSetupPool();
    const first = createPostgresStudioMemoryIndex(setupPool.pool, { embedder: constantEmbedder(), dimensions: 3 });
    const second = createPostgresStudioMemoryIndex(setupPool.pool, { embedder: constantEmbedder(), dimensions: 3 });
    await Promise.all([first.ensureSetup(), second.ensureSetup()]);

    expect(setupPool.sessions).toHaveLength(2);
    for (const session of setupPool.sessions) {
      expect(session.statements[0]).toBe("BEGIN");
      expect(session.statements[1]).toContain("pg_advisory_xact_lock");
      expect(session.statements).toContain("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public");
      expect(session.statements.at(-1)).toBe("COMMIT");
      expect(session.released).toBe(true);
    }
    const events = setupPool.events;
    const extensions = events.flatMap((event, index) => event.statement.startsWith("CREATE EXTENSION") ? [index] : []);
    expect(extensions).toHaveLength(2);
    expect(events.slice(extensions[0]!, extensions[1]).some((event) => event.statement === "COMMIT")).toBe(true);
  });

  it("rolls back and releases setup advisory locks before a safe retry", async () => {
    const setupPool = createSerializedSetupPool({ failFirstExtension: true });
    const memory = createPostgresStudioMemoryIndex(setupPool.pool, { embedder: constantEmbedder(), dimensions: 3 });
    await expect(memory.ensureSetup()).rejects.toBeInstanceOf(StudioVectorPrerequisiteError);
    expect(setupPool.sessions[0]!.statements.at(-1)).toBe("ROLLBACK");
    expect(setupPool.sessions[0]!.released).toBe(true);
    await expect(memory.ensureSetup()).resolves.toBeUndefined();
    expect(setupPool.sessions[1]!.statements.at(-1)).toBe("COMMIT");
  });

  it("rechecks the committed document generation inside the PostgreSQL mutation transaction", async () => {
    const sessions: string[][] = [];
    const pool: OperationalPool = {
      async query<T>() { return { rows: [] as T[] }; },
      async connect() {
        const statements: string[] = [];
        sessions.push(statements);
        return {
          async query<T>(text: string) {
            const statement = text.trim().replace(/\s+/gu, " ");
            statements.push(statement);
            if (statement.startsWith("SELECT format_type")) {
              return { rows: [{ vector_type: "public.vector(2)" }] as T[] };
            }
            if (statement.startsWith("SELECT document.revision")) {
              return { rows: [{
                revision: 2,
                status: "archived",
                version_id: "version_newer",
                version_number: 2
              }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() { /* observed through transaction statements */ }
        };
      }
    };
    const memory = createPostgresStudioMemoryIndex(pool, { embedder: constantEmbedder(), dimensions: 2 });
    const stale = fixture(ownerA, "stale_pg", "stale", 1);
    const applied = await memory.indexVersion(ownerA, stale.document, stale.version, {
      expectedDocumentRevision: 1,
      expectedVersionId: stale.version.id,
      expectedVersionNumber: 1,
      jobId: "job_stale",
      claimToken: "claim_stale",
      isCurrent: async () => true
    });

    expect(applied).toBe(false);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toEqual(expect.arrayContaining([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("SELECT document.revision"),
      "COMMIT"
    ]));
    expect(sessions[1]!.some((statement) => statement.startsWith("DELETE FROM studio_memory_chunks"))).toBe(false);
    expect(sessions[1]!.some((statement) => statement.startsWith("INSERT INTO studio_memory_chunks"))).toBe(false);
  });

  it("persists only cross-document same-owner relations after service verification", async () => {
    const repository = createInMemoryStudioRepository({ now: () => fixedNow });
    const service = createStudioService(repository);
    const left = await service.createDocument(ownerA, "owner_a", input("A"));
    const right = await service.createDocument(ownerA, "owner_a", input("B"));
    const foreign = await service.createDocument(ownerB, "owner_b", input("Segredo"));

    await expect(service.relateDocuments(ownerA, "owner_a", left.id, right.id, "supports"))
      .resolves.toMatchObject({ sourceDocumentId: left.id, targetDocumentId: right.id, relationType: "supports" });
    await expect(service.relateDocuments(ownerA, "owner_a", left.id, foreign.id, "related_to"))
      .rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");
    await expect(service.relateDocuments(ownerA, "owner_a", left.id, left.id, "supports"))
      .rejects.toThrow("STUDIO_RELATION_SELF_INVALID");
    expect(await repository.listRelations(ownerB)).toEqual([]);
  });
});

function input(body: string) {
  return { title: body, body_json: {}, body_text: body, capture_mode: "text" as const };
}

function fixture(scope: StudioOwnerScope, id: string, body: string, versionNumber: number): {
  document: StudioDocument;
  version: StudioDocumentVersion;
} {
  const document: StudioDocument = {
    ...scope,
    id,
    captureKey: null,
    title: null,
    bodyJson: {},
    bodyText: body,
    revision: versionNumber,
    captureMode: "text",
    inboxState: "reviewed",
    isFocused: false,
    status: "active",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    archivedAt: null
  };
  return {
    document,
    version: {
      ...scope,
      id: `version_${id}_${versionNumber}`,
      documentId: id,
      versionNumber,
      bodyJson: {},
      bodyText: body,
      origin: "user",
      actorProfileId: scope.ownerProfileId,
      aiRunId: null,
      createdAt: "2026-07-13T12:00:00.000Z"
    }
  };
}

function constantEmbedder(): StudioMemoryEmbedder {
  return { createEmbeddings: async ({ inputs }) => inputs.map(() => [1, 0]) };
}

function conditionalEmbedder(create: (input: string) => number[]): StudioMemoryEmbedder {
  return { createEmbeddings: async ({ inputs }) => inputs.map(create) };
}

function graphemeLength(value: string) {
  return [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(value)].length;
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}

function createSerializedSetupPool(options: { failFirstExtension?: boolean } = {}) {
  const sessions: Array<{ id: number; statements: string[]; released: boolean }> = [];
  const events: Array<{ sessionId: number; statement: string }> = [];
  let lockTail = Promise.resolve();
  let failFirstExtension = options.failFirstExtension ?? false;
  const pool: OperationalPool = {
    async query<T>() { return { rows: [] as T[] }; },
    async connect() {
      const session = { id: sessions.length + 1, statements: [] as string[], released: false };
      sessions.push(session);
      let releaseLock: (() => void) | null = null;
      return {
        async query<T>(text: string) {
          const statement = text.trim().replace(/\s+/gu, " ");
          session.statements.push(statement);
          events.push({ sessionId: session.id, statement });
          if (statement.includes("pg_advisory_xact_lock")) {
            const previous = lockTail;
            lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
            await previous;
          }
          if (statement.startsWith("CREATE EXTENSION") && failFirstExtension) {
            failFirstExtension = false;
            throw Object.assign(new Error("extension unavailable"), { code: "58P01" });
          }
          if (statement.startsWith("SELECT format_type")) {
            return { rows: [{ vector_type: "public.vector(3)" }] as T[] };
          }
          if (statement === "COMMIT" || statement === "ROLLBACK") releaseLock?.();
          return { rows: [] as T[] };
        },
        release() { session.released = true; }
      };
    }
  };
  return { pool, sessions, events };
}
