import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createIsolatedPdfExtractor } from "./studio-pdf-worker";

describe("isolated Studio PDF extraction", () => {
  it("rejects oversized PDF input before creating a worker", async () => {
    const workerFactory = vi.fn();
    const extract = createIsolatedPdfExtractor({ workerFactory, maxInputBytes: 4 });
    await expect(extract(Buffer.alloc(5))).rejects.toThrow("STUDIO_PDF_INPUT_TOO_LARGE");
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("terminates a parser worker at its wall timeout", async () => {
    vi.useFakeTimers();
    try {
      const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 0) });
      const extract = createIsolatedPdfExtractor({
        workerFactory: () => worker,
        timeoutMs: 100
      });
      const pending = extract(Buffer.from("%PDF-1.7"));
      const assertion = expect(pending).rejects.toThrow("STUDIO_PDF_TIMEOUT");
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
