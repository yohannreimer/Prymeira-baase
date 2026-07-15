import { describe, expect, it } from "vitest";
import { buildStudioReadiness } from "./studio-readiness";

describe("Studio readiness", () => {
  it("projects only safe capability state when Studio dependencies are unavailable", () => {
    const readiness = buildStudioReadiness({
      runtimeConfig: {
        mode: "production",
        studio: { enabled: true, vectorConfigured: true }
      },
      aiAvailable: false,
      hasPersistentVectorIndex: false,
      maintenanceAvailable: false
    });

    expect(readiness).toEqual({
      ai: { status: "unavailable", code: "AI_PROVIDER_UNAVAILABLE" },
      embeddings: { status: "unavailable", code: "AI_PROVIDER_UNAVAILABLE" },
      vector: { status: "unavailable", code: "STUDIO_EMBEDDINGS_UNAVAILABLE" },
      maintenance: { status: "unavailable", code: "STUDIO_MAINTENANCE_UNAVAILABLE" }
    });
    expect(JSON.stringify(readiness)).not.toContain("private");
  });

  it("does not imply a remote call when local capabilities are ready", () => {
    expect(buildStudioReadiness({
      runtimeConfig: {
        mode: "production",
        studio: { enabled: true, vectorConfigured: true }
      },
      aiAvailable: true,
      hasPersistentVectorIndex: true,
      maintenanceAvailable: true
    })).toEqual({
      ai: { status: "ready", code: null },
      embeddings: { status: "ready", code: null },
      vector: { status: "ready", code: null },
      maintenance: { status: "ready", code: null }
    });
  });
});
