import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import type { ObjectStorage, PutObjectInput } from "./object-storage";

export type InMemoryObjectStorage = ObjectStorage & {
  failNextPut(error: Error): void;
  failNextDelete(error: Error): void;
  keys(): string[];
};

export function createInMemoryObjectStorage(): InMemoryObjectStorage {
  const objects = new Map<string, { body: Buffer; contentType: string; sizeBytes: number }>();
  let nextPutError: Error | null = null;
  let nextDeleteError: Error | null = null;

  return {
    async put(input: PutObjectInput, options) {
      throwIfAborted(options?.signal);
      if (nextPutError) {
        const error = nextPutError;
        nextPutError = null;
        throw error;
      }
      const chunks: Buffer[] = [];
      const abort = () => input.body.destroy(abortError(options?.signal));
      options?.signal?.addEventListener("abort", abort, { once: true });
      try {
        for await (const chunk of input.body) {
          throwIfAborted(options?.signal);
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        throwIfAborted(options?.signal);
        const body = Buffer.concat(chunks);
        objects.set(input.key, { body, contentType: input.contentType, sizeBytes: body.length });
      } finally {
        options?.signal?.removeEventListener("abort", abort);
      }
    },
    async get(key, options) {
      if (options?.signal?.aborted) throw options.signal.reason ?? new Error("ABORTED");
      const object = objects.get(key);
      if (!object) throw new Error("OBJECT_NOT_FOUND");
      const body = Readable.from(Buffer.from(object.body));
      const abort = () => body.destroy();
      options?.signal?.addEventListener("abort", abort, { once: true });
      body.once("close", () => options?.signal?.removeEventListener("abort", abort));
      return {
        body,
        contentType: object.contentType,
        sizeBytes: object.sizeBytes
      };
    },
    async createDownloadUrl(key, expiresInSeconds) {
      if (!objects.has(key)) throw new Error("OBJECT_NOT_FOUND");
      return `memory://${encodeURIComponent(key)}?expires_in=${expiresInSeconds}`;
    },
    async delete(key, options) {
      throwIfAborted(options?.signal);
      if (nextDeleteError) {
        const error = nextDeleteError;
        nextDeleteError = null;
        throw error;
      }
      throwIfAborted(options?.signal);
      objects.delete(key);
    },
    failNextPut(error) {
      nextPutError = error;
    },
    failNextDelete(error) {
      nextDeleteError = error;
    },
    keys() {
      return [...objects.keys()].sort();
    }
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("ABORTED");
}
