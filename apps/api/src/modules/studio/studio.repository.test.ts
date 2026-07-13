import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ensureOperationalSchema } from "../../db/operational-schema";
import { createConfiguredPostgresRepositoryBundle } from "../../db/postgres";
import type { OperationalPool } from "../../db/operational-repository-support";
import type { StudioDocument, StudioRepository } from "./studio.types";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createPostgresStudioRepository } from "./postgres-studio.repository";
import {
  prepareStudioSearchFields,
  STUDIO_SEARCH_MAX_PREFIX_TOKENS
} from "./studio-search";

type RepositoryFixture = {
  repository: StudioRepository;
  cleanup(): Promise<void>;
};

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let schemaSequence = 0;

function documentInput(
  overrides: Partial<Parameters<StudioRepository["createDocument"]>[0]> = {}
): Parameters<StudioRepository["createDocument"]>[0] {
  return {
    workspaceId: "workspace_a",
    ownerProfileId: "owner_a",
    title: null,
    bodyJson: { type: "doc", content: [] },
    bodyText: "Primeira ideia",
    captureMode: "text",
    inboxState: "pending_review",
    isFocused: false,
    status: "active",
    ...overrides
  };
}

function encodedCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fixedWidthBase26(value: number) {
  let encoded = "";
  for (let place = 0; place < 3; place += 1) {
    encoded = String.fromCharCode(97 + (value % 26)) + encoded;
    value = Math.floor(value / 26);
  }
  return encoded;
}

