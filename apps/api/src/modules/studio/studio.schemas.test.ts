import { describe, expect, it } from "vitest";
import {
  createStudioDocumentSchema,
  patchStudioDocumentSchema,
  studioAssetSchema,
  studioCollectionSchema,
  studioStructurePropertiesSchema
} from "./studio.schemas";

const textCapture = {
  title: null,
  body_json: { type: "doc", content: [] },
  body_text: "Uma ideia solta",
  capture_mode: "text" as const
};

const fileAsset = {
  kind: "file" as const,
  display_name: "Plano.pdf",
  object_key: "studio/asset-1",
  mime_type: "application/pdf",
  size_bytes: 42
};

describe("Studio schemas", () => {
  it("accepts an unclassified text capture", () => {
    expect(createStudioDocumentSchema.parse(textCapture)).toMatchObject({ capture_mode: "text" });
  });

  it("rejects a metric without a goal target", () => {
    expect(() => studioStructurePropertiesSchema("goal").parse({
      metric: { label: "Receita", current: 100 }
    })).toThrow();
  });

  it("requires a real mutation in document patches", () => {
    expect(() => patchStudioDocumentSchema.parse({ expected_revision: 1 })).toThrow();
    expect(patchStudioDocumentSchema.parse({
      expected_revision: 1,
      title: "Próxima versão"
    })).toMatchObject({ expected_revision: 1, title: "Próxima versão" });
  });

  it("keeps document lifecycle status out of generic patches", () => {
    expect(() => patchStudioDocumentSchema.parse({
      expected_revision: 1,
      title: "Ainda ativa",
      status: "archived"
    })).toThrow();
  });

  it("rejects whitespace-only visible labels", () => {
    expect(() => createStudioDocumentSchema.parse({ ...textCapture, title: "   " })).toThrow();
    expect(() => studioCollectionSchema.parse({ name: "   " })).toThrow();
    expect(() => studioAssetSchema.parse({ ...fileAsset, display_name: "   " })).toThrow();
    expect(createStudioDocumentSchema.parse({ ...textCapture, title: "  Título  " }).title).toBe("Título");
    expect(studioCollectionSchema.parse({ name: "  Estratégia  " }).name).toBe("Estratégia");
    expect(studioAssetSchema.parse({ ...fileAsset, display_name: "  Plano.pdf  " }).display_name).toBe("Plano.pdf");
  });

  it("enforces payload caps and a positive expected revision", () => {
    expect(createStudioDocumentSchema.parse({
      ...textCapture,
      title: "a".repeat(240),
      body_text: "a".repeat(500_000)
    })).toBeTruthy();
    expect(() => createStudioDocumentSchema.parse({ ...textCapture, title: "a".repeat(241) })).toThrow();
    expect(() => createStudioDocumentSchema.parse({ ...textCapture, body_text: "a".repeat(500_001) })).toThrow();
    expect(studioCollectionSchema.parse({ name: "a".repeat(120) })).toBeTruthy();
    expect(() => studioCollectionSchema.parse({ name: "a".repeat(121) })).toThrow();
    expect(() => patchStudioDocumentSchema.parse({ expected_revision: 0, title: "Revisão" })).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => createStudioDocumentSchema.parse({ ...textCapture, owner_profile_id: "other-owner" })).toThrow();
  });

  it("selects and parses properties for every structure kind", () => {
    const goal = studioStructurePropertiesSchema("goal").parse({
      metric: { label: "Receita", current: 100, target: 200 }
    });
    expect(goal.metric?.target).toBe(200);
    expect(studioStructurePropertiesSchema("decision").parse({ decision: "Contratar" }))
      .toMatchObject({ decision: "Contratar" });
    expect(studioStructurePropertiesSchema("plan").parse({ direction: "Expandir" }))
      .toMatchObject({ direction: "Expandir" });
    expect(studioStructurePropertiesSchema("ritual").parse({ intention: "Revisar a semana" }))
      .toMatchObject({ intention: "Revisar a semana" });
  });
});
