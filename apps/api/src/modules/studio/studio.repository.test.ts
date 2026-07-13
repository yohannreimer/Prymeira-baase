import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ensureOperationalSchema } from "../../db/operational-schema";
import { createConfiguredPostgresRepositoryBundle } from "../../db/postgres";
import type { OperationalPool } from "../../db/operational-repository-support";
import type { StudioDocument, StudioRepository } from "./studio.types";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createPostgresStudioRepository } from "./postgres-studio.repository";

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
});

repositoryContract("PostgreSQL", async () => {
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
    repository: createPostgresStudioRepository(pool),
    cleanup
  };
}, !testDatabaseUrl);

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