function repositoryContract(
  name: string,
  createFixture: () => Promise<RepositoryFixture>,
  skip = false
) {
  describe.skipIf(skip)(`${name} StudioRepository contract`, () => {
    async function withRepository(run: (repository: StudioRepository) => Promise<void>) {
      const fixture = await createFixture();
      try {
        await run(fixture.repository);
      } finally {
        await fixture.cleanup();
      }
    }

    it("creates revision and initial version while preserving owner privacy", async () => {
      await withRepository(async (repository) => {
        const created = await repository.createDocument(documentInput());

        expect(created.revision).toBe(1);
        expect(await repository.findDocument(
          { workspaceId: "workspace_a", ownerProfileId: "owner_b" },
          created.id
        )).toBeNull();
        const versions = await repository.listVersions(
          { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
          created.id
        );
        expect(versions).toHaveLength(1);
        expect(versions[0]).toMatchObject({
          documentId: created.id,
          versionNumber: 1,
          bodyJson: created.bodyJson,
          bodyText: created.bodyText,
          origin: "user",
          actorProfileId: "owner_a",
          aiRunId: null
        });
        expect(await repository.listVersions(
          { workspaceId: "workspace_a", ownerProfileId: "owner_b" },
          created.id
        )).toEqual([]);

        await expect(repository.updateDocument({ ...created, bodyText: "mudou" }, 0))
          .rejects.toThrow("STUDIO_DOCUMENT_STALE");
        expect(await repository.listVersions(
          { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
          created.id
        )).toHaveLength(1);
      });
    });

    it("scopes list and find by workspace and owner and paginates by status", async () => {
      await withRepository(async (repository) => {
        const activeA = await repository.createDocument(documentInput({ bodyText: "A" }));
        const activeB = await repository.createDocument(documentInput({ bodyText: "B" }));
        const archived = await repository.createDocument(documentInput({ bodyText: "C", status: "archived" }));
        await repository.createDocument(documentInput({ ownerProfileId: "owner_b", bodyText: "private" }));
        await repository.createDocument(documentInput({ workspaceId: "workspace_b", bodyText: "other workspace" }));

        const first = await repository.listDocuments(
          { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
          { limit: 2 }
        );
        const second = await repository.listDocuments(
          { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
          { limit: 2, cursor: first.nextCursor ?? undefined }
        );
        expect(first.items).toHaveLength(2);
        expect(first.nextCursor).not.toBeNull();
        expect(second.nextCursor).toBeNull();
        expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(
          new Set([activeA.id, activeB.id, archived.id])
        );

        const active = await repository.listDocuments(
          { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
          { limit: 10, status: "active" }
        );
        expect(new Set(active.items.map((item) => item.id))).toEqual(new Set([activeA.id, activeB.id]));
        expect(active.nextCursor).toBeNull();
        expect(await repository.findDocument(
          { workspaceId: "workspace_b", ownerProfileId: "owner_a" },
          activeA.id
        )).toBeNull();
      });
    });

    it("rejects semantically invalid cursors with the domain error", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const invalidCursors = [
          "%%%",
          Buffer.from("{").toString("base64url"),
          encodedCursor([]),
          encodedCursor({ updatedAt: "2026-07-13T12:00:00.000Z", id: "document_a", extra: true }),
          encodedCursor({ updatedAt: "not-a-date", id: "document_a" }),
          encodedCursor({ updatedAt: "2026-07-13T12:00:00Z", id: "document_a" }),
          encodedCursor({ updatedAt: "2026-07-13T12:00:00.000Z", id: "" })
        ];
        for (const cursor of invalidCursors) {
          await expect(repository.listDocuments(scope, { limit: 10, cursor }))
            .rejects.toThrowError(/^STUDIO_DOCUMENT_CURSOR_INVALID$/);
        }
      });
    });

    it("updates atomically at the current revision and appends one ordered version", async () => {
      await withRepository(async (repository) => {
        const created = await repository.createDocument(documentInput());
        const archivedAt = "2026-07-13T12:00:00.000Z";
        const updated = await repository.updateDocument({
          ...created,
          title: "Ideia revista",
          bodyJson: { type: "doc", content: [{ type: "paragraph" }] },
          bodyText: "mudou",
          captureMode: "mixed",
          inboxState: "reviewed",
          isFocused: true,
          status: "archived",
          archivedAt
        }, created.revision);

        expect(updated).toMatchObject({
          title: "Ideia revista",
          bodyText: "mudou",
          captureMode: "mixed",
          inboxState: "reviewed",
          isFocused: true,
          status: "archived",
          archivedAt,
          revision: 2
        });
        const versions = await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        );
        expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
        expect(versions[1]).toMatchObject({ bodyJson: updated.bodyJson, bodyText: "mudou" });

        await expect(repository.updateDocument({ ...updated, bodyText: "stale" }, 1))
          .rejects.toThrow("STUDIO_DOCUMENT_STALE");
        expect(await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        )).toHaveLength(2);
      });
    });

    it("allows exactly one concurrent update for the same expected revision", async () => {
      await withRepository(async (repository) => {
        const created = await repository.createDocument(documentInput());
        const results = await Promise.allSettled([
          repository.updateDocument({ ...created, bodyText: "update_a" }, created.revision),
          repository.updateDocument({ ...created, bodyText: "update_b" }, created.revision)
        ]);

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result) => result.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          message: "STUDIO_DOCUMENT_STALE"
        });
        expect((await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        )).map((version) => version.versionNumber)).toEqual([1, 2]);
      });
    });

    it("distinguishes a missing document from a stale update", async () => {
      await withRepository(async (repository) => {
        const created = await repository.createDocument(documentInput());
        const missing: StudioDocument = { ...created, id: "studio_document_missing" };

        await expect(repository.updateDocument(missing, missing.revision))
          .rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");
      });
    });

    it("does not expose stored JSON or document state to external mutation", async () => {
      await withRepository(async (repository) => {
        const input = documentInput();
        const created = await repository.createDocument(input);
        (input.bodyJson.content as unknown[]).push({ type: "input_mutation" });
        (created.bodyJson.content as unknown[]).push({ type: "result_mutation" });
        created.bodyText = "mutated outside";
        const listed = await repository.listDocuments(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          { limit: 10 }
        );
        listed.items[0]!.bodyText = "mutated list";
        const versions = await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        );
        (versions[0]!.bodyJson.content as unknown[]).push({ type: "version_mutation" });

        expect(await repository.findDocument(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        )).toMatchObject({
          bodyJson: { type: "doc", content: [] },
          bodyText: "Primeira ideia"
        });
        expect((await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        ))[0]).toMatchObject({
          bodyJson: { type: "doc", content: [] },
          bodyText: "Primeira ideia"
        });
      });
    });

    it("appends explicitly requested versions in ascending version order", async () => {
      await withRepository(async (repository) => {
        const created = await repository.createDocument(documentInput());
        const appended = await repository.appendVersion({
          workspaceId: created.workspaceId,
          ownerProfileId: created.ownerProfileId,
          documentId: created.id,
          bodyJson: { type: "doc", source: "import" },
          bodyText: "Importada",
          origin: "import",
          actorProfileId: "owner_a",
          aiRunId: null
        });

        expect(appended.versionNumber).toBe(2);
        expect((await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        )).map((version) => version.versionNumber)).toEqual([1, 2]);
        expect(await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: "owner_b" },
          created.id
        )).toEqual([]);
      });
    });

    it("numbers concurrent explicit appends uniquely and sequentially", async () => {
      await withRepository(async (repository) => {
        const created = await repository.createDocument(documentInput());
        const append = (bodyText: string) => repository.appendVersion({
          workspaceId: created.workspaceId,
          ownerProfileId: created.ownerProfileId,
          documentId: created.id,
          bodyJson: { type: "doc", bodyText },
          bodyText,
          origin: "user",
          actorProfileId: created.ownerProfileId,
          aiRunId: null
        });

        const appended = await Promise.all([append("append_a"), append("append_b")]);
        expect(appended.map((version) => version.versionNumber).sort()).toEqual([2, 3]);
        expect((await repository.listVersions(
          { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
          created.id
        )).map((version) => version.versionNumber)).toEqual([1, 2, 3]);
      });
    });

    it("persists owner-scoped collections and idempotent many-to-many membership", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const document = await repository.createDocument(documentInput());
        const strategy = await repository.createCollection({ ...scope, name: "Estratégia" });
        const decisions = await repository.createCollection({ ...scope, name: "Decisões" });
        const privateCollection = await repository.createCollection({
          workspaceId: "workspace_a",
          ownerProfileId: "owner_b",
          name: "Privada"
        });

        const orderedCollections = [strategy, decisions].sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
        );
        expect(await repository.listCollections(scope)).toEqual(orderedCollections);
        expect(await repository.findCollection(
          { workspaceId: "workspace_a", ownerProfileId: "owner_b" },
          strategy.id
        )).toBeNull();

        const membership = await repository.addCollectionMembership({
          ...scope,
          collectionId: strategy.id,
          documentId: document.id
        });
        expect(await repository.addCollectionMembership({
          ...scope,
          collectionId: strategy.id,
          documentId: document.id
        })).toEqual(membership);
        await repository.addCollectionMembership({
          ...scope,
          collectionId: decisions.id,
          documentId: document.id
        });
        expect((await repository.listDocumentCollections(scope, document.id)).map((item) => item.id))
          .toEqual(orderedCollections.map((item) => item.id));

        await expect(repository.addCollectionMembership({
          ...scope,
          collectionId: privateCollection.id,
          documentId: document.id
        })).rejects.toThrow("STUDIO_COLLECTION_NOT_FOUND");
        await expect(repository.addCollectionMembership({
          ...scope,
          collectionId: strategy.id,
          documentId: "studio_document_missing"
        })).rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");

        expect(await repository.removeCollectionMembership(
          scope, strategy.id, document.id
        )).toBe(true);
        expect(await repository.removeCollectionMembership(
          scope, strategy.id, document.id
        )).toBe(false);
        expect(await repository.deleteCollection(scope, decisions.id)).toBe(true);
        expect(await repository.deleteCollection(scope, decisions.id)).toBe(false);
        expect(await repository.findDocument(scope, document.id)).toMatchObject({ id: document.id });
        expect(await repository.listDocumentCollections(scope, document.id)).toEqual([]);
      });
    });

    it("updates collection names without exposing cross-owner ids or mutable state", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const created = await repository.createCollection({ ...scope, name: "Original" });
        created.name = "external mutation";
        const persisted = await repository.findCollection(scope, created.id);
        expect(persisted?.name).toBe("Original");

        const updated = await repository.updateCollection({ ...persisted!, name: "Renomeada" });
        expect(updated.name).toBe("Renomeada");
        await expect(repository.updateCollection({
          ...updated,
          ownerProfileId: "owner_b",
          name: "Vazada"
        })).rejects.toThrow("STUDIO_COLLECTION_NOT_FOUND");
      });
    });

    it("searches the complete active owner corpus with deterministic lexical ranking", async () => {
      await withRepository(async (repository) => {
        const ownerScope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const exactTitle = await repository.createDocument(documentInput({
          title: "EXPANSÃO",
          bodyText: "Plano principal"
        }));
        const bodyMatch = await repository.createDocument(documentInput({
          title: "Reflexão",
          bodyText: "Talvez expansa\u0303o sustentável"
        }));
        await repository.createDocument(documentInput({
          title: "Expansão arquivada",
          bodyText: "expansao",
          status: "archived"
        }));
        await repository.createDocument(documentInput({
          ownerProfileId: "owner_b",
          title: "Expansão privada",
          bodyText: "expansao"
        }));

        const results = await repository.searchDocuments(ownerScope, {
          query: "expansao",
          limit: 10
        });
        expect(results.map((item) => item.id)).toEqual([exactTitle.id, bodyMatch.id]);
        expect(results.every((item) => !Object.hasOwn(item, "bodyJson"))).toBe(true);

        await repository.updateDocument({
          ...exactTitle,
          title: "Outro assunto",
          bodyText: "Sem o termo procurado"
        }, exactTitle.revision);
        expect((await repository.searchDocuments(ownerScope, {
          query: "expansao",
          limit: 10
        })).map((item) => item.id)).toEqual([bodyMatch.id]);
      });
    });

    it("supports final-token prefixes while keeping prior tokens exact and owner-active", async () => {
      await withRepository(async (repository) => {
        const ownerScope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const titlePrefix = await repository.createDocument(documentInput({
          title: "Expansão",
          bodyText: "Direção"
        }));
        const multiToken = await repository.createDocument(documentInput({
          title: "Plano de expansão",
          bodyText: "Direção"
        }));
        const shortExact = await repository.createDocument(documentInput({
          title: "Ex",
          bodyText: "Abreviação exata"
        }));
        await repository.createDocument(documentInput({
          title: "abcdefghijklmnopqrstuvwxyz",
          bodyText: "Token além do limite de prefixo"
        }));
        await repository.createDocument(documentInput({
          title: "Expansão arquivada",
          bodyText: "Direção",
          status: "archived"
        }));
        await repository.createDocument(documentInput({
          ownerProfileId: "owner_b",
          title: "Expansão privada",
          bodyText: "Direção"
        }));

        expect((await repository.searchDocuments(ownerScope, {
          query: "expan",
          limit: 10
        })).map((item) => item.id)).toEqual([titlePrefix.id, multiToken.id]);
        expect((await repository.searchDocuments(ownerScope, {
          query: "plano expan",
          limit: 10
        })).map((item) => item.id)).toEqual([multiToken.id]);
        expect((await repository.searchDocuments(ownerScope, {
          query: "ex",
          limit: 10
        })).map((item) => item.id)).toEqual([shortExact.id]);
        expect(await repository.searchDocuments(ownerScope, {
          query: "abcdefghijklmnopqrstuvwxy",
          limit: 10
        })).toEqual([]);
        expect(await repository.searchDocuments(ownerScope, {
          query: "% __ !!!",
          limit: 10
        })).toEqual([]);
      });
    });

    it("ranks shared folded literals before limit without treating percent or underscore as wildcards", async () => {
      await withRepository(async (repository) => {
        const ownerScope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const literal = await repository.createDocument(documentInput({
          title: "  META   % _  expansa\u0303o sustentável ",
          bodyText: "Literal"
        }));
        await repository.createDocument(documentInput({
          title: "meta qualquer coisa expansao sustentável",
          bodyText: "Wildcard trap"
        }));

        const results = await repository.searchDocuments(ownerScope, {
          query: "meta % _ expan",
          limit: 1
        });
        expect(results.map((item) => item.id)).toEqual([literal.id]);
      });
    });

    it("keeps exact final-token matches when bounded prefix generation reaches its cap", async () => {
      await withRepository(async (repository) => {
        const ownerScope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const indexedWords = Array.from({ length: 1_800 }, (_, index) => (
          `${fixedWidthBase26(index)}${"x".repeat(21)}`
        ));
        const exactTarget = "z".repeat(24);
        const shorterPrefix = indexedWords[0]!.slice(0, 8);
        const bodyText = [...indexedWords, exactTarget].join(" ");
        const fields = prepareStudioSearchFields(null, bodyText);
        expect(fields.prefixTokens).toHaveLength(STUDIO_SEARCH_MAX_PREFIX_TOKENS);
        expect(fields.prefixTokens).toContain(shorterPrefix);
        expect(fields.prefixTokens).not.toContain(exactTarget);

        const active = await repository.createDocument(documentInput({ bodyText }));
        await repository.createDocument(documentInput({
          bodyText: `${shorterPrefix} ${exactTarget}`,
          status: "archived"
        }));
        await repository.createDocument(documentInput({
          ownerProfileId: "owner_b",
          bodyText: `${shorterPrefix} ${exactTarget}`
        }));

        expect((await repository.searchDocuments(ownerScope, {
          query: exactTarget,
          limit: 10
        })).map((item) => item.id)).toEqual([active.id]);
        expect((await repository.searchDocuments(ownerScope, {
          query: shorterPrefix,
          limit: 10
        })).map((item) => item.id)).toEqual([active.id]);
      });
    });

    it("projects bounded home lists and an exact active pending-review count", async () => {
      await withRepository(async (repository) => {
        const ownerScope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const active = [];
        for (let index = 0; index < 12; index += 1) {
          active.push(await repository.createDocument(documentInput({
            bodyText: `Documento ${index}`,
            isFocused: index < 3,
            inboxState: index < 4 ? "reviewed" : "pending_review"
          })));
        }
        await repository.createDocument(documentInput({
          bodyText: "Arquivado",
          isFocused: true,
          status: "archived"
        }));
        await repository.createDocument(documentInput({
          ownerProfileId: "owner_b",
          bodyText: "Privado"
        }));

        const expectedAll = await repository.listDocuments(ownerScope, {
          status: "active",
          limit: 100
        });
        expect(await repository.listRecentDocuments(ownerScope, 10)).toEqual(expectedAll.items.slice(0, 10));
        expect((await repository.listFocusedDocuments(ownerScope, 10)).map((item) => item.id))
          .toEqual(expectedAll.items.filter((item) => item.isFocused).map((item) => item.id));
        expect(await repository.countPendingReviewDocuments(ownerScope)).toBe(8);
        expect(active).toHaveLength(12);
      });
    });

    it("persists owner-scoped assets and atomically claims only pending or retry-due work", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const document = await repository.createDocument(documentInput());
        const asset = await repository.createAsset({
          ...scope,
          documentId: document.id,
          kind: "file",
          displayName: "notes.txt",
          objectKey: "private/notes.txt",
          sourceUrl: null,
          finalUrl: null,
          fetchedAt: null,
          mimeType: "text/plain",
          sizeBytes: 5,
          extractionStatus: "pending",
          extractedText: null,
          extractionMetadata: {},
          lastErrorCode: null,
          attemptCount: 0,
          nextAttemptAt: null
        });

        expect(await repository.findAsset(
          { workspaceId: "workspace_a", ownerProfileId: "owner_b" }, asset.id
        )).toBeNull();
        const claims = await Promise.all([
          repository.claimNextAsset("2026-07-13T12:00:00.000Z"),
          repository.claimNextAsset("2026-07-13T12:00:00.000Z")
        ]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        expect(claims.find(Boolean)).toMatchObject({
          id: asset.id,
          extractionStatus: "processing",
          attemptCount: 1
        });

        const claimed = claims.find(Boolean)!;
        const failed = await repository.finishAssetProcessing({
          scope,
          assetId: claimed.id,
          claimToken: claimed.claimToken!,
          extractionStatus: "failed",
          extractedText: null,
          extractionMetadata: {},
          lastErrorCode: "TRANSIENT",
          nextAttemptAt: "2026-07-13T12:01:00.000Z"
        });
        expect(failed?.extractionStatus).toBe("failed");
        expect(await repository.claimNextAsset("2026-07-13T12:00:59.999Z")).toBeNull();
        expect(await repository.claimNextAsset("2026-07-13T12:01:00.000Z")).toMatchObject({
          id: asset.id,
          extractionStatus: "processing",
          attemptCount: 2
        });

        const cleanupJob = await repository.tombstoneAssetForCleanup(scope, asset.id);
        expect(cleanupJob).toMatchObject({ assetId: asset.id });
        expect(await repository.findAsset(scope, asset.id)).toBeNull();
        expect(await repository.tombstoneAssetForCleanup(scope, asset.id)).toMatchObject({ assetId: asset.id });
        const cleanupClaim = await repository.claimNextAssetCleanup("2026-07-13T12:02:00.000Z", 1_000);
        expect(cleanupClaim).toMatchObject({ id: cleanupJob!.id, status: "processing", attemptCount: 1 });
        const failedCleanup = await repository.failAssetCleanup({
          scope,
          jobId: cleanupClaim!.id,
          claimToken: cleanupClaim!.claimToken!,
          lastErrorCode: "STORAGE_DOWN",
          nextAttemptAt: "2026-07-13T12:03:00.000Z"
        });
        expect(failedCleanup).toMatchObject({ status: "failed", claimToken: null });
        expect(await repository.claimNextAssetCleanup("2026-07-13T12:02:59.999Z")).toBeNull();
        const retryCleanup = await repository.claimNextAssetCleanup("2026-07-13T12:03:00.000Z");
        expect(await repository.completeAssetCleanup({
          scope,
          jobId: retryCleanup!.id,
          claimToken: retryCleanup!.claimToken!
        })).toBe(true);
        expect(await repository.findAssetIncludingDeleting(scope, asset.id)).toBeNull();
        expect(await repository.listAssetCleanupJobs(scope)).toEqual([]);
      });
    });

    it("rejects assets whose document is outside the full owner scope", async () => {
      await withRepository(async (repository) => {
        const privateDocument = await repository.createDocument(documentInput({ ownerProfileId: "owner_b" }));
        await expect(repository.createAsset({
          workspaceId: "workspace_a",
          ownerProfileId: "owner_a",
          documentId: privateDocument.id,
          kind: "file",
          displayName: "private.txt",
          objectKey: "private/key",
          sourceUrl: null,
          finalUrl: null,
          fetchedAt: null,
          mimeType: "text/plain",
          sizeBytes: 1,
          extractionStatus: "pending",
          extractedText: null,
          extractionMetadata: {},
          lastErrorCode: null,
          attemptCount: 0,
          nextAttemptAt: null
        })).rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");
      });
    });

    it("terminalizes an expired fifth processing attempt and fences its stale worker", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const document = await repository.createDocument(documentInput());
        const asset = await repository.createAsset({
          ...scope, documentId: document.id, kind: "file", displayName: "crash.txt",
          objectKey: "private/crash.txt", sourceUrl: null, finalUrl: null, fetchedAt: null,
          mimeType: "text/plain", sizeBytes: 5, extractionStatus: "pending", extractedText: null,
          extractionMetadata: {}, lastErrorCode: null, attemptCount: 4, nextAttemptAt: null
        });
        const fifth = await repository.claimNextAsset("2026-07-13T12:00:00.000Z", 1_000);
        expect(fifth).toMatchObject({ id: asset.id, attemptCount: 5, extractionStatus: "processing" });

        expect(await repository.claimNextAsset("2026-07-13T12:00:01.000Z", 1_000)).toBeNull();
        expect(await repository.findAsset(scope, asset.id)).toMatchObject({
          extractionStatus: "failed",
          attemptCount: 5,
          lastErrorCode: "STUDIO_ASSET_LEASE_EXPIRED",
          nextAttemptAt: null,
          claimToken: null,
          leaseExpiresAt: null
        });
        expect(await repository.finishAssetProcessing({
          scope, assetId: asset.id, claimToken: fifth!.claimToken!, extractionStatus: "ready",
          extractedText: "late", extractionMetadata: {}, lastErrorCode: null, nextAttemptAt: null
        })).toBeNull();
      });
    });

    it("finalizes and reconciles durable owner-scoped upload intents idempotently", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const document = await repository.createDocument(documentInput());
        const intent = await repository.createAssetUploadIntent({
          ...scope, documentId: document.id, objectKey: "private/upload.txt", displayName: "upload.txt",
          kind: "file", mimeType: "text/plain", sizeBytes: 7,
          uploadLeaseExpiresAt: "2026-07-13T12:15:00.000Z"
        });
        const assetInput = {
          ...scope, documentId: document.id, kind: "file" as const, displayName: "upload.txt",
          objectKey: intent.objectKey, sourceUrl: null, finalUrl: null, fetchedAt: null,
          mimeType: "text/plain", sizeBytes: 7, extractionStatus: "pending" as const,
          extractedText: null, extractionMetadata: {}, lastErrorCode: null, attemptCount: 0, nextAttemptAt: null
        };
        expect(await repository.attachAssetUploadSession({
          scope, intentId: intent.id, uploadToken: intent.uploadToken!, storageUploadId: "multipart-upload-1"
        })).toBe(true);
        expect(await repository.attachAssetUploadSession({
          scope, intentId: intent.id, uploadToken: intent.uploadToken!, storageUploadId: "multipart-upload-2"
        })).toBe(false);
        const asset = await repository.finalizeAssetUpload({
          scope, intentId: intent.id, uploadToken: intent.uploadToken!, asset: assetInput
        });
        expect(await repository.finalizeAssetUpload({
          scope, intentId: intent.id, uploadToken: intent.uploadToken!, asset: assetInput
        }))
          .toMatchObject({ id: asset.id });
        expect(await repository.listAssetUploadIntents(scope)).toEqual([]);
        expect(await repository.reconcileAssetUploadFailure({
          scope, intentId: intent.id, uploadToken: intent.uploadToken!, objectKey: intent.objectKey,
          now: "2026-07-13T12:00:00.000Z"
        }))
          .toMatchObject({ id: asset.id });
        expect(await repository.findAssetByObjectKey(scope, intent.objectKey)).toMatchObject({ id: asset.id });
        expect(await repository.findAssetByObjectKey(
          { workspaceId: "workspace_a", ownerProfileId: "owner_b" }, intent.objectKey
        )).toBeNull();

        const orphan = await repository.createAssetUploadIntent({
          ...scope, documentId: document.id, objectKey: "private/orphan.txt", displayName: "orphan.txt",
          kind: "file", mimeType: "text/plain", sizeBytes: 6,
          uploadLeaseExpiresAt: "2026-07-13T12:15:00.000Z"
        });
        expect(await repository.reconcileAssetUploadFailure({
          scope, intentId: orphan.id, uploadToken: orphan.uploadToken!, objectKey: orphan.objectKey,
          now: "2026-07-13T12:00:00.000Z"
        }))
          .toBeNull();
        const claimed = await repository.claimNextAssetUploadCleanup("2026-07-13T12:00:00.000Z", 1_000);
        expect(claimed).toMatchObject({ id: orphan.id, status: "processing", attemptCount: 1 });
        expect(await repository.completeAssetUploadCleanup({
          scope: { workspaceId: "workspace_a", ownerProfileId: "owner_b" },
          intentId: orphan.id, claimToken: claimed!.claimToken!
        })).toBe(false);
        expect(await repository.completeAssetUploadCleanup({
          scope, intentId: orphan.id, claimToken: claimed!.claimToken!
        })).toBe(true);
      });
    });

    it("never claims an actively leased upload and fences lease renewal by token", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const document = await repository.createDocument(documentInput());
        const intent = await repository.createAssetUploadIntent({
          ...scope,
          documentId: document.id,
          objectKey: "private/slow-upload.txt",
          displayName: "slow-upload.txt",
          kind: "file",
          mimeType: "text/plain",
          sizeBytes: 12,
          uploadLeaseExpiresAt: "2026-07-13T12:10:00.000Z"
        });
        expect(await repository.claimNextAssetUploadCleanup("2026-07-13T12:09:59.999Z", 1_000)).toBeNull();
        expect(await repository.renewAssetUploadIntentLease({
          scope,
          intentId: intent.id,
          uploadToken: "stale-token",
          uploadLeaseExpiresAt: "2026-07-13T12:20:00.000Z"
        })).toBe(false);
        expect(await repository.renewAssetUploadIntentLease({
          scope,
          intentId: intent.id,
          uploadToken: intent.uploadToken!,
          uploadLeaseExpiresAt: "2026-07-13T12:20:00.000Z"
        })).toBe(true);
        expect(await repository.claimNextAssetUploadCleanup("2026-07-13T12:10:00.000Z", 1_000)).toBeNull();
        expect(await repository.claimNextAssetUploadCleanup("2026-07-13T12:20:00.000Z", 1_000))
          .toMatchObject({ id: intent.id, status: "processing", uploadToken: null });
      });
    });

    it("removes associated private upload metadata when an asset is tombstoned", async () => {
      await withRepository(async (repository) => {
        const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
        const document = await repository.createDocument(documentInput());
        const objectKey = "private/associated-secret.txt";
        await repository.createAssetUploadIntent({
          ...scope,
          documentId: document.id,
          objectKey,
          displayName: "associated-secret.txt",
          kind: "file",
          mimeType: "text/plain",
          sizeBytes: 6,
          uploadLeaseExpiresAt: "2026-07-13T12:20:00.000Z"
        });
        const asset = await repository.createAsset({
          ...scope, documentId: document.id, kind: "file", displayName: "associated-secret.txt",
          objectKey, sourceUrl: null, finalUrl: null, fetchedAt: null, mimeType: "text/plain",
          sizeBytes: 6, extractionStatus: "pending", extractedText: null, extractionMetadata: {},
          lastErrorCode: null, attemptCount: 0, nextAttemptAt: null
        });
        await repository.tombstoneAssetForCleanup(scope, asset.id);
        expect(await repository.listAssetUploadIntents(scope)).toEqual([]);
      });
    });
  });
}

