import { expect, test, type Page } from "@playwright/test";

const productionUrl = process.env.BAASE_PRODUCTION_URL?.replace(/\/$/u, "") ?? null;
const authState = process.env.BAASE_PRODUCTION_AUTH_STATE ?? null;
const explicitBearer = process.env.BAASE_PRODUCTION_BEARER_TOKEN?.trim() || null;

test.skip(!productionUrl || !authState, "production Studio smoke needs BAASE_PRODUCTION_URL and BAASE_PRODUCTION_AUTH_STATE");

test("deployed Owner Studio reports honest private-intelligence readiness", async ({ page }) => {
  const authorization = await openStudioAndResolveAuthorization(page);
  await expect(page.getByRole("heading", { level: 1, name: "Estúdio" })).toBeVisible();

  const response = await page.request.get(`${productionUrl}/api/studio/readiness`, { headers: { authorization } });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({
    ai: { status: "ready", code: null },
    embeddings: { status: "ready", code: null },
    vector: { status: "ready", code: null },
    maintenance: { status: "ready", code: null }
  });

  const home = await page.request.get(`${productionUrl}/api/studio/home`, { headers: { authorization } });
  expect(home.ok()).toBeTruthy();
  expect(await home.json()).toHaveProperty("home");
});

test("configured gpt-5.6-terra completes an owner-only disposable turn", async ({ page }) => {
  const authorization = await openStudioAndResolveAuthorization(page);
  const runtime = await page.request.get(`${productionUrl}/api/readiness`, { headers: { authorization } });
  expect(runtime.ok()).toBeTruthy();
  expect(await runtime.json()).toMatchObject({ ai: { structured: "openai" } });

  const created = await page.request.post(`${productionUrl}/api/studio/documents`, {
    headers: { authorization, "idempotency-key": crypto.randomUUID() },
    data: {
      title: "Verificação privada de release",
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Contexto sintético sem dados de cliente." }] }] },
      body_text: "Contexto sintético sem dados de cliente.",
      capture_mode: "text"
    }
  });
  expect(created.status()).toBe(201);
  const payload = await created.json();
  const documentId = String(payload.document.id);

  try {
    await page.goto(`${productionUrl}/#estudio/document/${encodeURIComponent(documentId)}`);
    await page.getByLabel("O que você quer entender melhor?").fill("Responda apenas: verificação concluída.");
    const terminalStream = page.waitForResponse((response) =>
      response.url() === `${productionUrl}/api/studio/assistant/turns`
      && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const streamResponse = await terminalStream;
    expect(streamResponse.ok()).toBeTruthy();
    expect(streamResponse.headers()["content-type"]).toContain("text/event-stream");
    expect(await streamResponse.finished()).toBeNull();
    await expect(page.getByRole("button", { name: "Parar resposta" })).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator(".studio-copilot-turn__answer")).toHaveText(/verificação concluída\.?/i);
    await expect(page.locator(".studio-copilot__error")).toHaveCount(0);
  } finally {
    const trashed = await page.request.post(`${productionUrl}/api/studio/documents/${encodeURIComponent(documentId)}/trash`, { headers: { authorization } });
    expect(trashed.ok()).toBeTruthy();
    const deleted = await page.request.delete(`${productionUrl}/api/studio/documents/${encodeURIComponent(documentId)}`, { headers: { authorization } });
    expect(deleted.status()).toBe(204);
  }
});

async function openStudioAndResolveAuthorization(page: Page): Promise<string> {
  if (explicitBearer) {
    await page.goto(`${productionUrl}/#estudio`);
    return explicitBearer.toLocaleLowerCase("en-US").startsWith("bearer ") ? explicitBearer : `Bearer ${explicitBearer}`;
  }

  const authenticatedRequest = page.waitForRequest(async (request) => {
    if (!request.url().startsWith(`${productionUrl}/api/`)) return false;
    const headers = await request.allHeaders();
    return typeof headers.authorization === "string" && headers.authorization.toLocaleLowerCase("en-US").startsWith("bearer ");
  }, { timeout: 20_000 });
  await page.goto(`${productionUrl}/#estudio`);
  const headers = await (await authenticatedRequest).allHeaders();
  if (!headers.authorization) throw new Error("PRODUCTION_SMOKE_AUTHORIZATION_UNAVAILABLE");
  return headers.authorization;
}
