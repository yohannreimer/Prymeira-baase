import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import type { ObjectStorage } from "./object-storage";

export type S3ObjectStorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export function createS3ObjectStorage(config: S3ObjectStorageConfig): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return {
    async put(input) {
      await ensureBucket(client, config.bucket);
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes
      }));
    },
    async get(key, options) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: options?.signal }
      );
      const body = objectBodyToNodeReadable(response.Body);
      bindAbortToBody(body, options?.signal);
      return {
        body,
        contentType: response.ContentType ?? null,
        sizeBytes: response.ContentLength ?? null
      };
    },
    createDownloadUrl(key, expiresInSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: expiresInSeconds });
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    }
  };
}

function bindAbortToBody(body: Readable, signal?: AbortSignal) {
  if (!signal) return;
  if (signal.aborted) {
    body.destroy();
    return;
  }
  const abort = () => body.destroy();
  const cleanup = () => signal.removeEventListener("abort", abort);
  signal.addEventListener("abort", abort, { once: true });
  body.once("close", cleanup);
  body.once("end", cleanup);
  body.once("error", cleanup);
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

async function ensureBucket(client: S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        throw error;
      }
    }
  }
}
