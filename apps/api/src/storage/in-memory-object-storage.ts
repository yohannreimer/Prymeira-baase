import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { attachmentContentDisposition, type CompleteAtomicUploadInput, type ObjectStorage, type PutObjectInput } from "./object-storage";

export type InMemoryObjectStorage = ObjectStorage & {
  failNextPut(error: Error): void;
  failNextDelete(error: Error): void;
  failNextAtomicAbort(error: Error): void;
  keepNextAtomicAbortActive(): void;
  keys(): string[];
  atomicUploadIds(): string[];
};

export function createInMemoryObjectStorage(): InMemoryObjectStorage {
  const objects = new Map<string, { body: Buffer; contentType: string; sizeBytes: number }>();
  const atomicUploads = new Map<string, {
    key: string;
    contentType: string;
    sizeBytes: number;
  }>();
  let nextPutError: Error | null = null;
  let nextDeleteError: Error | null = null;
  let nextAtomicAbortError: Error | null = null;
  let keepNextAbortActive = false;

  return {
    async ensureReady() {},
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
    async beginAtomicUpload(input, options) {
      throwIfAborted(options?.signal);
      const uploadId = randomUUID();
      atomicUploads.set(uploadId, {
        key: input.key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      });
      return { uploadId };
    },
    async completeAtomicUploadFromStream(input: CompleteAtomicUploadInput, options) {
      throwIfAborted(options?.signal);
      const session = atomicUploads.get(input.uploadId);
      if (!session || session.key !== input.key) throw new Error("ATOMIC_UPLOAD_NOT_FOUND");
      if (session.sizeBytes !== input.sizeBytes) throw new Error("ATOMIC_UPLOAD_SIZE_MISMATCH");

      const chunks: Buffer[] = [];
      const abort = () => input.body.destroy(abortError(options?.signal));
      options?.signal?.addEventListener("abort", abort, { once: true });
      try {
        for await (const chunk of input.body) {
          throwIfAborted(options?.signal);
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        throwIfAborted(options?.signal);
        const current = atomicUploads.get(input.uploadId);
        if (!current || current.key !== input.key) throw new Error("ATOMIC_UPLOAD_NOT_FOUND");
        const body = Buffer.concat(chunks);
        if (body.length !== input.sizeBytes) throw new Error("ATOMIC_UPLOAD_SIZE_MISMATCH");
        objects.set(input.key, { body, contentType: current.contentType, sizeBytes: body.length });
        atomicUploads.delete(input.uploadId);
      } finally {
        options?.signal?.removeEventListener("abort", abort);
      }
    },
    async abortAtomicUpload(input, options) {
      throwIfAborted(options?.signal);
      if (nextAtomicAbortError) {
        const error = nextAtomicAbortError;
        nextAtomicAbortError = null;
        throw error;
      }
      if (keepNextAbortActive) {
        keepNextAbortActive = false;
        return;
      }
      const session = atomicUploads.get(input.uploadId);
      if (session?.key === input.key) atomicUploads.delete(input.uploadId);
    },
    async inspectAtomicUpload(input, options) {
      throwIfAborted(options?.signal);
      const session = atomicUploads.get(input.uploadId);
      return { active: session?.key === input.key };
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
    async createDownloadUrl(key, expiresInSeconds, options) {
      if (!objects.has(key)) throw new Error("OBJECT_NOT_FOUND");
      const params = new URLSearchParams({ expires_in: String(expiresInSeconds) });
      if (options?.downloadFilename) {
        params.set("response-content-disposition", attachmentContentDisposition(options.downloadFilename));
      }
      return `memory://${encodeURIComponent(key)}?${params.toString()}`;
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
    failNextAtomicAbort(error) {
      nextAtomicAbortError = error;
    },
    keepNextAtomicAbortActive() {
      keepNextAbortActive = true;
    },
    keys() {
      return [...objects.keys()].sort();
    },
    atomicUploadIds() {
      return [...atomicUploads.keys()].sort();
    }
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("ABORTED");
}
