export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function forbiddenError() {
  return new ApiError(403, "FORBIDDEN", "Você não tem permissão para executar esta ação.");
}
