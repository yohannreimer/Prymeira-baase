import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import {
  STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES,
  STUDIO_MEMORY_CHUNK_OVERLAP_GRAPHEMES,
  chunkStudioText,
  createInMemoryStudioMemoryIndex,
  createStudioMemoryIndexProcessor,
  embedStudioTexts,
  type StudioMemoryEmbedder
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
    const embedder: StudioMemoryEmbedder = {
      async createEmbeddings(input) {
        calls.push(input.inputs);
        return input.inputs.map(() => [1, 0]);
      }
    };
    await expect(embedStudioTexts(embedder, "model", ["a", "b", "c", "d", "e"], 2, 2))
      .resolves.toHaveLength(5);
    expect(calls.map((batch) => batch.length)).toEqual([2, 2, 1]);
    await expect(embedStudioTexts({ createEmbeddings: async () => [] }, "model", ["a"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_LENGTH_MISMATCH");
    await expect(embedStudioTexts({ createEmbeddings: async () => [[1], [1, 2]] }, "model", ["a", "b"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_DIMENSION_MISMATCH");
    await expect(embedStudioTexts({ createEmbeddings: async () => [[Number.NaN]] }, "model", ["a"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_NON_FINITE");
    await expect(embedStudioTexts({ createEmbeddings: async () => [[0, 0]] }, "model", ["a"], 2))
      .rejects.toThrow("STUDIO_MEMORY_EMBEDDING_ZERO_VECTOR");
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
