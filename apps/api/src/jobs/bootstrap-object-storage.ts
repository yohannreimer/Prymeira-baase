import "dotenv/config";
import { pathToFileURL } from "node:url";
import { readRuntimeConfig } from "../config/runtime";
import { assertRuntimeStoragePolicy } from "../server-initialization";
import { bootstrapS3ObjectStorage } from "../storage/s3-object-storage-bootstrap";

export async function runObjectStorageBootstrap() {
  const runtimeConfig = readRuntimeConfig(process.env);
  assertRuntimeStoragePolicy(runtimeConfig);
  const s3 = runtimeConfig.objectStorage.s3;
  if (runtimeConfig.objectStorage.provider !== "s3" || !s3) {
    throw new Error("S3_OBJECT_STORAGE_REQUIRED");
  }

  const result = await bootstrapS3ObjectStorage(s3);
  console.info(JSON.stringify({
    event: "object-storage-bootstrap-complete",
    ...result
  }));
  return result;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  runObjectStorageBootstrap().catch((error) => {
    console.error("Object storage bootstrap failed", error);
    process.exitCode = 1;
  });
}
