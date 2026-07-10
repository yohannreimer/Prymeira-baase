import { describe, expect, it } from "vitest";
import { canonicalJson } from "./deterministic-ids";
import { normalizeRecordForTable } from "./reconcile";

describe("operational reconciliation normalization", () => {
  it("normalizes equivalent timestamp offsets and fractional precision", () => {
    const expected = normalizeRecordForTable("task_occurrences", {
      submitted_at: "2026-07-10T09:00:00.123400-03:00"
    });
    const actual = normalizeRecordForTable("task_occurrences", {
      submitted_at: new Date("2026-07-10T12:00:00.123Z")
    });

    expect(canonicalJson(expected)).toBe(canonicalJson(actual));
  });

  it("normalizes date and time columns without parsing arbitrary text", () => {
    expect(normalizeRecordForTable("task_occurrences", {
      due_date: new Date(2026, 6, 10),
      due_time: "09:00"
    })).toEqual({ due_date: "2026-07-10", due_time: "09:00:00" });
    expect(normalizeRecordForTable("routine_steps", {
      deadline_time: "09:00:00.000000"
    })).toEqual({ deadline_time: "09:00:00" });
    expect(normalizeRecordForTable("task_occurrences", {
      due_date: new Date("2026-07-10T00:00:00.000Z")
    })).toEqual({ due_date: "2026-07-10" });
    expect(normalizeRecordForTable("task_occurrences", {
      title: "2026-07-10T09:00:00-03:00"
    })).toEqual({ title: "2026-07-10T09:00:00-03:00" });
  });

  it("keeps genuinely different instants different", () => {
    const left = normalizeRecordForTable("task_occurrences", {
      reviewed_at: "2026-07-10T09:00:00-03:00"
    });
    const right = normalizeRecordForTable("task_occurrences", {
      reviewed_at: new Date("2026-07-10T12:00:01.000Z")
    });

    expect(canonicalJson(left)).not.toBe(canonicalJson(right));
  });
});
