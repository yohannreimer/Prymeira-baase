import { tagStudioMaintenanceFailure, type StudioMaintenanceClaimBudget } from "./studio-maintenance-budget";
import type {
  StudioDocument,
  StudioDocumentVersion,
  StudioIndexJob,
  StudioOwnerScope,
  StudioRepository
} from "./studio.types";

export const STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES = 1_200;
export const STUDIO_MEMORY_CHUNK_OVERLAP_GRAPHEMES = 150;
export const STUDIO_MEMORY_DEFAULT_BATCH_SIZE = 32;
export const STUDIO_MEMORY_MAX_CHUNKS_PER_DOCUMENT = 256;
export const STUDIO_MEMORY_DEFAULT_MODEL = "text-embedding-3-small";
export const STUDIO_MEMORY_DEFAULT_DIMENSIONS = 1_536;

export type StudioMemoryEmbedder = {
  createEmbeddings(input: { model: string; inputs: string[]; signal?: AbortSignal }): Promise<number[][]>;
};

export type StudioMemoryMutationGuard = {
  expectedDocumentRevision: number;
  expectedVersionId: string;
  expectedVersionNumber: number;
  jobId: string;
  claimToken: string;
  signal?: AbortSignal;
  isCurrent?: () => Promise<boolean>;
};

export type StudioMemoryMatch = {
  documentId: string;
  versionId: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
  vectorScore: number;
  lexicalScore: number;
  recencyScore: number;
  updatedAt: string;
  cursor: string;
};

export type StudioMemoryIndex = {
  indexVersion(
    scope: StudioOwnerScope,
    document: StudioDocument,
    version: StudioDocumentVersion,
    guard?: StudioMemoryMutationGuard
  ): Promise<boolean>;
  removeDocument(
    scope: StudioOwnerScope,
    documentId: string,
    guard?: StudioMemoryMutationGuard
  ): Promise<boolean>;
  findRelated(scope: StudioOwnerScope, input: {
    documentId?: string;
    query: string;
    limit: number;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<StudioMemoryMatch[]>;
};

type StoredChunk = StudioOwnerScope & {
  documentId: string;
  versionId: string;
  versionNumber: number;
  chunkIndex: number;
  content: string;
  embedding: number[];
  updatedAt: string;
};

type MemoryCursor = Pick<StudioMemoryMatch, "score" | "updatedAt" | "documentId" | "chunkIndex">;

export function chunkStudioText(input: string, maxChunks = Number.MAX_SAFE_INTEGER): string[] {
  if (!Number.isSafeInteger(maxChunks) || maxChunks < 1) throw new Error("STUDIO_MEMORY_MAX_CHUNKS_INVALID");
  const paragraphs = input.replace(/\r\n?/gu, "\n")
    .split(/\n[\t ]*\n+/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  const pushChunk = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    if (chunks.length >= maxChunks) throw new Error("STUDIO_MEMORY_DOCUMENT_TOO_LARGE");
    chunks.push(normalized);
  };
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    const candidateUnits = graphemes(candidate);
    if (candidateUnits.length <= STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES) {
      current = candidate;
      continue;
    }
    if (current) pushChunk(current);
    current = current ? `${tail(current, STUDIO_MEMORY_CHUNK_OVERLAP_GRAPHEMES)}\n\n${paragraph}` : paragraph;
    const units = graphemes(current);
    let offset = 0;
    while (units.length - offset > STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES) {
      pushChunk(units.slice(offset, offset + STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES).join(""));
      offset += STUDIO_MEMORY_CHUNK_MAX_GRAPHEMES - STUDIO_MEMORY_CHUNK_OVERLAP_GRAPHEMES;
    }
    current = units.slice(offset).join("").trim();
  }
  if (current) pushChunk(current);
  return chunks.filter(Boolean);
}

export async function embedStudioTexts(
  embedder: StudioMemoryEmbedder,
  model: string,
  inputs: string[],
  batchSize = STUDIO_MEMORY_DEFAULT_BATCH_SIZE,
  expectedDimensions?: number,
  signal?: AbortSignal
): Promise<number[][]> {
  if (!model.trim()) throw new Error("STUDIO_MEMORY_MODEL_REQUIRED");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) {
    throw new Error("STUDIO_MEMORY_BATCH_SIZE_INVALID");
  }
  const result: number[][] = [];
  let dimensions = expectedDimensions;
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    throwIfAborted(signal);
    const batch = inputs.slice(offset, offset + batchSize);
    const vectors = await embedder.createEmbeddings({ model, inputs: batch, signal });
    throwIfAborted(signal);
    if (vectors.length !== batch.length) throw new Error("STUDIO_MEMORY_EMBEDDING_LENGTH_MISMATCH");
    for (const vector of vectors) {
      if (vector.length === 0) throw new Error("STUDIO_MEMORY_EMBEDDING_EMPTY");
      dimensions ??= vector.length;
      if (vector.length !== dimensions) throw new Error("STUDIO_MEMORY_EMBEDDING_DIMENSION_MISMATCH");
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new Error("STUDIO_MEMORY_EMBEDDING_NON_FINITE");
      }
      if (vector.every((value) => value === 0)) throw new Error("STUDIO_MEMORY_EMBEDDING_ZERO_VECTOR");
      result.push([...vector]);
    }
  }
  return result;
}

