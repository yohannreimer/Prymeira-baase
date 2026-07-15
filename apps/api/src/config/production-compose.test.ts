import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const composePath = fileURLToPath(
  new URL("../../../../docker-compose.prod.yml", import.meta.url)
);
const storageEndpoint = "S3_ENDPOINT: http://minio:9000";
const legacyEndpoint = "http://prymeira_" + "baase_minio:9000";
const webForbiddenStorageKeys = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "BAASE_MINIO_ACCESS_KEY",
  "BAASE_MINIO_SECRET_KEY"
] as const;

function serviceBlock(compose: string, serviceName: string): string {
  const lines = compose.split(/\r?\n/);
  const header = `  ${serviceName}:`;
  const start = lines.findIndex((line) => line === header);

  if (start === -1) {
    throw new Error(`Service ${serviceName} not found in production compose`);
  }

  const nextBoundary = lines.findIndex((line, index) =>
    index > start && (
      /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line) ||
      /^[^\s#]/.test(line)
    )
  );
  const end = nextBoundary === -1 ? lines.length : nextBoundary;

  return lines.slice(start, end).join("\n");
}

function expectStorageContract(compose: string): void {
  const api = serviceBlock(compose, "prymeira_baase_api");
  const minio = serviceBlock(compose, "prymeira_baase_minio");
  const bootstrap = serviceBlock(compose, "prymeira_baase_minio_bootstrap");
  const web = serviceBlock(compose, "prymeira_baase_web");

  expect(compose).not.toContain(legacyEndpoint);
  expect(compose.match(/S3_ENDPOINT: http:\/\/minio:9000/g)).toHaveLength(2);

  expect(api).toContain(storageEndpoint);
  expect(web).not.toContain(storageEndpoint);

  expect(minio).toMatch(
    /^    networks:\n      prymeira_baase_internal:\n        aliases:\n(?:          - [^\n]+\n)*          - minio$/m
  );
  expect(minio).not.toMatch(/^    (?:ports|labels):/m);
  expect(minio).not.toContain("network_swarm_public");

  for (const key of webForbiddenStorageKeys) {
    expect(web).not.toMatch(new RegExp(`^\\s+${key}:`, "m"));
  }

  expect(bootstrap).toContain(storageEndpoint);
  expect(bootstrap).toContain(
    'command: ["pnpm", "--filter", "@prymeira/baase-api", "storage:bootstrap"]'
  );
  expect(bootstrap).toMatch(
    /^    networks:\n      - prymeira_baase_internal\n    environment:/m
  );
  expect(bootstrap).toMatch(/^      replicas: 1$/m);
  expect(bootstrap).toMatch(
    /^      restart_policy:\n        condition: on-failure$/m
  );
  expect(bootstrap).not.toMatch(/^    (?:ports|labels|volumes):/m);
}

describe("production compose object storage contract", () => {
  it("assigns object storage configuration to the intended services", () => {
    const compose = readFileSync(composePath, "utf8");

    expectStorageContract(compose);
  });

  it("rejects moving the API endpoint to the web service", () => {
    const compose = readFileSync(composePath, "utf8");
    const api = serviceBlock(compose, "prymeira_baase_api");
    const web = serviceBlock(compose, "prymeira_baase_web");
    const mutatedApi = api.replace(`      ${storageEndpoint}\n`, "");
    const mutatedWeb = web.replace(
      "    environment:\n",
      `    environment:\n      ${storageEndpoint}\n`
    );
    const mutatedCompose = compose
      .replace(api, mutatedApi)
      .replace(web, mutatedWeb);

    expect(mutatedCompose.match(/S3_ENDPOINT: http:\/\/minio:9000/g)).toHaveLength(2);
    expect(() => expectStorageContract(mutatedCompose)).toThrow();
  });

  it("rejects publishing MinIO or exposing storage secrets to the web", () => {
    const compose = readFileSync(composePath, "utf8");
    const minio = serviceBlock(compose, "prymeira_baase_minio");
    const web = serviceBlock(compose, "prymeira_baase_web");
    const publicMinio = minio.replace(
      "    environment:\n",
      '    ports:\n      - "9000:9000"\n    environment:\n'
    );
    const webWithSecret = web.replace(
      "    environment:\n",
      "    environment:\n      S3_SECRET_KEY: leaked-to-web\n"
    );

    expect(() => expectStorageContract(compose.replace(minio, publicMinio))).toThrow();
    expect(() => expectStorageContract(compose.replace(web, webWithSecret))).toThrow();
  });
});