repositoryContract("in-memory", async () => ({
  repository: createInMemoryStudioRepository(),
  async cleanup() {}
}));

describe("in-memory StudioRepository clock behavior", () => {
  it("normalizes a valid noncanonical clock before cursor round-tripping", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-13T12:00:00Z" });
    const created = await Promise.all([
      repository.createDocument(documentInput({ bodyText: "first" })),
      repository.createDocument(documentInput({ bodyText: "second" })),
      repository.createDocument(documentInput({ bodyText: "third" }))
    ]);
    expect(created.every((document) =>
      document.createdAt === "2026-07-13T12:00:00.000Z"
      && document.updatedAt === "2026-07-13T12:00:00.000Z"
    )).toBe(true);

    const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const firstPage = await repository.listDocuments(scope, { limit: 2 });
    expect(firstPage.nextCursor).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(firstPage.nextCursor!, "base64url").toString("utf8"));
    expect(decoded.updatedAt).toBe("2026-07-13T12:00:00.000Z");
    const secondPage = await repository.listDocuments(scope, {
      limit: 2,
      cursor: firstPage.nextCursor!
    });
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([...firstPage.items, ...secondPage.items].map((document) => document.id))).toEqual(
      new Set(created.map((document) => document.id))
    );
  });

  it("rejects an invalid injected clock without storing a document", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "not-a-date" });

    await expect(repository.createDocument(documentInput()))
      .rejects.toThrowError(/^STUDIO_CLOCK_INVALID$/);
    expect(await repository.listDocuments(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
      { limit: 10 }
    )).toEqual({ items: [], nextCursor: null });
  });

  it("keeps version timestamps monotonic when the clock is frozen", async () => {
    const fixedTimestamp = "2026-07-13T12:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => fixedTimestamp });
    const created = await repository.createDocument(documentInput());
    const updated = await repository.updateDocument(
      { ...created, bodyText: "updated" },
      created.revision
    );
    await repository.appendVersion({
      workspaceId: created.workspaceId,
      ownerProfileId: created.ownerProfileId,
      documentId: created.id,
      bodyJson: { type: "doc", content: [] },
      bodyText: "appended",
      origin: "user",
      actorProfileId: created.ownerProfileId,
      aiRunId: null
    });

    const versions = await repository.listVersions(
      { workspaceId: created.workspaceId, ownerProfileId: created.ownerProfileId },
      created.id
    );
    expect(versions.map((version) => version.createdAt)).toEqual([
      "2026-07-13T12:00:00.000Z",
      "2026-07-13T12:00:00.001Z",
      "2026-07-13T12:00:00.002Z"
    ]);
    expect(versions[1]!.createdAt >= updated.updatedAt).toBe(true);
  });

  it("orders equal-timestamp collections by id in lists and document context", async () => {
    const fixedTimestamp = "2026-07-13T12:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => fixedTimestamp });
    const ownerScope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const document = await repository.createDocument(documentInput());
    const collections = [];
    for (let index = 0; index < 8; index += 1) {
      const collection = await repository.createCollection({ ...ownerScope, name: `Coleção ${index}` });
      collections.push(collection);
      await repository.addCollectionMembership({
        ...ownerScope,
        collectionId: collection.id,
        documentId: document.id
      });
    }
    const expectedIds = collections.map((item) => item.id).sort((left, right) => left.localeCompare(right));

    expect((await repository.listCollections(ownerScope)).map((item) => item.id)).toEqual(expectedIds);
    expect((await repository.listDocumentCollections(ownerScope, document.id)).map((item) => item.id))
      .toEqual(expectedIds);
  });
});

