import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const composePath = fileURLToPath(
  new URL("../../../../docker-compose.prod.yml", import.meta.url)
);

describe("production compose object storage contract", () => {
  it("uses the stable MinIO alias for the API and bootstrap job", () => {
    const compose = readFileSync(composePath, "utf8");

    const legacyEndpoint = "http://prymeira_" + "baase_minio:9000";

    expect(compose).not.toContain(legacyEndpoint);
    expect(compose.match(/S3_ENDPOINT: http:\/\/minio:9000/g)).toHaveLength(2);
    expect(compose).toMatch(/^  prymeira_baase_minio_bootstrap:$/m);
    expect(compose).toContain("storage:bootstrap");
    expect(compose).toMatch(
      /prymeira_baase_minio:\n[\s\S]*?networks:\n\s+prymeira_baase_internal:\n\s+aliases:\n(?:\s+- [^\n]+\n)*?\s+- minio(?:\n|$)/
    );
  });
});