export function createInMemoryStudioMemoryIndex(options: {
  embedder: StudioMemoryEmbedder;
  model?: string;
  batchSize?: number;
  dimensions?: number;
  now?: () => string;
}): StudioMemoryIndex {
  const model = options.model ?? STUDIO_MEMORY_DEFAULT_MODEL;
  const chunks: StoredChunk[] = [];
  const indexedVersion = new Map<string, number>();
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async indexVersion(scope, document, version, guard) {
      assertScopedVersion(scope, document, version);
      const texts = chunkStudioText(
        [document.title, version.bodyText].filter(Boolean).join("\n\n"),
        STUDIO_MEMORY_MAX_CHUNKS_PER_DOCUMENT
      );
      if (texts.length > STUDIO_MEMORY_MAX_CHUNKS_PER_DOCUMENT) {
        throw new Error("STUDIO_MEMORY_DOCUMENT_TOO_LARGE");
      }
      const embeddings = await embedStudioTexts(
        options.embedder,
        model,
        texts,
        options.batchSize,
        options.dimensions,
        guard?.signal
      );
      if (!await mutationIsCurrent(guard)) return false;
      const key = scopeKey(scope, document.id);
      const current = indexedVersion.get(key);
      if (current !== undefined && current > version.versionNumber) return false;
      removeScopedChunks(chunks, scope, document.id);
      indexedVersion.set(key, version.versionNumber);
      for (let index = 0; index < texts.length; index += 1) {
        chunks.push({
          ...scope,
          documentId: document.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          chunkIndex: index,
          content: texts[index]!,
          embedding: embeddings[index]!,
          updatedAt: version.createdAt
        });
      }
      return true;
    },

    async removeDocument(scope, documentId, guard) {
      if (!await mutationIsCurrent(guard)) return false;
      removeScopedChunks(chunks, scope, documentId);
      indexedVersion.delete(scopeKey(scope, documentId));
      return true;
    },

    async findRelated(scope, input) {
      const query = input.query.trim();
      validateRelatedInput(query, input.limit);
      const [queryEmbedding] = await embedStudioTexts(
        options.embedder,
        model,
        [query],
        options.batchSize,
        options.dimensions,
        input.signal
      );
      throwIfAborted(input.signal);
      const currentTime = parseTimestamp(now(), "STUDIO_MEMORY_CLOCK_INVALID");
      const bestByDocument = new Map<string, StudioMemoryMatch>();
      for (const chunk of chunks) {
        if (chunk.workspaceId !== scope.workspaceId || chunk.ownerProfileId !== scope.ownerProfileId) continue;
        if (chunk.documentId === input.documentId) continue;
        const vectorScore = normalizeCosine(cosineSimilarity(queryEmbedding!, chunk.embedding));
        const lexicalScore = lexicalRelevance(query, chunk.content);
        const recencyScore = calculateRecency(currentTime, parseTimestamp(chunk.updatedAt, "STUDIO_MEMORY_TIMESTAMP_INVALID"));
        const score = roundScore(0.65 * vectorScore + 0.25 * lexicalScore + 0.10 * recencyScore);
        const match = buildMatch(chunk, score, vectorScore, lexicalScore, recencyScore);
        const existing = bestByDocument.get(chunk.documentId);
        if (!existing || compareStudioMemoryMatches(match, existing) < 0) bestByDocument.set(chunk.documentId, match);
      }
      const cursor = input.cursor ? decodeStudioMemoryCursor(input.cursor) : null;
      throwIfAborted(input.signal);
      return [...bestByDocument.values()]
        .sort(compareStudioMemoryMatches)
        .filter((match) => !cursor || isAfterMemoryCursor(match, cursor))
        .slice(0, input.limit);
    }
  };
}

