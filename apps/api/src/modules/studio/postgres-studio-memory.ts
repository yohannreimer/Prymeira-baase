import type { OperationalPool } from "../../db/operational-repository-support";
import { generatedId, iso, withOperationalTransaction } from "../../db/operational-repository-support";
import {
  STUDIO_MEMORY_DEFAULT_BATCH_SIZE,
  STUDIO_MEMORY_DEFAULT_DIMENSIONS,
  STUDIO_MEMORY_DEFAULT_MODEL,
  STUDIO_MEMORY_MAX_CHUNKS_PER_DOCUMENT,
  chunkStudioText,
  decodeStudioMemoryCursor,
  embedStudioTexts,
  encodeStudioMemoryCursor,
  type StudioMemoryEmbedder,
  type StudioMemoryIndex,
  type StudioMemoryMatch,
  type StudioMemoryMutationGuard
} from "./studio-memory";
import type { OperationalClient } from "../../db/operational-repository-support";

export class StudioVectorPrerequisiteError extends Error {
  readonly code = "STUDIO_MEMORY_VECTOR_PREREQUISITE_UNAVAILABLE";

  constructor(cause?: unknown) {
    super("STUDIO_MEMORY_VECTOR_PREREQUISITE_UNAVAILABLE", { cause });
  }
}

type MemoryMatchRow = {
  document_id: string;
  version_id: string;
  chunk_index: number;
  content: string;
  updated_at: string | Date;
  score: string | number;
  vector_score: string | number;
  lexical_score: string | number;
  recency_score: string | number;
};

