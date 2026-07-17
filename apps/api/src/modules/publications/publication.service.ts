import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { ProcessRepository } from "../processes/process.types";
import type { StudioOwnerScope, StudioRepository } from "../studio/studio.types";
import type { ObjectStorage } from "../../storage/object-storage";
import { processSopHtml } from "./templates/process-sop";
import { studioSheetHtml } from "./templates/studio-sheet";
import type { Publication, PublicationFormat, PublicationRenderer, PublicationResourceType, PublicationStore } from "./publication.types";
import { createStoredZip, type ZipEntry } from "./publication-zip";

export type CreatePublicationInput = StudioOwnerScope & {
  resourceType: PublicationResourceType;
  resourceId: string;
  format: PublicationFormat;
  workspaceName: string;
  profileName: string;
};

export function createPublicationService(dependencies: {
  store: PublicationStore;
  renderer: PublicationRenderer;
  objectStorage: ObjectStorage;
  studioRepository: StudioRepository;
  processRepository: ProcessRepository;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  return {
    async create(input: CreatePublicationInput): Promise<Publication> {
      const source = await loadSource(input);
      try {
        const pdf = await dependencies.renderer.renderPdf(source.html);
        const output = input.format === "pdf" ? pdf : createStoredZip([
          { name: `${safeFilename(source.title)}.pdf`, body: pdf },
          ...await source.bundleEntries()
        ], now());
        const contentType = input.format === "pdf" ? "application/pdf" : "application/zip";
        const objectKey = `publications/${input.workspaceId}/${input.ownerProfileId}/${randomBytes(12).toString("hex")}.${input.format}`;
        await dependencies.objectStorage.put({ key: objectKey, body: Readable.from(output), contentType, sizeBytes: output.length });
        return dependencies.store.create({
          workspaceId: input.workspaceId, ownerProfileId: input.ownerProfileId,
          resourceType: input.resourceType, resourceId: input.resourceId, format: input.format,
          status: "ready", title: source.title, objectKey, contentType, sizeBytes: output.length, errorCode: null
        });
      } catch (error) {
        await dependencies.store.create({
          workspaceId: input.workspaceId, ownerProfileId: input.ownerProfileId,
          resourceType: input.resourceType, resourceId: input.resourceId, format: input.format,
          status: "failed", title: source.title, objectKey: null, contentType: null, sizeBytes: null,
          errorCode: error instanceof Error ? error.message.slice(0, 120) : "PUBLICATION_RENDER_FAILED"
        });
        throw publicationError("PUBLICATION_RENDER_FAILED");
      }
    },
    async find(scope: StudioOwnerScope, publicationId: string) {
      const publication = await dependencies.store.find(scope.workspaceId, publicationId);
      if (!publication || publication.ownerProfileId !== scope.ownerProfileId) throw publicationError("PUBLICATION_NOT_FOUND");
      return publication;
    },
    async createDownloadUrl(scope: StudioOwnerScope, publicationId: string) {
      const publication = await this.find(scope, publicationId);
      if (publication.status !== "ready" || !publication.objectKey) throw publicationError("PUBLICATION_NOT_READY");
      return dependencies.objectStorage.createDownloadUrl(publication.objectKey, 300, {
        downloadFilename: `${safeFilename(publication.title)}.${publication.format}`
      });
    },
    async createExternalGrant(scope: StudioOwnerScope, publicationId: string, expiresAt: string) {
      const publication = await this.find(scope, publicationId);
      if (publication.status !== "ready") throw publicationError("PUBLICATION_NOT_READY");
      const expiry = new Date(expiresAt);
      if (Number.isNaN(expiry.getTime()) || expiry <= now() || expiry.getTime() > now().getTime() + 90 * 86_400_000) {
        throw publicationError("PUBLICATION_EXPIRY_INVALID");
      }
      const token = randomBytes(32).toString("base64url");
      const grant = await dependencies.store.createGrant({ publicationId, tokenHash: hashToken(token), expiresAt: expiry.toISOString() });
      return { grant, token, publication };
    },
    async resolveExternal(token: string) {
      const match = await dependencies.store.findGrantByHash(hashToken(token));
      if (!match || match.grant.revokedAt || new Date(match.grant.expiresAt) <= now()) throw publicationError("PUBLICATION_LINK_UNAVAILABLE");
      if (!match.publication.objectKey || match.publication.status !== "ready") throw publicationError("PUBLICATION_LINK_UNAVAILABLE");
      const url = await dependencies.objectStorage.createDownloadUrl(match.publication.objectKey, 120, {
        downloadFilename: `${safeFilename(match.publication.title)}.${match.publication.format}`
      });
      return { ...match, url };
    },
    async revokeExternalGrant(scope: StudioOwnerScope, publicationId: string, grantId: string) {
      await this.find(scope, publicationId);
      if (!await dependencies.store.revokeGrant(scope.workspaceId, publicationId, grantId, now().toISOString())) {
        throw publicationError("PUBLICATION_GRANT_NOT_FOUND");
      }
    }
  };

  async function loadSource(input: CreatePublicationInput) {
    if (input.resourceType === "studio_document") {
      const scope = { workspaceId: input.workspaceId, ownerProfileId: input.ownerProfileId };
      const document = await dependencies.studioRepository.findDocument(scope, input.resourceId);
      if (!document || document.status === "trashed") throw publicationError("PUBLICATION_SOURCE_NOT_FOUND");
      const assets = (await dependencies.studioRepository.listDocumentAssets(scope, document.id))
        .filter((asset) => asset.lifecycleStatus === "active");
      return {
        title: document.title?.trim() || "Folha sem título",
        html: studioSheetHtml({ document, assets, workspaceName: input.workspaceName, authorName: input.profileName }),
        bundleEntries: async () => bundleStudioAssets(assets)
      };
    }
    const process = await dependencies.processRepository.findProcess(input.workspaceId, input.resourceId);
    if (!process) throw publicationError("PUBLICATION_SOURCE_NOT_FOUND");
    return {
      title: process.title,
      html: processSopHtml({ process, workspaceName: input.workspaceName }),
      bundleEntries: async () => {
        const files: ZipEntry[] = [];
        const links: string[] = [];
        for (const material of process.materials ?? []) {
          if (material.objectKey) files.push({ name: `materiais/${safeFilename(material.title)}`, body: await readObject(material.objectKey) });
          else if (material.url) links.push(`${material.title}\n${material.url}`);
        }
        if (links.length) files.push({ name: "materiais/links.txt", body: Buffer.from(`${links.join("\n\n")}\n`, "utf8") });
        return files;
      }
    };
  }

  async function bundleStudioAssets(assets: Awaited<ReturnType<StudioRepository["listDocumentAssets"]>>) {
    const entries: ZipEntry[] = [];
    const links: string[] = [];
    const used = new Map<string, number>();
    for (const asset of assets) {
      if (asset.objectKey) {
        const base = safeFilename(asset.displayName);
        const count = used.get(base) ?? 0; used.set(base, count + 1);
        const name = count ? `${base}-${count + 1}` : base;
        entries.push({ name: `materiais/${name}`, body: await readObject(asset.objectKey) });
      } else if (asset.finalUrl ?? asset.sourceUrl) links.push(`${asset.displayName}\n${asset.finalUrl ?? asset.sourceUrl}`);
    }
    if (links.length) entries.push({ name: "materiais/links.txt", body: Buffer.from(`${links.join("\n\n")}\n`, "utf8") });
    return entries;
  }

  async function readObject(key: string) {
    const object = await dependencies.objectStorage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}

export type PublicationService = ReturnType<typeof createPublicationService>;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const safeFilename = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
  .replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 100) || "documento";
const publicationError = (code: string) => Object.assign(new Error(code), { code });
