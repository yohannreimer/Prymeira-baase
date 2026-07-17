export type PublicationResourceType = "studio_document" | "process";
export type PublicationFormat = "pdf" | "zip";
export type PublicationStatus = "ready" | "failed";

export type Publication = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  resourceType: PublicationResourceType;
  resourceId: string;
  format: PublicationFormat;
  status: PublicationStatus;
  title: string;
  objectKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  errorCode: string | null;
  createdAt: string;
};

export type PublicationExternalGrant = {
  id: string;
  publicationId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type PublicationStore = {
  create(input: Omit<Publication, "id" | "createdAt">): Promise<Publication>;
  find(workspaceId: string, id: string): Promise<Publication | null>;
  createGrant(input: Omit<PublicationExternalGrant, "id" | "createdAt" | "revokedAt">): Promise<PublicationExternalGrant>;
  findGrantByHash(tokenHash: string): Promise<{ publication: Publication; grant: PublicationExternalGrant } | null>;
  revokeGrant(workspaceId: string, publicationId: string, grantId: string, revokedAt: string): Promise<boolean>;
};

export type PublicationRenderer = {
  renderPdf(html: string): Promise<Buffer>;
};
