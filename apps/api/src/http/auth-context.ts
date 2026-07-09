import type { FastifyRequest } from "fastify";
import type { BaaseRole } from "@prymeira/baase-shared";

const allowedRoles = new Set<BaaseRole>(["owner", "manager", "employee"]);

export type RequestContext = {
  workspaceId: string;
  workspaceName?: string;
  role: BaaseRole;
  profileId: string;
  profileName?: string;
  accountAuthenticated?: boolean;
};

export type AuthenticatedRequest = FastifyRequest & {
  baaseContext?: RequestContext;
};

export function readRequestContext(request: FastifyRequest): RequestContext {
  const authenticatedContext = (request as AuthenticatedRequest).baaseContext;
  if (authenticatedContext) return authenticatedContext;

  const workspaceId = request.headers["x-baase-workspace-id"];
  const role = request.headers["x-baase-role"];
  const profileId = request.headers["x-baase-profile-id"];

  return {
    workspaceId: typeof workspaceId === "string" && workspaceId.trim() ? workspaceId : "local_workspace",
    role: typeof role === "string" && allowedRoles.has(role as BaaseRole) ? (role as BaaseRole) : "owner",
    profileId: typeof profileId === "string" && profileId.trim() ? profileId : "local_profile"
  };
}
