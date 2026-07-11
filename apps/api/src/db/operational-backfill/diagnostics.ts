export const DIAGNOSTIC_CATEGORY_SAMPLE_CAP = 100;
export const DIAGNOSTIC_GLOBAL_SAMPLE_CAP = 250;

export const diagnosticCategories = [
  "orphanReferences",
  "skippedRecords",
  "conflictingRecords",
  "malformedRecords"
] as const;

export type DiagnosticCategory = typeof diagnosticCategories[number];
export type DiagnosticTotals = Record<DiagnosticCategory, number>;

export function emptyDiagnosticTotals(): DiagnosticTotals {
  return {
    orphanReferences: 0,
    skippedRecords: 0,
    conflictingRecords: 0,
    malformedRecords: 0
  };
}

export function appendDiagnosticSample<T>(samples: T[], item: T) {
  if (samples.length < DIAGNOSTIC_CATEGORY_SAMPLE_CAP) samples.push(item);
}

export class DiagnosticCollector {
  readonly totals = emptyDiagnosticTotals();
  private sampledTotal = 0;

  add<T>(category: DiagnosticCategory, target: T[], samples: readonly T[], total = samples.length) {
    this.totals[category] += total;
    const categoryRoom = DIAGNOSTIC_CATEGORY_SAMPLE_CAP - target.length;
    const globalRoom = DIAGNOSTIC_GLOBAL_SAMPLE_CAP - this.sampledTotal;
    const accepted = samples.slice(0, Math.max(0, Math.min(categoryRoom, globalRoom)));
    target.push(...accepted);
    this.sampledTotal += accepted.length;
  }

  metadata(samples: Record<DiagnosticCategory, readonly unknown[]>) {
    const categories = Object.fromEntries(diagnosticCategories.map((category) => [category, {
      total: this.totals[category],
      sampled: samples[category].length,
      truncated: samples[category].length < this.totals[category]
    }])) as Record<DiagnosticCategory, { total: number; sampled: number; truncated: boolean }>;
    const total = diagnosticCategories.reduce((sum, category) => sum + this.totals[category], 0);
    return {
      categories,
      global: { total, sampled: this.sampledTotal, truncated: this.sampledTotal < total },
      categorySampleCap: DIAGNOSTIC_CATEGORY_SAMPLE_CAP,
      globalSampleCap: DIAGNOSTIC_GLOBAL_SAMPLE_CAP
    };
  }
}
