import type { FastifyRequest } from "fastify";
import type { BaaseRole } from "@prymeira/baase-shared";
import { ApiError } from "./api-error";
import type { ExternalAccountIdentity, OperationalMembership } from "../modules/company/company.types";

const allowedRoles = new Set<BaaseRole>(["owner", "manager", "employee"]);

export type RequestContext = {
  workspaceId: string;
  workspaceName?: string;
  role: BaaseRole;
  profileId: string;
  profileName?: string;
  accountAuthenticated?: boolean;
  externalIdentity?: ExternalAccountIdentity;
  operationalMembership?: OperationalMembership;
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

export function requireOperationalMembership(request: FastifyRequest): OperationalMembership {
  const context = readRequestContext(request);
  if (context.accountAuthenticated && !context.operationalMembership) {
    throw new ApiError(403, "BAASE_MEMBERSHIP_REQUIRED", "Seu acesso ao Baase ainda precisa ser vinculado por um dono.");
  }
  if (context.operationalMembership) return context.operationalMembership;
  return {
    person: {
      id: context.profileId,
      workspaceId: context.workspaceId,
      name: context.profileName ?? "Usuário local",
      email: null,
      role: context.role,
      areaId: null,
      areaAccessIds: [],
      roleTemplateId: null,
      accessScope: "workspace",
      clerkUserId: null,
      customerId: null,
      status: "active",
      createdByProfileId: context.profileId,
      createdAt: "",
      updatedAt: ""
    },
    personId: context.profileId,
    role: context.role,
    accessScope: "workspace",
    areaAccessIds: []
  };
}
