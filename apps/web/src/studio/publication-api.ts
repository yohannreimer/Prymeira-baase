import type { UiRole } from "../api";
import { studioRequest, studioRequestForRole } from "./studio-api";

export type Publication = {
  id: string; resourceType: "studio_document" | "process"; resourceId: string;
  format: "pdf" | "zip"; status: "ready" | "failed"; title: string;
  sizeBytes: number | null; createdAt: string;
};

export async function createPublication(resourceType: Publication["resourceType"], resourceId: string, format: Publication["format"], role: UiRole = "dono") {
  const response = await studioRequestForRole<{ publication: Publication }>(role, "/publications", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId, format })
  });
  return response.publication;
}

export async function downloadPublication(publicationId: string, role: UiRole = "dono") {
  const response = await studioRequestForRole<{ url: string }>(role, `/publications/${encodeURIComponent(publicationId)}/download`);
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