type PostgresRepositoryFixture = RepositoryFixture & { pool: Pool };

async function createPostgresRepositoryFixture(): Promise<PostgresRepositoryFixture> {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const admin = new Pool({ connectionString: testDatabaseUrl });
  const schema = `baase_studio_repository_${process.pid}_${Date.now()}_${schemaSequence++}`;
  let pool: Pool | undefined;
  let schemaCreated = false;
  const cleanup = async () => {
    try {
      await pool?.end();
    } finally {
      try {
        if (schemaCreated) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    }
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    pool = new Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schema}` });
    await ensureOperationalSchema(pool);
  } catch (error) {
    await cleanup();
    throw error;
  }
  if (!pool) throw new Error("PostgreSQL Studio repository fixture failed to initialize");
  return {
    pool,
    repository: createPostgresStudioRepository(pool),
    cleanup
  };
}

repositoryContract("PostgreSQL", createPostgresRepositoryFixture, !testDatabaseUrl);

describe.skipIf(!testDatabaseUrl)("PostgreSQL Studio derived search fields", () => {
  it("keeps derived values stable through focus, archive, and restore updates", async () => {
    const fixture = await createPostgresRepositoryFixture();
    try {
      const created = await fixture.repository.createDocument(documentInput({
        title: "Expansão sustentável",
        bodyText: "Decisão com acentuação"
      }));
      const readSearchFields = async () => {
        const result = await fixture.pool.query<{
          search_title_folded: string;
          search_body_folded: string;
          search_tokens: string[];
          search_prefix_tokens: string[];
        }>(
          `SELECT search_title_folded,search_body_folded,search_tokens,search_prefix_tokens
           FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
          [created.workspaceId, created.ownerProfileId, created.id]
        );
        return result.rows[0];
      };
      const originalSearchFields = await readSearchFields();
      expect(originalSearchFields).toBeDefined();

      let updated = await fixture.repository.updateDocument({
        ...created,
        isFocused: true
      }, created.revision);
      expect(await readSearchFields()).toEqual(originalSearchFields);

      updated = await fixture.repository.updateDocument({
        ...updated,
        status: "archived",
        archivedAt: "2026-07-13T15:00:00.000Z"
      }, updated.revision);
      expect(await readSearchFields()).toEqual(originalSearchFields);

      await fixture.repository.updateDocument({
        ...updated,
        status: "active",
        archivedAt: null
      }, updated.revision);
      expect(await readSearchFields()).toEqual(originalSearchFields);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("PostgreSQL repository bundle", () => {
  it("uses the relational Studio repository for either operational store", async () => {
    const statements: string[] = [];
    const pool: OperationalPool = {
      async query<T>(text: string) {
        statements.push(text);
        return { rows: [] as T[] };
      },
      async connect() {
        throw new Error("connect should not be called");
      }
    };

    await createConfiguredPostgresRepositoryBundle(pool, "jsonb").studioRepository.findDocument(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
      "document_a"
    );
    await createConfiguredPostgresRepositoryBundle(pool, "relational").studioRepository.findDocument(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
      "document_a"
    );

    expect(statements).toHaveLength(2);
    expect(statements.every((statement) => statement.includes("FROM studio_documents"))).toBe(true);
  });
});