export function createStudioMemoryIndexProcessor(options: {
  repository: StudioRepository;
  memoryIndex: StudioMemoryIndex;
  now?: () => string;
  leaseMs?: number;
  maxAttempts?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const maxAttempts = options.maxAttempts ?? 5;
  const leaseMs = options.leaseMs ?? 60_000;
  let active: Promise<StudioIndexJob | null> | null = null;

  async function run(signal?: AbortSignal, budget?: StudioMaintenanceClaimBudget): Promise<StudioIndexJob | null> {
    throwIfAborted(signal);
    const claimed = await options.repository.claimNextIndexJob(now(), leaseMs, maxAttempts, budget?.excludeOwnerKeys);
    if (!claimed) return null;
    const scope: StudioOwnerScope = {
      workspaceId: claimed.workspaceId,
      ownerProfileId: claimed.ownerProfileId
    };
    const operation = composeAbortSignal(signal);
    let heartbeatStopped = false;
    let heartbeatChain = Promise.resolve();
    const renewClaim = async () => {
      const at = now();
      const renewed = await options.repository.renewIndexJobLease({
        ...scope,
        jobId: claimed.id,
        claimToken: claimed.claimToken!,
        now: at,
        leaseExpiresAt: new Date(parseTimestamp(at, "STUDIO_MEMORY_CLOCK_INVALID") + leaseMs).toISOString()
      });
      if (!renewed) operation.controller.abort(new Error("STUDIO_MEMORY_INDEX_LEASE_LOST"));
      return renewed;
    };
    const heartbeat = setInterval(() => {
      heartbeatChain = heartbeatChain.then(async () => {
        if (!heartbeatStopped && !operation.signal.aborted) await renewClaim();
      }).catch((error) => operation.controller.abort(error));
    }, Math.max(10, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();

    try {
      const [document, versions] = await Promise.all([
        options.repository.findDocument(scope, claimed.documentId),
        options.repository.listVersions(scope, claimed.documentId)
      ]);
      const version = versions.find((item) => item.id === claimed.versionId);
      const latest = versions.at(-1);
      if (!document || !version || !latest) throw new Error("STUDIO_MEMORY_SOURCE_NOT_FOUND");
      const isCurrent = async () => {
        if (!await renewClaim()) return false;
        throwIfAborted(operation.signal);
        const [currentDocument, currentVersions] = await Promise.all([
          options.repository.findDocument(scope, claimed.documentId),
          options.repository.listVersions(scope, claimed.documentId)
        ]);
        const currentLatest = currentVersions.at(-1);
        return currentDocument?.revision === document.revision
          && currentDocument.status === document.status
          && currentLatest?.id === claimed.versionId
          && currentLatest.versionNumber === version.versionNumber;
      };
      const guard: StudioMemoryMutationGuard = {
        expectedDocumentRevision: document.revision,
        expectedVersionId: version.id,
        expectedVersionNumber: version.versionNumber,
        jobId: claimed.id,
        claimToken: claimed.claimToken!,
        signal: operation.signal,
        isCurrent
      };
      throwIfAborted(operation.signal);
      const applied = document.status === "archived"
        ? await options.memoryIndex.removeDocument(scope, document.id, guard)
        : await options.memoryIndex.indexVersion(scope, document, version, guard);
      throwIfAborted(operation.signal);
      void applied; // A newer committed generation may supersede this job while it works.
      const completed = await options.repository.completeIndexJob({
        ...scope,
        jobId: claimed.id,
        claimToken: claimed.claimToken!
      });
      if (!completed) throw new Error("STUDIO_MEMORY_INDEX_LEASE_LOST");
      return { ...claimed, status: "completed", claimToken: null, leaseExpiresAt: null };
    } catch (error) {
      const retryAt = claimed.attemptCount >= maxAttempts
        ? null
        : new Date(parseTimestamp(now(), "STUDIO_MEMORY_CLOCK_INVALID") + retryDelayMs(claimed.attemptCount)).toISOString();
      await options.repository.failIndexJob({
        ...scope,
        jobId: claimed.id,
        claimToken: claimed.claimToken!,
        lastErrorCode: safeErrorCode(error),
        nextAttemptAt: retryAt
      });
      throw tagStudioMaintenanceFailure(error, scope);
    } finally {
      heartbeatStopped = true;
      clearInterval(heartbeat);
      await heartbeatChain.catch(() => undefined);
      operation.cleanup();
    }
  }

  return {
    processNext(signal?: AbortSignal, budget?: StudioMaintenanceClaimBudget): Promise<StudioIndexJob | null> {
      if (active) return active;
      const running = run(signal, budget);
      let tracked!: Promise<StudioIndexJob | null>;
      tracked = running.finally(() => {
        if (active === tracked) active = null;
      });
      active = tracked;
      return tracked;
    }
  };
}

function assertScopedVersion(scope: StudioOwnerScope, document: StudioDocument, version: StudioDocumentVersion) {
  if (document.workspaceId !== scope.workspaceId || document.ownerProfileId !== scope.ownerProfileId
    || version.workspaceId !== scope.workspaceId || version.ownerProfileId !== scope.ownerProfileId
    || version.documentId !== document.id) throw new Error("STUDIO_MEMORY_SCOPE_MISMATCH");
}

function validateRelatedInput(query: string, limit: number) {
  if (!query) throw new Error("STUDIO_MEMORY_QUERY_REQUIRED");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("STUDIO_MEMORY_LIMIT_INVALID");
}

function graphemes(value: string) {
  const Segmenter = Intl.Segmenter;
  return [...new Segmenter("pt-BR", { granularity: "grapheme" }).segment(value)].map((item) => item.segment);
}

function tail(value: string, length: number) {
  return graphemes(value).slice(-length).join("").trim();
}

function removeScopedChunks(chunks: StoredChunk[], scope: StudioOwnerScope, documentId: string) {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]!;
    if (chunk.workspaceId === scope.workspaceId && chunk.ownerProfileId === scope.ownerProfileId
      && chunk.documentId === documentId) chunks.splice(index, 1);
  }
}

function scopeKey(scope: StudioOwnerScope, documentId: string) {
  return JSON.stringify([scope.workspaceId, scope.ownerProfileId, documentId]);
}

function fold(value: string) {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("pt-BR");
}

function lexicalRelevance(query: string, content: string) {
  const tokens = [...new Set(fold(query).match(/[\p{L}\p{N}]+/gu) ?? [])];
  if (tokens.length === 0) return 0;
  const foldedContent = fold(content);
  const matched = tokens.filter((token) => foldedContent.includes(token)).length / tokens.length;
  const phrase = foldedContent.includes(fold(query)) ? 1 : 0;
  return roundScore(Math.min(1, matched * 0.8 + phrase * 0.2));
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) throw new Error("STUDIO_MEMORY_EMBEDDING_DIMENSION_MISMATCH");
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function normalizeCosine(value: number) {
  return roundScore(Math.max(0, Math.min(1, (value + 1) / 2)));
}

function calculateRecency(now: number, updatedAt: number) {
  const ageDays = Math.max(0, now - updatedAt) / 86_400_000;
  return roundScore(1 / (1 + ageDays / 30));
}

function parseTimestamp(value: string, errorCode: string) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return parsed;
}

