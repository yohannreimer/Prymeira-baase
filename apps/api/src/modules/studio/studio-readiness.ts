export type StudioCapability = {
  status: "ready" | "degraded" | "unavailable";
  code: string | null;
};

export type StudioReadiness = {
  ai: StudioCapability;
  embeddings: StudioCapability;
  vector: StudioCapability;
  maintenance: StudioCapability;
};

type StudioReadinessInput = {
  runtimeConfig: {
    mode: "demo" | "pilot" | "production";
    studio: { enabled: boolean; vectorConfigured: boolean };
  };
  aiAvailable: boolean;
  hasPersistentVectorIndex: boolean;
  maintenanceAvailable: boolean;
};

export function buildStudioReadiness(input: StudioReadinessInput): StudioReadiness {
  if (!input.runtimeConfig.studio.enabled) {
    return {
      ai: unavailable("STUDIO_DISABLED"),
      embeddings: unavailable("STUDIO_DISABLED"),
      vector: unavailable("STUDIO_DISABLED"),
      maintenance: unavailable("STUDIO_DISABLED")
    };
  }

  const ai = input.aiAvailable ? ready() : unavailable("AI_PROVIDER_UNAVAILABLE");
  const vector = !input.runtimeConfig.studio.vectorConfigured
    ? unavailable("STUDIO_VECTOR_NOT_CONFIGURED")
    : input.hasPersistentVectorIndex
      ? ready()
      : unavailable("STUDIO_VECTOR_INDEX_UNAVAILABLE");

  return {
    ai,
    embeddings: ai,
    vector,
    maintenance: input.maintenanceAvailable ? ready() : unavailable("STUDIO_MAINTENANCE_UNAVAILABLE")
  };
}

function ready(): StudioCapability {
  return { status: "ready", code: null };
}

function unavailable(code: string): StudioCapability {
  return { status: "unavailable", code };
}
