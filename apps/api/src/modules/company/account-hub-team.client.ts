import { ApiError } from "../../http/api-error";

export type HubInviteResult = {
  status: "active" | "pending";
  invitationId: string | null;
};

export type AccountHubTeamClientOptions = {
  accountApiUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export function createAccountHubTeamClient(options: AccountHubTeamClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const accountApiUrl = options.accountApiUrl.replace(/\/$/, "");

  return {
    async inviteBaseMember(input: { bearerToken: string; email: string; name: string }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetcher(`${accountApiUrl}/team/members/invite`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.bearerToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            email: input.email,
            name: input.name,
            role: "member",
            product_key: "base"
          }),
          signal: controller.signal
        });
      } catch {
        throw new ApiError(502, "ACCOUNT_HUB_INVITE_FAILED", "Não foi possível enviar o convite pelo Prymeira Hub.");
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new ApiError(502, "ACCOUNT_HUB_INVITE_FAILED", "Não foi possível enviar o convite pelo Prymeira Hub.", {
          status: response.status
        });
      }

      const payload = await response.json() as Record<string, unknown>;
      const invitation = payload.invitation;
      const invitationRecord = typeof invitation === "object" && invitation !== null ? invitation as Record<string, unknown> : null;
      return {
        status: payload.status === "active" ? "active" as const : "pending" as const,
        invitationId: typeof invitationRecord?.id === "string" && invitationRecord.id ? invitationRecord.id : null
      } satisfies HubInviteResult;
    }
  };
}
