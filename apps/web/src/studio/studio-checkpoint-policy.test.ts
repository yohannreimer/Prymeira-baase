import { describe, expect, it } from "vitest";
import { createCheckpointPolicy } from "./studio-checkpoint-policy";

describe("studio checkpoint policy", () => {
  it("creates one significant-pause checkpoint after meaningful editing", () => {
    const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    policy.recordSaved({ revision: 2, bodyText: "A meaningful changed paragraph" }, 0);

    expect(policy.dueAt(29_999)).toBe(false);
    expect(policy.dueAt(30_000)).toBe(true);

    policy.recordCheckpoint(30_000);

    expect(policy.dueAt(60_000)).toBe(false);
  });

  it("ignores edits below the meaningful-character threshold", () => {
    const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    policy.recordSaved({ revision: 1, bodyText: "Existing checkpoint body" }, 0);
    policy.recordCheckpoint(0);
    policy.recordSaved({ revision: 2, bodyText: "Existing checkpoint body!" }, 1_000);

    expect(policy.dueAt(31_000)).toBe(false);
    expect(policy.pendingAt(31_000)).toBeNull();
  });

  it("resets the pause for each saved change and exposes the latest revision", () => {
    const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    policy.recordSaved({ revision: 1, bodyText: "Initial checkpoint body" }, 0);
    policy.recordCheckpoint(0);
    policy.recordSaved({ revision: 2, bodyText: "Initial checkpoint body plus a meaningful first addition" }, 5_000);
    policy.recordSaved({ revision: 3, bodyText: "Initial checkpoint body plus a meaningful newer addition" }, 20_000);

    expect(policy.dueAt(49_999)).toBe(false);
    expect(policy.pendingAt(50_000)).toEqual({
      revision: 3,
      bodyText: "Initial checkpoint body plus a meaningful newer addition"
    });
  });

  it("does not create a duplicate checkpoint for an identical saved snapshot", () => {
    const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    const snapshot = { revision: 2, bodyText: "A meaningful changed paragraph" };
    policy.recordSaved(snapshot, 0);
    policy.recordCheckpoint(30_000);
    policy.recordSaved(snapshot, 31_000);

    expect(policy.dueAt(61_000)).toBe(false);
  });

  it("does not clear a newer saved change when an older checkpoint finishes", () => {
    const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    policy.recordSaved({ revision: 1, bodyText: "Initial checkpoint body" }, 0);
    policy.recordCheckpoint(0);
    policy.recordSaved({ revision: 2, bodyText: "Initial checkpoint body with a meaningful first change" }, 1_000);
    const exiting = policy.consumeForExit();
    policy.recordSaved({ revision: 3, bodyText: "Initial checkpoint body with a meaningful newer change" }, 2_000);

    policy.recordCheckpoint(3_000, exiting ?? undefined);

    expect(policy.pendingForExit()).toEqual({
      revision: 3,
      bodyText: "Initial checkpoint body with a meaningful newer change"
    });
  });

  it("does not regress the checkpoint baseline when completions arrive out of order", () => {
    const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    const revision2 = { revision: 2, bodyText: "A meaningful body at revision two" };
    const revision3 = { revision: 3, bodyText: "A wholly different meaningful body at revision three" };
    policy.recordSaved(revision2, 0);
    policy.recordCheckpoint(0, revision2);
    policy.recordSaved(revision3, 1_000);
    policy.recordCheckpoint(1_000, revision3);

    policy.recordCheckpoint(2_000, revision2);
    policy.recordSaved(revision3, 3_000);

    expect(policy.pendingForExit()).toBeNull();
  });
});
