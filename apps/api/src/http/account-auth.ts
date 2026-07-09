import type { FastifyInstance, FastifyRequest } from "fastify";
import { BAASE_PRODUCT_KEY, type BaaseRole } from "@prymeira/baase-shared";
import type { BaaseRuntimeConfig } from "../config/runtime";
import { ApiError } from "./api-error";
import type { AuthenticatedRequest, RequestContext } from "./auth-context";

export type AccountAccessDecision = {
  allowed: boolean;
  workspace_id?: string;
  workspace_role?: string;
  product_key: string;
  product_role?: string;
  status: string;
  reason: string;
  upgrade_url?: string;
};

export type AccountAuthOptions = {
  runtimeConfig: BaaseRuntimeConfig;
  fetcher?: typeof fetch;
};

const publicRoutes = new Set(["GET /health", "GET /readiness"]);

export function registerAccountAuthHook(app: FastifyInstance, options: AccountAuthOptions) {
  if (options.runtimeConfig.auth.mode !== "account") return;

  app.addHook("onRequest", async (request) => {
    if (isPublicRequest(request)) return;

    (request as AuthenticatedRequest).baaseContext = await resolveAccountRequestContext(request, options);
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

  if (!decision.workspace_id) {
    throw new ApiError(502, "ACCOUNT_AUTH_INVALID_RESPONSE", "Account Hub autorizou acesso sem workspace.");
  }

  const role = mapAccountRole(decision);
  return {
    workspaceId: decision.workspace_id,
    role,
    profileId: `account_${sanitizeProfileSuffix(decision.product_role ?? decision.workspace_role ?? role)}`
  };
}

function isPublicRequest(request: FastifyRequest) {
  const method = request.method.toUpperCase();
  const path = request.url.split("?")[0] ?? request.url;
  if (method === "OPTIONS") return true;
  if (publicRoutes.has(`${method} ${path}`)) return true;
  if (method === "GET" && /^\/invites\/[^/]+$/.test(path)) return true;
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

function mapAccountRole(decision: AccountAccessDecision): BaaseRole {
  if (decision.product_role === "owner" || decision.product_role === "manager" || decision.product_role === "employee") {
    return decision.product_role;
  }
  if (decision.product_role === "admin" || decision.workspace_role === "owner") return "owner";
  return "employee";
}

function sanitizeProfileSuffix(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "user";
}
