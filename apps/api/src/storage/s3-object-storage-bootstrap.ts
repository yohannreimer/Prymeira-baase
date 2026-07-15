import {
  CreateBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  type LifecycleRule
} from "@aws-sdk/client-s3";
import type { S3ObjectStorageConfig } from "./s3-object-storage";
import {
  BAASE_MULTIPART_LIFECYCLE_RULE_ID,
  createBaaseMultipartLifecycleRule,
  hasSafeMultipartLifecycle
} from "./s3-lifecycle-policy";

type S3ClientLike = {
  send(command: unknown): Promise<unknown>;
};

export type S3ObjectStorageBootstrapResult = {
  bucketCreated: boolean;
  lifecycleUpdated: boolean;
};

export async function bootstrapS3ObjectStorage(
  config: S3ObjectStorageConfig,
  clientOverride?: S3ClientLike
): Promise<S3ObjectStorageBootstrapResult> {
  const client = clientOverride ?? new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  }) as unknown as S3ClientLike;

  const bucketCreated = await ensureBucket(client, config.bucket);
  const existingRules = await readLifecycleRules(client, config.bucket);
  if (hasSafeMultipartLifecycle(existingRules)) {
    return { bucketCreated, lifecycleUpdated: false };
  }

  const mergedRules = existingRules.filter((rule) =>
    rule.ID !== BAASE_MULTIPART_LIFECYCLE_RULE_ID);
  mergedRules.push(createBaaseMultipartLifecycleRule());
  await client.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: config.bucket,
    LifecycleConfiguration: { Rules: mergedRules }
  }));

  const verifiedRules = await readLifecycleRules(client, config.bucket);
  if (!hasSafeMultipartLifecycle(verifiedRules)) {
    throw new Error("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED");
  }
  return { bucketCreated, lifecycleUpdated: true };
}

async function ensureBucket(client: S3ClientLike, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return false;
  } catch (error) {
    if (!isMissingBucket(error)) throw error;
  }

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    if (isSafeCreateBucketRace(error)) return false;
    throw error;
  }
}

async function readLifecycleRules(client: S3ClientLike, bucket: string): Promise<LifecycleRule[]> {
  try {
    const response = await client.send(new GetBucketLifecycleConfigurationCommand({
      Bucket: bucket
    })) as { Rules?: LifecycleRule[] };
    return response.Rules ?? [];
  } catch (error) {
    if (hasErrorCode(error, "NoSuchLifecycleConfiguration")) return [];
    throw error;
  }
}

function isMissingBucket(error: unknown): boolean {
  if (httpStatusCode(error) === 404) return true;
  return hasErrorCode(error, "NotFound") || hasErrorCode(error, "NoSuchBucket");
}

function isSafeCreateBucketRace(error: unknown): boolean {
  return hasErrorCode(error, "BucketAlreadyOwnedByYou")
    || hasErrorCode(error, "BucketAlreadyExists");
}

function hasErrorCode(error: unknown, expected: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; Code?: unknown; code?: unknown };
  return candidate.name === expected || candidate.Code === expected || candidate.code === expected;
}

function httpStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    $response?: { statusCode?: unknown };
  };
  const status = candidate.$metadata?.httpStatusCode
    ?? candidate.$response?.statusCode
    ?? candidate.statusCode;
  return typeof status === "number" ? status : undefined;
}
