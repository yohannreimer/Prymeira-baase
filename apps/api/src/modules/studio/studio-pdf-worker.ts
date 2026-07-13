import { Worker } from "node:worker_threads";
import { STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS } from "./studio-link-fetcher";

type WorkerLike = {
  on(event: "message" | "error" | "exit", listener: (...args: any[]) => void): unknown;
  removeAllListeners(): unknown;
  terminate(): Promise<number>;
};

type PdfWorkerFactory = (buffer: Buffer) => WorkerLike;

export type StudioPdfExtraction = {
  text: string;
  truncated: boolean;
  originalCharacterCount: number;
};

export function createIsolatedPdfExtractor(options: {
  workerFactory?: PdfWorkerFactory;
  timeoutMs?: number;
  maxInputBytes?: number;
} = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxInputBytes = options.maxInputBytes ?? 10 * 1024 * 1024;
  const workerFactory = options.workerFactory ?? createPdfWorker;

  return async (buffer: Buffer): Promise<StudioPdfExtraction> => {
    if (buffer.length > maxInputBytes) throw new Error("STUDIO_PDF_INPUT_TOO_LARGE");
    const worker = workerFactory(buffer);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = async (error?: Error, result?: StudioPdfExtraction) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.removeAllListeners();
        await worker.terminate().catch(() => undefined);
        if (error) reject(error);
        else resolve(result!);
      };
      const timeout = setTimeout(() => {
        void finish(new Error("STUDIO_PDF_TIMEOUT"));
      }, timeoutMs);
      worker.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") {
          void finish(new Error("STUDIO_PDF_INVALID"));
          return;
        }
        const candidate = message as Partial<StudioPdfExtraction> & { error?: unknown };
        if (candidate.error) {
          void finish(new Error("STUDIO_PDF_INVALID"));
          return;
        }
        if (typeof candidate.text !== "string"
          || typeof candidate.truncated !== "boolean"
          || typeof candidate.originalCharacterCount !== "number") {
          void finish(new Error("STUDIO_PDF_INVALID"));
          return;
        }
        void finish(undefined, {
          text: candidate.text.slice(0, STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS),
          truncated: candidate.truncated || candidate.text.length > STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS,
          originalCharacterCount: candidate.originalCharacterCount
        });
      });
      worker.on("error", () => void finish(new Error("STUDIO_PDF_INVALID")));
      worker.on("exit", (code: number) => {
        if (!settled && code !== 0) void finish(new Error("STUDIO_PDF_INVALID"));
      });
    });
  };
}

function createPdfWorker(buffer: Buffer): WorkerLike {
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: Buffer.from(workerData) });
      try {
        const result = await parser.getText();
        const text = String(result.text || "").trim();
        parentPort.postMessage({
          text: text.slice(0, ${STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS}),
          truncated: text.length > ${STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS},
          originalCharacterCount: text.length
        });
      } finally {
        await parser.destroy();
      }
    })().catch(() => parentPort.postMessage({ error: "STUDIO_PDF_INVALID" }));
  `;
  return new Worker(source, {
    eval: true,
    workerData: buffer,
    resourceLimits: {
      maxOldGenerationSizeMb: 64,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 4
    }
  });
}
