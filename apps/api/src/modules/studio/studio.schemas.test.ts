import { describe, expect, it } from "vitest";
import { createStudioDocumentSchema, studioStructurePropertiesSchema } from "./studio.schemas";

describe("Studio schemas", () => {
  it("accepts an unclassified text capture", () => {
    expect(createStudioDocumentSchema.parse({
      title: null,
      body_json: { type: "doc", content: [] },
      body_text: "Uma ideia solta",
      capture_mode: "text"
    })).toMatchObject({ capture_mode: "text" });
  });

  it("rejects a metric without a goal target", () => {
    expect(() => studioStructurePropertiesSchema("goal").parse({
      metric: { label: "Receita", current: 100 }
    })).toThrow();
  });
});
