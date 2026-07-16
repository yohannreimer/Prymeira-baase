export type StudioCapability = {
  status: "ready" | "degraded" | "unavailable";
  code: string | null;
};

export type StudioAiCapability = StudioCapability & {
  model: string | null;
};

export type StudioReadiness = {
  ai: StudioAiCapability;
  embeddings: StudioCapability;
  vector: StudioCapability;
  maintenance: StudioCapability;
};

type StudioReadinessInput = {
  runtimeConfig: {
    mode: "demo" | "pilot" | "production";
    studio: { enabled: boolean; vectorConfigured: boolean; aiModel: string };
  };
  aiAvailable: boolean;
  hasPersistentVectorIndex: boolean;
  maintenanceAvailable: boolean;
};

export function buildStudioReadiness(input: StudioReadinessInput): StudioReadiness {
  if (!input.runtimeConfig.studio.enabled) {
    return {
      ai: aiCapability(unavailable("STUDIO_DISABLED"), input.runtimeConfig.studio.aiModel),
      embeddings: unavailable("STUDIO_DISABLED"),
      vector: unavailable("STUDIO_DISABLED"),
      maintenance: unavailable("STUDIO_DISABLED")
    };
  }

  const aiStatus = input.aiAvailable ? ready() : unavailable("AI_PROVIDER_UNAVAILABLE");
  const ai = aiCapability(aiStatus, input.runtimeConfig.studio.aiModel);
  const embeddings = aiStatus;
  const vector = embeddings.status !== "ready"
    ? unavailable("STUDIO_EMBEDDINGS_UNAVAILABLE")
    : !input.runtimeConfig.studio.vectorConfigured
    ? unavailable("STUDIO_VECTOR_NOT_CONFIGURED")
    : input.hasPersistentVectorIndex
      ? ready()
      : unavailable("STUDIO_VECTOR_INDEX_UNAVAILABLE");

  return {
    ai,
    embeddings,
    vector,
    maintenance: input.maintenanceAvailable ? ready() : unavailable("STUDIO_MAINTENANCE_UNAVAILABLE")
  };
}

function aiCapability(capability: StudioCapability, model: string): StudioAiCapability {
  return { ...capability, model };
}

function ready(): StudioCapability {
  return { status: "ready", code: null };
}

function unavailable(code: string): StudioCapability {
  return { status: "unavailable", code };
}