export function createPostgresStudioMemoryIndex(
  db: OperationalPool,
  options: {
    embedder: StudioMemoryEmbedder;
    model?: string;
    dimensions?: number;
    batchSize?: number;
    now?: () => string;
  }
): StudioMemoryIndex & { ensureSetup(): Promise<void> } {
  const model = options.model ?? STUDIO_MEMORY_DEFAULT_MODEL;
  const dimensions = options.dimensions ?? STUDIO_MEMORY_DEFAULT_DIMENSIONS;
  const batchSize = options.batchSize ?? STUDIO_MEMORY_DEFAULT_BATCH_SIZE;
  const now = options.now ?? (() => new Date().toISOString());
  validateDimensions(dimensions);
  let setup: Promise<void> | null = null;

  function ensureSetup() {
    setup ??= setupVectorStorage(db, dimensions).catch((error) => {
      setup = null;
      throw error;
    });
    return setup;
  }

  return {
    ensureSetup,

    async indexVersion(scope, document, version, guard) {
      assertScope(scope, document, version);
      const chunks = chunkStudioText(
        [document.title, version.bodyText].filter(Boolean).join("\n\n"),
        STUDIO_MEMORY_MAX_CHUNKS_PER_DOCUMENT
      );
      if (chunks.length > STUDIO_MEMORY_MAX_CHUNKS_PER_DOCUMENT) {
        throw new Error("STUDIO_MEMORY_DOCUMENT_TOO_LARGE");
      }
      const embeddings = await embedStudioTexts(
        options.embedder,
        model,
        chunks,
        batchSize,
        dimensions,
        guard?.signal
      );
      if (!await externalGuardCurrent(guard)) return false;
      await ensureSetup();
      return withOperationalTransaction(db, async (client) => {
        if (!await validatePostgresMutation(client, scope, document.id, "active", {
          guard,
          documentRevision: document.revision,
          versionId: version.id,
          versionNumber: version.versionNumber
        })) return false;
        await client.query(
          `INSERT INTO studio_memory_document_state
             (workspace_id,owner_profile_id,document_id,version_id,version_number,embedding_model,embedding_dimensions,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (workspace_id,owner_profile_id,document_id) DO NOTHING`,
          [scope.workspaceId, scope.ownerProfileId, document.id, version.id, version.versionNumber, model, dimensions, version.createdAt]
        );
        const state = await client.query<{ version_number: number }>(
          `SELECT version_number FROM studio_memory_document_state
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, document.id]
        );
        if (state.rows[0]!.version_number > version.versionNumber) return false;
        await client.query(
          `DELETE FROM studio_memory_chunks
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, document.id]
        );
        for (let index = 0; index < chunks.length; index += 1) {
          await client.query(
            `INSERT INTO studio_memory_chunks
               (id,workspace_id,owner_profile_id,document_id,version_id,version_number,chunk_index,
                content,embedding,embedding_model,embedding_dimensions,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::public.vector,$10,$11,$12)`,
            [
              generatedId("studio_memory_chunk"),
              scope.workspaceId,
              scope.ownerProfileId,
              document.id,
              version.id,
              version.versionNumber,
              index,
              chunks[index],
              serializeVector(embeddings[index]!),
              model,
              dimensions,
              version.createdAt
            ]
          );
        }
        await client.query(
          `UPDATE studio_memory_document_state SET
             version_id=$4,version_number=$5,embedding_model=$6,embedding_dimensions=$7,updated_at=$8
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, document.id, version.id, version.versionNumber, model, dimensions, version.createdAt]
        );
        return true;
      });
    },

    async removeDocument(scope, documentId, guard) {
      if (!await externalGuardCurrent(guard)) return false;
      await ensureSetup();
      return withOperationalTransaction(db, async (client) => {
        if (guard && !await validatePostgresMutation(client, scope, documentId, "archived", {
          guard,
          documentRevision: guard.expectedDocumentRevision,
          versionId: guard.expectedVersionId,
          versionNumber: guard.expectedVersionNumber
        })) return false;
        await client.query(
          `DELETE FROM studio_memory_chunks
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        await client.query(
          `DELETE FROM studio_memory_document_state
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        return true;
      });
    },

    async findRelated(scope, input) {
      const query = input.query.trim();
      if (!query) throw new Error("STUDIO_MEMORY_QUERY_REQUIRED");
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new Error("STUDIO_MEMORY_LIMIT_INVALID");
      }
      const [embedding] = await embedStudioTexts(
        options.embedder,
        model,
        [query],
        batchSize,
        dimensions
      );
      await ensureSetup();
      const timestamp = new Date(now());
      if (Number.isNaN(timestamp.getTime())) throw new Error("STUDIO_MEMORY_CLOCK_INVALID");
      const cursor = input.cursor ? decodeStudioMemoryCursor(input.cursor) : null;
      const params: unknown[] = [
        scope.workspaceId,
        scope.ownerProfileId,
        model,
        dimensions,
        serializeVector(embedding!),
        query,
        timestamp.toISOString(),
        input.documentId ?? null
      ];
      let cursorSql = "";
      if (cursor) {
        params.push(cursor.score, cursor.updatedAt, cursor.documentId, cursor.chunkIndex);
        cursorSql = `AND (
          score < $9::double precision
          OR (score = $9::double precision AND updated_at < $10::timestamptz)
          OR (score = $9::double precision AND updated_at = $10::timestamptz AND document_id > $11)
          OR (score = $9::double precision AND updated_at = $10::timestamptz AND document_id = $11 AND chunk_index > $12)
        )`;
      }
      params.push(input.limit);
      const result = await db.query<MemoryMatchRow>(
        `WITH scoped AS (
           SELECT document_id,version_id,chunk_index,content,embedding,search_vector,updated_at
           FROM studio_memory_chunks
           WHERE workspace_id=$1 AND owner_profile_id=$2
             AND embedding_model=$3 AND embedding_dimensions=$4
             AND ($8::text IS NULL OR document_id<>$8)
         ), components AS (
           SELECT *,
             GREATEST(0.0,LEAST(1.0,(2.0-(embedding OPERATOR(public.<=>) $5::public.vector))/2.0)) AS vector_score,
             CASE WHEN plainto_tsquery('simple',$6) @@ search_vector
               THEN LEAST(1.0,ts_rank_cd(search_vector,plainto_tsquery('simple',$6))*4.0)
               ELSE 0.0 END AS lexical_score,
             1.0/(1.0+GREATEST(0.0,EXTRACT(EPOCH FROM ($7::timestamptz-updated_at))/86400.0)/30.0)
               AS recency_score
           FROM scoped
         ), scored AS (
           SELECT *,ROUND((0.65*vector_score+0.25*lexical_score+0.10*recency_score)::numeric,12)::double precision AS score
           FROM components
         ), ranked AS (
           SELECT *,ROW_NUMBER() OVER (
             PARTITION BY document_id ORDER BY score DESC,updated_at DESC,chunk_index ASC
           ) AS document_rank
           FROM scored
         )
         SELECT document_id,version_id,chunk_index,content,updated_at,
                score,vector_score,lexical_score,recency_score
         FROM ranked
         WHERE document_rank=1 ${cursorSql}
         ORDER BY score DESC,updated_at DESC,document_id ASC,chunk_index ASC
         LIMIT $${params.length}`,
        params
      );
      return result.rows.map(memoryMatchFromRow);
    }
  };
}

async function setupVectorStorage(db: OperationalPool, dimensions: number) {
  const setupState: { phase: "lock" | "extension" | "storage" } = { phase: "lock" };
  try {
    await withOperationalTransaction(db, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1,$2)", [1398034253, 1296389189]);
      setupState.phase = "extension";
      await client.query("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public");
      setupState.phase = "storage";
      await client.query(`
      CREATE TABLE IF NOT EXISTS studio_memory_document_state (
        workspace_id TEXT NOT NULL,
        owner_profile_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        version_number INTEGER NOT NULL CHECK (version_number > 0),
        embedding_model TEXT NOT NULL,
        embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id,owner_profile_id,document_id),
        FOREIGN KEY (workspace_id,owner_profile_id,document_id)
          REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id,owner_profile_id,document_id,version_id)
          REFERENCES studio_document_versions(workspace_id,owner_profile_id,document_id,id) ON DELETE CASCADE
      )
      `);
      await client.query(`
      CREATE TABLE IF NOT EXISTS studio_memory_chunks (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        owner_profile_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        version_number INTEGER NOT NULL CHECK (version_number > 0),
        chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
        content TEXT NOT NULL,
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple',content)) STORED,
        embedding public.vector(${dimensions}) NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id,owner_profile_id,id),
        UNIQUE (workspace_id,owner_profile_id,document_id,version_id,chunk_index),
        FOREIGN KEY (workspace_id,owner_profile_id,document_id)
          REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id,owner_profile_id,document_id,version_id)
          REFERENCES studio_document_versions(workspace_id,owner_profile_id,document_id,id) ON DELETE CASCADE
      )
      `);
      const vectorType = await client.query<{ vector_type: string }>(
        `SELECT format_type(attribute.atttypid,attribute.atttypmod) AS vector_type
         FROM pg_attribute attribute
         WHERE attribute.attrelid='studio_memory_chunks'::regclass
           AND attribute.attname='embedding' AND NOT attribute.attisdropped`
      );
      if (!vectorType.rows[0]?.vector_type.endsWith(`vector(${dimensions})`)) {
        throw new Error("STUDIO_MEMORY_STORAGE_DIMENSION_MISMATCH");
      }
      await client.query(`CREATE INDEX IF NOT EXISTS studio_memory_chunks_owner_idx
        ON studio_memory_chunks (workspace_id,owner_profile_id,embedding_model,embedding_dimensions,document_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS studio_memory_chunks_search_idx
        ON studio_memory_chunks USING GIN (search_vector)`);
      if (dimensions <= 2_000) {
        await client.query(`CREATE INDEX IF NOT EXISTS studio_memory_chunks_embedding_idx
          ON studio_memory_chunks USING hnsw (embedding public.vector_cosine_ops)`);
      }
    });
  } catch (error) {
    if (setupState.phase === "extension") throw new StudioVectorPrerequisiteError(error);
    if (error instanceof Error && error.message === "STUDIO_MEMORY_STORAGE_DIMENSION_MISMATCH") throw error;
    const postgresError = error as { code?: string };
    if (postgresError.code === "42704" || postgresError.code === "58P01") {
      throw new StudioVectorPrerequisiteError(error);
    }
    throw error;
  }
}

async function validatePostgresMutation(
  client: OperationalClient,
  scope: { workspaceId: string; ownerProfileId: string },
  documentId: string,
  expectedStatus: "active" | "archived",
  expected: {
    guard?: StudioMemoryMutationGuard;
    documentRevision: number;
    versionId: string;
    versionNumber: number;
  }
) {
  throwIfAborted(expected.guard?.signal);
  await client.query("SELECT pg_advisory_xact_lock($1,$2)", [
    1398034253,
    stableLockValue(`${scope.workspaceId}\u0000${scope.ownerProfileId}\u0000${documentId}`)
  ]);
  const current = await client.query<{
    revision: number;
    status: "active" | "archived";
    version_id: string | null;
    version_number: number | null;
  }>(
    `SELECT document.revision,document.status,
       latest.id AS version_id,latest.version_number
     FROM studio_documents document
     LEFT JOIN LATERAL (
       SELECT id,version_number FROM studio_document_versions
       WHERE workspace_id=document.workspace_id
         AND owner_profile_id=document.owner_profile_id
         AND document_id=document.id
       ORDER BY version_number DESC,id DESC LIMIT 1
     ) latest ON TRUE
     WHERE document.workspace_id=$1 AND document.owner_profile_id=$2 AND document.id=$3
     FOR UPDATE OF document`,
    [scope.workspaceId, scope.ownerProfileId, documentId]
  );
  const row = current.rows[0];
  if (!row || row.revision !== expected.documentRevision || row.status !== expectedStatus
    || row.version_id !== expected.versionId || row.version_number !== expected.versionNumber) return false;
  if (expected.guard) {
    const claim = await client.query<{ id: string }>(
      `SELECT id FROM studio_index_jobs
       WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
         AND document_id=$4 AND version_id=$5 AND status='processing'
         AND claim_token=$6 AND lease_expires_at IS NOT NULL AND lease_expires_at>NOW()
       FOR UPDATE`,
      [scope.workspaceId, scope.ownerProfileId, expected.guard.jobId,
        documentId, expected.guard.expectedVersionId, expected.guard.claimToken]
    );
    if (!claim.rows[0]) return false;
  }
  throwIfAborted(expected.guard?.signal);
  return true;
}

async function externalGuardCurrent(guard?: StudioMemoryMutationGuard) {
  throwIfAborted(guard?.signal);
  if (guard?.isCurrent && !await guard.isCurrent()) return false;
  throwIfAborted(guard?.signal);
  return true;
}

function stableLockValue(value: string) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return hash;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason
    : new Error("STUDIO_MEMORY_INDEX_ABORTED");
}

function validateDimensions(dimensions: number) {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 16_000) {
    throw new Error("STUDIO_MEMORY_DIMENSIONS_INVALID");
  }
}

function serializeVector(vector: number[]) {
  return `[${vector.map((value) => {
    if (!Number.isFinite(value)) throw new Error("STUDIO_MEMORY_EMBEDDING_NON_FINITE");
    return String(value);
  }).join(",")}]`;
}

function assertScope(
  scope: { workspaceId: string; ownerProfileId: string },
  document: { workspaceId: string; ownerProfileId: string; id: string },
  version: { workspaceId: string; ownerProfileId: string; documentId: string }
) {
  if (document.workspaceId !== scope.workspaceId || document.ownerProfileId !== scope.ownerProfileId
    || version.workspaceId !== scope.workspaceId || version.ownerProfileId !== scope.ownerProfileId
    || version.documentId !== document.id) throw new Error("STUDIO_MEMORY_SCOPE_MISMATCH");
}

function memoryMatchFromRow(row: MemoryMatchRow): StudioMemoryMatch {
  const partial = {
    documentId: row.document_id,
    versionId: row.version_id,
    chunkIndex: row.chunk_index,
    excerpt: row.content,
    score: Number(row.score),
    vectorScore: Number(row.vector_score),
    lexicalScore: Number(row.lexical_score),
    recencyScore: Number(row.recency_score),
    updatedAt: iso(row.updated_at)
  };
  return { ...partial, cursor: encodeStudioMemoryCursor(partial) };
}