function roundScore(value: number) {
  return Number(value.toFixed(12));
}

function buildMatch(
  chunk: StoredChunk,
  score: number,
  vectorScore: number,
  lexicalScore: number,
  recencyScore: number
): StudioMemoryMatch {
  const partial = {
    documentId: chunk.documentId,
    versionId: chunk.versionId,
    chunkIndex: chunk.chunkIndex,
    excerpt: chunk.content,
    score,
    vectorScore,
    lexicalScore,
    recencyScore,
    updatedAt: chunk.updatedAt
  };
  return { ...partial, cursor: encodeStudioMemoryCursor(partial) };
}

export function compareStudioMemoryMatches(left: StudioMemoryMatch, right: StudioMemoryMatch) {
  return right.score - left.score
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.documentId.localeCompare(right.documentId)
    || left.chunkIndex - right.chunkIndex;
}

export function encodeStudioMemoryCursor(match: Pick<StudioMemoryMatch, "score" | "updatedAt" | "documentId" | "chunkIndex">) {
  return Buffer.from(JSON.stringify({
    score: match.score,
    updatedAt: match.updatedAt,
    documentId: match.documentId,
    chunkIndex: match.chunkIndex
  })).toString("base64url");
}

export function decodeStudioMemoryCursor(input: string): MemoryCursor {
  try {
    if (!input || !/^[A-Za-z0-9_-]+$/u.test(input)) throw new Error();
    const raw = Buffer.from(input, "base64url");
    if (raw.toString("base64url") !== input) throw new Error();
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<MemoryCursor>;
    if (!parsed || typeof parsed.score !== "number" || !Number.isFinite(parsed.score)
      || typeof parsed.updatedAt !== "string" || !Number.isFinite(new Date(parsed.updatedAt).getTime())
      || typeof parsed.documentId !== "string" || !parsed.documentId
      || !Number.isSafeInteger(parsed.chunkIndex) || parsed.chunkIndex! < 0) throw new Error();
    return parsed as MemoryCursor;
  } catch {
    throw new Error("STUDIO_MEMORY_CURSOR_INVALID");
  }
}

function isAfterMemoryCursor(match: StudioMemoryMatch, cursor: MemoryCursor) {
  if (match.score !== cursor.score) return match.score < cursor.score;
  if (match.updatedAt !== cursor.updatedAt) return match.updatedAt < cursor.updatedAt;
  if (match.documentId !== cursor.documentId) return match.documentId > cursor.documentId;
  return match.chunkIndex > cursor.chunkIndex;
}

function retryDelayMs(attempt: number) {
  return Math.min(60 * 60_000, 5_000 * (2 ** Math.max(0, attempt - 1)));
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "STUDIO_MEMORY_INDEX_FAILED";
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(message) ? message : "STUDIO_MEMORY_INDEX_FAILED";
}

async function mutationIsCurrent(guard?: StudioMemoryMutationGuard) {
  throwIfAborted(guard?.signal);
  if (guard?.isCurrent && !await guard.isCurrent()) return false;
  throwIfAborted(guard?.signal);
  return true;
}

function composeAbortSignal(parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error("STUDIO_MEMORY_INDEX_ABORTED"));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    controller,
    signal: controller.signal,
    cleanup: () => parent?.removeEventListener("abort", abort)
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason
    : new Error("STUDIO_MEMORY_INDEX_ABORTED");
}
