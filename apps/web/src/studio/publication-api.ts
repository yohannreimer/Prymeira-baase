import { studioRequest } from "./studio-api";

export type Publication = {
  id: string; resourceType: "studio_document" | "process"; resourceId: string;
  format: "pdf" | "zip"; status: "ready" | "failed"; title: string;
  sizeBytes: number | null; createdAt: string;
};

export async function createPublication(resourceType: Publication["resourceType"], resourceId: string, format: Publication["format"]) {
  const response = await studioRequest<{ publication: Publication }>("/publications", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId, format })
  });
  return response.publication;
}

export async function downloadPublication(publicationId: string) {
  const response = await studioRequest<{ url: string }>(`/publications/${encodeURIComponent(publicationId)}/download`);
  return response.url;
}

export async function createPublicationExternalLink(publicationId: string, expiresAt: string) {
  const response = await studioRequest<{ grant: { id: string; expiresAt: string }; token: string }>(
    `/publications/${encodeURIComponent(publicationId)}/external-links`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expires_at: expiresAt })
    }
  );
  return { ...response, url: `${globalThis.location.origin}/api/publications/public/${encodeURIComponent(response.token)}` };
}
