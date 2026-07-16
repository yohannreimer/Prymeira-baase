import { expect, test } from "@playwright/test";

const productionUrl = process.env.BAASE_PRODUCTION_URL?.replace(/\/$/u, "") ?? null;
const authState = process.env.BAASE_PRODUCTION_AUTH_STATE ?? null;

test.skip(!productionUrl || !authState, "production Studio smoke needs BAASE_PRODUCTION_URL and BAASE_PRODUCTION_AUTH_STATE");

test("deployed Owner Studio reports honest private-intelligence readiness", async ({ page }) => {
  await page.goto(`${productionUrl}/#estudio`);
  await expect(page.getByRole("heading", { level: 1, name: "Estúdio" })).toBeVisible();

  const response = await page.request.get(`${productionUrl}/api/studio/readiness`);
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({
    ai: { status: "ready", code: null },
    embeddings: { status: "ready", code: null },
    vector: { status: "ready", code: null },
    maintenance: { status: "ready", code: null }
  });

  const home = await page.request.get(`${productionUrl}/api/studio/home`);
  expect(home.ok()).toBeTruthy();
  expect(await home.json()).toHaveProperty("home");
});

test("configured gpt-5.6-terra completes an owner-only disposable turn", async ({ page }) => {
  const runtime = await page.request.get(`${productionUrl}/api/readiness`);
  expect(runtime.ok()).toBeTruthy();
  expect(await runtime.json()).toMatchObject({ ai: { structured: "openai" } });

  const created = await page.request.post(`${productionUrl}/api/studio/documents`, {
    headers: { "idempotency-key": crypto.randomUUID() },
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
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".studio-copilot-turn__answer")).not.toBeEmpty({ timeout: 45_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    const trashed = await page.request.post(`${productionUrl}/api/studio/documents/${encodeURIComponent(documentId)}/trash`);
    expect(trashed.ok()).toBeTruthy();
    const deleted = await page.request.delete(`${productionUrl}/api/studio/documents/${encodeURIComponent(documentId)}`);
    expect(deleted.status()).toBe(204);
  }
});
