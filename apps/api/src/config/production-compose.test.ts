import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const composePath = fileURLToPath(
  new URL("../../../../docker-compose.prod.yml", import.meta.url)
);
const productionEnvExamplePath = fileURLToPath(
  new URL("../../../../.env.production.example", import.meta.url)
);
const readmePath = fileURLToPath(
  new URL("../../../../README.md", import.meta.url)
);
const migrationRunbookPath = fileURLToPath(
  new URL("../../../../docs/deployment-operational-migration.md", import.meta.url)
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
  expect(api).toContain("S3_MULTIPART_CLEANUP_MODE: minio-native");
  expect(web).not.toContain(storageEndpoint);

  expect(minio).toMatch(
    /^    networks:\n      prymeira_baase_internal:\n        aliases:\n(?:          - [^\n]+\n)*          - minio$/m
  );
  expect(minio).not.toMatch(/^    (?:ports|labels):/m);
  expect(minio).not.toContain("network_swarm_public");
  expect(minio).toContain("MINIO_API_STALE_UPLOADS_EXPIRY: 24h");
  expect(minio).toContain("MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL: 1h");

  for (const key of webForbiddenStorageKeys) {
    expect(web).not.toMatch(new RegExp(`^\\s+${key}:`, "m"));
  }

  expect(bootstrap).toContain(storageEndpoint);
  expect(bootstrap).toContain("S3_MULTIPART_CLEANUP_MODE: minio-native");
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

  it("rejects a stack that disables native MinIO multipart cleanup", () => {
    const compose = readFileSync(composePath, "utf8");
    const api = serviceBlock(compose, "prymeira_baase_api");
    const minio = serviceBlock(compose, "prymeira_baase_minio");
    const bootstrap = serviceBlock(compose, "prymeira_baase_minio_bootstrap");

    expect(() => expectStorageContract(compose.replace(
      api,
      api.replace("S3_MULTIPART_CLEANUP_MODE: minio-native", "S3_MULTIPART_CLEANUP_MODE: lifecycle")
    ))).toThrow();
    expect(() => expectStorageContract(compose.replace(
      bootstrap,
      bootstrap.replace("S3_MULTIPART_CLEANUP_MODE: minio-native", "S3_MULTIPART_CLEANUP_MODE: lifecycle")
    ))).toThrow();
    expect(() => expectStorageContract(compose.replace(
      minio,
      minio.replace("      MINIO_API_STALE_UPLOADS_EXPIRY: 24h\n", "")
    ))).toThrow();
    expect(() => expectStorageContract(compose.replace(
      minio,
      minio.replace("      MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL: 1h\n", "")
    ))).toThrow();
  });
});

describe("production stack operator configuration contract", () => {
  it("exposes only BAASE_MINIO credentials as operator-managed storage inputs", () => {
    const envExample = readFileSync(productionEnvExamplePath, "utf8");
    const readme = readFileSync(readmePath, "utf8");
    const migrationRunbook = readFileSync(migrationRunbookPath, "utf8");
    const operatorDocs = [readme, migrationRunbook];

    expect(envExample).not.toMatch(/^S3_[A-Z0-9_]*=/m);
    expect(envExample).toMatch(/^BAASE_MINIO_ACCESS_KEY=.+$/m);
    expect(envExample).toMatch(/^BAASE_MINIO_SECRET_KEY=.+$/m);
    expect(readme).toContain("o operador define apenas estas credenciais");
    expect(readme).toMatch(/esses valores não\s+são inputs externos da stack/);
    expect(migrationRunbook).toContain(
      "Nao defina as variaveis `S3_*` externamente"
    );

    for (const documentation of operatorDocs) {
      expect(documentation).toContain("BAASE_MINIO_ACCESS_KEY");
      expect(documentation).toContain("BAASE_MINIO_SECRET_KEY");
      expect(documentation).not.toMatch(/^(?:[-*] )?`?S3_[A-Z0-9_]+`?(?:=|:)/m);
      expect(documentation).not.toMatch(
        /\b(?:configure|configurar|preencha|defina)\s+`S3_[A-Z0-9_]+`/i
      );
    }
  });
});
