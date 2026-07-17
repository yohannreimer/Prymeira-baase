import { describe, expect, it } from "vitest";
import {
  STUDIO_RITUAL_SUPPORT_MODES,
  STUDIO_STRUCTURE_CONTRACT,
  STUDIO_STRUCTURE_KIND_ORDER
} from "./studio-structures";

describe("shared Studio structure contract", () => {
  it("keeps API property keys and product labels in one immutable vocabulary", () => {
    expect(STUDIO_STRUCTURE_KIND_ORDER).toEqual(["goal", "decision", "plan", "ritual"]);
    expect(STUDIO_STRUCTURE_CONTRACT.goal.properties.desiredOutcome).toEqual({ key: "desired_outcome", label: "Resultado desejado" });
    expect(STUDIO_STRUCTURE_CONTRACT.decision.properties).toMatchObject({
      decisionDate: { key: "decision_date" }, reviewDate: { key: "review_date" }
    });
    expect(STUDIO_STRUCTURE_CONTRACT.plan.properties).toMatchObject({
      fronts: { key: "fronts" }, milestones: { key: "milestones" }
    });
    expect(STUDIO_STRUCTURE_CONTRACT.ritual.properties.supportMode).toEqual({
      key: "support_mode", label: "Apoio da IA"
    });
    expect(STUDIO_RITUAL_SUPPORT_MODES).toEqual([
      "record_only", "light_summary", "guided_reflection"
    ]);
    expect(Object.isFrozen(STUDIO_STRUCTURE_CONTRACT)).toBe(true);
  });
});
