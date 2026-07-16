import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  ListPartsCommand,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import type { GetBucketLifecycleConfigurationCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import type { BaaseMultipartCleanupMode } from "../config/runtime";
import { attachmentContentDisposition, type ObjectStorage } from "./object-storage";
import { hasSafeMultipartLifecycle } from "./s3-lifecycle-policy";

export type S3ObjectStorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  multipartCleanupMode: BaaseMultipartCleanupMode;
};

type S3ClientLike = {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
};

const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

export function createS3ObjectStorage(config: S3ObjectStorageConfig, clientOverride?: S3ClientLike): ObjectStorage {
  const sdkClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  const client = clientOverride ?? (sdkClient as unknown as S3ClientLike);

  return {
    async ensureReady() {
      if (config.multipartCleanupMode === "minio-native") {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        return;
      }
      try {
        const response = await client.send(new GetBucketLifecycleConfigurationCommand({
          Bucket: config.bucket
        })) as GetBucketLifecycleConfigurationCommandOutput;
        if (!hasSafeMultipartLifecycle(response.Rules)) throw multipartLifecycleRequired();
      } catch (error) {
        if (error instanceof Error && error.message === "STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED") {
          throw error;
        }
        throw multipartLifecycleRequired(error);
      }
    },
    async put(input, options) {
      const unbind = bindAbortToBody(input.body, options?.signal);
      try {
        await ensureBucket(client, config.bucket, options?.signal);
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.sizeBytes
        }), { abortSignal: options?.signal });
      } finally {
        unbind();
      }
    },
    async beginAtomicUpload(input, options) {
      throwIfAborted(options?.signal);
      await ensureBucket(client, config.bucket, options?.signal);
      const response = await client.send(new CreateMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        ContentType: input.contentType
      }), { abortSignal: options?.signal }) as { UploadId?: string };
      throwIfAborted(options?.signal);
      if (!response.UploadId) throw new Error("ATOMIC_UPLOAD_ID_MISSING");
      return { uploadId: response.UploadId };
    },
    async completeAtomicUploadFromStream(input, options) {
      throwIfAborted(options?.signal);
      const unbind = bindAbortToBody(input.body, options?.signal);
      const parts: Array<{ ETag: string; PartNumber: number }> = [];
      let pending = Buffer.alloc(0);
      let uploadedBytes = 0;
      try {
        for await (const chunk of input.body) {
          throwIfAborted(options?.signal);
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          pending = pending.length === 0 ? buffer : Buffer.concat([pending, buffer]);
          while (pending.length >= MULTIPART_PART_SIZE_BYTES) {
            const partBody = pending.subarray(0, MULTIPART_PART_SIZE_BYTES);
            pending = pending.subarray(MULTIPART_PART_SIZE_BYTES);
            parts.push(await uploadPart(client, config.bucket, input.key, input.uploadId, parts.length + 1, partBody, options?.signal));
            uploadedBytes += partBody.length;
          }
        }
        throwIfAborted(options?.signal);
        if (pending.length > 0 || uploadedBytes === 0) {
          parts.push(await uploadPart(client, config.bucket, input.key, input.uploadId, parts.length + 1, pending, options?.signal));
          uploadedBytes += pending.length;
        }
        throwIfAborted(options?.signal);
        if (uploadedBytes !== input.sizeBytes) throw new Error("ATOMIC_UPLOAD_SIZE_MISMATCH");
        validateCompletedParts(parts);
        throwIfAborted(options?.signal);
        await client.send(new CompleteMultipartUploadCommand({
          Bucket: config.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          MultipartUpload: { Parts: parts }
        }), { abortSignal: options?.signal });
        throwIfAborted(options?.signal);
      } finally {
        unbind();
      }
    },
    async abortAtomicUpload(input, options) {
      throwIfAborted(options?.signal);
      try {
        await client.send(new AbortMultipartUploadCommand({
          Bucket: config.bucket,
          Key: input.key,
          UploadId: input.uploadId
        }), { abortSignal: options?.signal });
      } catch (error) {
        if (isNoSuchUpload(error)) return;
        throw error;
      }
      throwIfAborted(options?.signal);
    },
    async inspectAtomicUpload(input, options) {
      throwIfAborted(options?.signal);
      try {
        await client.send(new ListPartsCommand({
          Bucket: config.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          MaxParts: 1
        }), { abortSignal: options?.signal });
        throwIfAborted(options?.signal);
        return { active: true };
      } catch (error) {
        if (isNoSuchUpload(error)) return { active: false };
        throw error;
      }
    },
    async get(key, options) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: options?.signal }
      ) as { Body?: unknown; ContentType?: string; ContentLength?: number };
      const body = objectBodyToNodeReadable(response.Body);
      bindAbortToBody(body, options?.signal);
      return {
        body,
        contentType: response.ContentType ?? null,
        sizeBytes: response.ContentLength ?? null
      };
    },
    createDownloadUrl(key, expiresInSeconds, options) {
      return getSignedUrl(sdkClient, new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentDisposition: options?.downloadFilename
          ? attachmentContentDisposition(options.downloadFilename)
          : undefined
      }), { expiresIn: expiresInSeconds });
    },
    async delete(key, options) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: options?.signal }
      );
    }
  };
}

function bindAbortToBody(body: Readable, signal?: AbortSignal) {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    body.destroy();
    return () => undefined;
  }
  const abort = () => body.destroy();
  const cleanup = () => signal.removeEventListener("abort", abort);
  signal.addEventListener("abort", abort, { once: true });
  body.once("close", cleanup);
  body.once("end", cleanup);
  body.once("error", cleanup);
  return cleanup;
}

export function objectBodyToNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body instanceof Uint8Array) return Readable.from(Buffer.from(body));
  if (body && typeof body === "object" && "transformToByteArray" in body) {
    const transform = (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray;
    return Readable.from((async function* () {
      yield Buffer.from(await transform.call(body));
    })());
  }
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    return Readable.from(body as AsyncIterable<Uint8Array | string>);
  }
  if (body && typeof body === "object" && "getReader" in body) {
    return Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  }
  throw new Error("OBJECT_BODY_UNSUPPORTED");
}

async function ensureBucket(client: S3ClientLike, bucket: string, signal?: AbortSignal) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
  } catch (headError) {
    if (signal?.aborted) throw headError;
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
      } catch {
        throw error;
      }
    }
  }
}

async function uploadPart(
  client: S3ClientLike,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
  signal?: AbortSignal
): Promise<{ ETag: string; PartNumber: number }> {
  throwIfAborted(signal);
  const response = await client.send(new UploadPartCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: body,
    ContentLength: body.length
  }), { abortSignal: signal }) as { ETag?: string };
  throwIfAborted(signal);
  if (!response.ETag) throw new Error("ATOMIC_UPLOAD_ETAG_MISSING");
  return { ETag: response.ETag, PartNumber: partNumber };
}

function validateCompletedParts(parts: Array<{ ETag: string; PartNumber: number }>): void {
  if (parts.length === 0) throw new Error("ATOMIC_UPLOAD_PARTS_MISSING");
  for (const [index, part] of parts.entries()) {
    if (!part.ETag || part.PartNumber !== index + 1) throw new Error("ATOMIC_UPLOAD_PARTS_INVALID");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("ABORTED");
  }
}

function isNoSuchUpload(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; code?: string };
  return candidate.name === "NoSuchUpload" || candidate.Code === "NoSuchUpload" || candidate.code === "NoSuchUpload";
}

function multipartLifecycleRequired(cause?: unknown): Error {
  const error = new Error("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED");
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}
