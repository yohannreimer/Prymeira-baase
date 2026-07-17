import type { FastifyInstance, FastifyRequest } from "fastify";
import { BAASE_PRODUCT_KEY, type BaaseRole } from "@prymeira/baase-shared";
import type { BaaseRuntimeConfig } from "../config/runtime";
import { ApiError } from "./api-error";
import type { AuthenticatedRequest, RequestContext } from "./auth-context";
import type { CompanyRepository, ExternalAccountIdentity } from "../modules/company/company.types";
import { createOperationalMembershipResolver, type HubAccountProfile } from "../modules/company/operational-membership.service";

export type AccountAccessDecision = {
  allowed: boolean;
  workspace_id?: string;
  workspace_name?: string;
  workspace_role?: string;
  product_key: string;
  product_role?: string;
  customer_id?: string;
  customer_name?: string;
  status: string;
  reason: string;
  upgrade_url?: string;
};

export type AccountAuthOptions = {
  runtimeConfig: BaaseRuntimeConfig;
  companyRepository: CompanyRepository;
  fetcher?: typeof fetch;
};

const publicRoutes = new Set(["GET /health", "GET /readiness"]);

export function registerAccountAuthHook(app: FastifyInstance, options: AccountAuthOptions) {
  if (options.runtimeConfig.auth.mode !== "account") return;
  const fetcher = options.fetcher ?? fetch;
  const resolver = createOperationalMembershipResolver({
    repository: options.companyRepository,
    loadHubProfile: (identity) => fetchHubProfile(options.runtimeConfig.auth.accountApiUrl, identity.bearerToken, fetcher)
  });

  app.addHook("onRequest", async (request) => {
    if (isPublicRequest(request)) return;
    const context = await resolveAccountRequestContext(request, { ...options, fetcher });
    const identity = context.externalIdentity!;
    try {
      const membership = await resolver.resolve(identity);
      (request as AuthenticatedRequest).baaseContext = {
        ...context,
        role: membership.role,
        profileId: membership.personId,
        profileName: membership.person.name,
        operationalMembership: membership
      };
    } catch (error) {
      if (error instanceof Error && error.message === "BAASE_MEMBERSHIP_REQUIRED") {
        throw new ApiError(403, "BAASE_MEMBERSHIP_REQUIRED", "Seu acesso ao Baase ainda precisa ser vinculado por um dono.");
      }
      if (error instanceof Error && error.message === "BAASE_MEMBERSHIP_CONFLICT") {
        throw new ApiError(409, "BAASE_MEMBERSHIP_CONFLICT", "Há mais de uma pessoa possível para este acesso. Peça ao dono para resolver o vínculo.");
      }
      throw error;
    }
  });
}

export async function resolveAccountRequestContext(
  request: FastifyRequest,
  options: AccountAuthOptions
): Promise<RequestContext> {
  const accountApiUrl = options.runtimeConfig.auth.accountApiUrl;
  if (!accountApiUrl) {
    throw new ApiError(500, "ACCOUNT_AUTH_NOT_CONFIGURED", "Account Hub não configurado para autenticação do Baase.");
  }

  const authorization = readAuthorizationHeader(request);
  const decision = await fetchAccessDecision(accountApiUrl, authorization, options.fetcher ?? fetch);

  if (!decision.allowed) {
    throw new ApiError(403, "PRODUCT_ACCESS_DENIED", "Acesso ao Baase não liberado para este usuário.", {
      product_key: decision.product_key,
      reason: decision.reason,
      ...(decision.upgrade_url ? { upgrade_url: decision.upgrade_url } : {})
    });
  }

  if (!decision.workspace_id || !decision.customer_id) {
    throw new ApiError(502, "ACCOUNT_AUTH_INVALID_RESPONSE", "Account Hub autorizou acesso sem workspace.");
  }

  const role = mapAccountRole(decision);
  const workspaceName = readOptionalString(decision.workspace_name);
  const profileName = readOptionalString(decision.customer_name);
  const bearerToken = authorization.slice("Bearer ".length).trim();
  const externalIdentity: ExternalAccountIdentity = {
    workspaceId: decision.workspace_id,
    workspaceName,
    clerkUserId: readClerkUserIdFromBearerToken(bearerToken),
    customerId: decision.customer_id,
    productRole: readOptionalString(decision.product_role) ?? readOptionalString(decision.workspace_role) ?? null,
    profileName,
    bearerToken
  };

  return {
    workspaceId: decision.workspace_id,
    workspaceName,
    role,
    profileId: `account_${sanitizeProfileSuffix(decision.customer_id)}`,
    profileName,
    accountAuthenticated: true,
    externalIdentity
  };
}

function isPublicRequest(request: FastifyRequest) {
  const method = request.method.toUpperCase();
  const path = request.url.split("?")[0] ?? request.url;
  if (method === "OPTIONS") return true;
  if (publicRoutes.has(`${method} ${path}`)) return true;
  if (method === "GET" && /^\/invites\/[^/]+$/.test(path)) return true;
  if (method === "GET" && /^\/publications\/public\/[^/]+$/.test(path)) return true;
  if (method === "POST" && /^\/invites\/[^/]+\/accept$/.test(path)) return true;
  return false;
}

function readAuthorizationHeader(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || authorization.slice("Bearer ".length).trim().length === 0) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }
  return authorization;
}

async function fetchAccessDecision(accountApiUrl: string, authorization: string, fetcher: typeof fetch) {
  const response = await fetcher(`${accountApiUrl}/access-check?product_key=${BAASE_PRODUCT_KEY}`, {
    headers: {
      Authorization: authorization
    }
  });

  if (!response.ok) {
    throw new ApiError(502, "ACCOUNT_AUTH_FAILED", "Não foi possível validar acesso no Account Hub.", {
      status: response.status
    });
  }

  return response.json() as Promise<AccountAccessDecision>;
}

async function fetchHubProfile(accountApiUrl: string | null, bearerToken: string, fetcher: typeof fetch): Promise<HubAccountProfile> {
  if (!accountApiUrl) throw new ApiError(500, "ACCOUNT_AUTH_NOT_CONFIGURED", "Account Hub não configurado para autenticação do Baase.");
  const response = await fetcher(`${accountApiUrl}/me/products`, {
    headers: { Authorization: `Bearer ${bearerToken}` }
  });
  if (!response.ok) throw new ApiError(502, "ACCOUNT_PROFILE_FAILED", "Não foi possível identificar o usuário no Account Hub.");
  const payload = await response.json() as { customer?: { email?: unknown; name?: unknown } | null };
  const email = typeof payload.customer?.email === "string" ? payload.customer.email.trim().toLowerCase() : "";
  if (!email) throw new ApiError(502, "ACCOUNT_PROFILE_INVALID", "O Account Hub não retornou um e-mail para este usuário.");
  return {
    email,
    name: typeof payload.customer?.name === "string" && payload.customer.name.trim() ? payload.customer.name.trim() : null
  };
}

function mapAccountRole(decision: AccountAccessDecision): BaaseRole {
  if (decision.product_role === "owner" || decision.product_role === "manager" || decision.product_role === "employee") {
    return decision.product_role;
  }
  if (decision.product_role === "admin" || decision.workspace_role === "owner") return "owner";
  return "employee";
}

function readClerkUserIdFromBearerToken(token: string) {
  const [, payload] = token.split(".");
  if (!payload) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  try {
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { sub?: unknown };
    if (typeof decoded.sub !== "string" || !decoded.sub) throw new Error("missing_sub");
    return decoded.sub;
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }
}

function sanitizeProfileSuffix(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "user";
}

function readOptionalString(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}
