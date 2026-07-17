import { randomUUID } from "node:crypto";
import type { Publication, PublicationExternalGrant, PublicationStore } from "./publication.types";

export function createInMemoryPublicationStore(now: () => Date = () => new Date()): PublicationStore {
  const publications: Publication[] = [];
  const grants: PublicationExternalGrant[] = [];
  return {
    async create(input) {
      const publication = { ...input, id: `publication_${randomUUID()}`, createdAt: now().toISOString() };
      publications.push(publication);
      return publication;
    },
    async find(workspaceId, id) {
      return publications.find((item) => item.workspaceId === workspaceId && item.id === id) ?? null;
    },
    async createGrant(input) {
      const grant = {
        ...input,
        id: `publication_grant_${randomUUID()}`,
        revokedAt: null,
        createdAt: now().toISOString()
      };
      grants.push(grant);
      return grant;
    },
    async findGrantByHash(tokenHash) {
      const grant = grants.find((item) => item.tokenHash === tokenHash) ?? null;
      if (!grant) return null;
      const publication = publications.find((item) => item.id === grant.publicationId) ?? null;
      return publication ? { publication, grant } : null;
    },
    async revokeGrant(workspaceId, publicationId, grantId, revokedAt) {
      const grant = grants.find((item) => item.id === grantId && item.publicationId === publicationId);
      const publication = publications.find((item) => item.id === publicationId && item.workspaceId === workspaceId);
      if (!grant || !publication) return false;
      grant.revokedAt = revokedAt;
      return true;
    }
  };
}
