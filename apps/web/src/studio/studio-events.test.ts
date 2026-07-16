import { describe, expect, it, vi } from "vitest";
import { publishStudioEvent, subscribeStudioEvents, type StudioDataEvent } from "./studio-events";

describe("studio events", () => {
  it("delivers typed structure and document lifecycle changes in publication order", () => {
    const received: StudioDataEvent[] = [];
    const unsubscribe = subscribeStudioEvents((event) => received.push(event));

    publishStudioEvent({ type: "structure-changed", documentId: "document_1", kind: "decision" });
    publishStudioEvent({ type: "document-lifecycle-changed", documentId: "document_1" });

    expect(received).toEqual([
      { type: "structure-changed", documentId: "document_1", kind: "decision" },
      { type: "document-lifecycle-changed", documentId: "document_1" }
    ]);
    unsubscribe();
  });

  it("removes exactly the subscribed listener without affecting another subscriber", () => {
    const removed = vi.fn();
    const active = vi.fn();
    const unsubscribe = subscribeStudioEvents(removed);
    const unsubscribeActive = subscribeStudioEvents(active);

    unsubscribe();
    publishStudioEvent({ type: "structure-changed", documentId: "document_2", kind: "goal" });

    expect(removed).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledOnce();
    unsubscribeActive();
  });
});
