import { describe, expect, it } from "vitest";
import { DiagnosticCollector, diagnosticCategories } from "./diagnostics";

describe("operational diagnostic sampling", () => {
  it("enforces category and global caps while retaining exact totals", () => {
    const collector = new DiagnosticCollector();
    const samples: Record<typeof diagnosticCategories[number], number[]> = {
      orphanReferences: [],
      skippedRecords: [],
      conflictingRecords: [],
      malformedRecords: []
    };
    for (const [categoryIndex, category] of diagnosticCategories.entries()) {
      collector.add(category, samples[category], Array.from({ length: 1_000 }, (_, index) =>
        categoryIndex * 1_000 + index), 1_000);
    }

    expect(samples.orphanReferences).toHaveLength(100);
    expect(samples.skippedRecords).toHaveLength(100);
    expect(samples.conflictingRecords).toHaveLength(50);
    expect(samples.malformedRecords).toHaveLength(0);
    expect(collector.metadata(samples)).toMatchObject({
      global: { total: 4_000, sampled: 250, truncated: true },
      categories: {
        orphanReferences: { total: 1_000, sampled: 100, truncated: true },
        skippedRecords: { total: 1_000, sampled: 100, truncated: true },
        conflictingRecords: { total: 1_000, sampled: 50, truncated: true },
        malformedRecords: { total: 1_000, sampled: 0, truncated: true }
      }
    });
  });
});
