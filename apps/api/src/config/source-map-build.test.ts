import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootFile = (path: string) => fileURLToPath(
  new URL(`../../../../${path}`, import.meta.url)
);

describe("private frontend source-map build contract", () => {
  it("builds hidden maps and uploads the exact release through a BuildKit secret", () => {
    const vite = readFileSync(rootFile("apps/web/vite.config.ts"), "utf8");
    const dockerfile = readFileSync(rootFile("apps/web/Dockerfile"), "utf8");

    expect(vite).toMatch(/sourcemap:\s*"hidden"/);
    expect(dockerfile).toContain("# syntax=docker/dockerfile:1.7");
    expect(dockerfile).toContain("GLITCHTIP_CLI_VERSION=1.0.0");
    expect(dockerfile).toContain(
      "de1c035aa61931a6265d7b29b1614781dfee925466142a907508cb097082dfef"
    );
    expect(dockerfile).toContain(
      "--mount=type=secret,id=glitchtip_auth_token"
    );
    expect(dockerfile).toContain("/run/secrets/glitchtip_auth_token");
    expect(dockerfile).toContain(
      "glitchtip-cli sourcemaps inject /app/apps/web/dist"
    );
    expect(dockerfile).toMatch(
      /glitchtip-cli sourcemaps upload \/app\/apps\/web\/dist[\s\\]+--release "\$VITE_BAASE_RELEASE"[\s\\]+--org prymeira[\s\\]+--project baase-web/
    );
    expect(dockerfile).toContain(
      "SENTRY_URL=https://glitchtip.prymeiradigital.com.br"
    );
    expect(dockerfile).toMatch(
      /find \/app\/apps\/web\/dist -type f -name '\*\.map' -delete/
    );
    expect(dockerfile.indexOf("find /app/apps/web/dist"))
      .toBeLessThan(dockerfile.indexOf("FROM nginx:1.27-alpine"));
    expect(dockerfile).not.toMatch(/ENV\s+(?:SENTRY_AUTH_TOKEN|GLITCHTIP_AUTH_TOKEN)/);
  });

  it("passes the commit release and token without persisting the secret", () => {
    const workflow = readFileSync(
      rootFile(".github/workflows/publish-images.yml"),
      "utf8"
    );

    expect(workflow).toContain('sourcemaps: "false"');
    expect(workflow).toContain('sourcemaps: "true"');
    expect(workflow).toContain("VITE_BAASE_RELEASE=${{ github.sha }}");
    expect(workflow).toContain(
      "GLITCHTIP_SOURCEMAPS_UPLOAD=${{ matrix.sourcemaps }}"
    );
    expect(workflow).toContain(
      "glitchtip_auth_token=${{ secrets.GLITCHTIP_AUTH_TOKEN }}"
    );
    expect(workflow).not.toMatch(/(?:run|env):[\s\S]{0,120}GLITCHTIP_AUTH_TOKEN/);
  });
});
