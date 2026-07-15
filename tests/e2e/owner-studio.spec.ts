import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:3090";
const ownerA = actor("owner", "profile_owner");
const ownerB = actor("owner", "profile_owner_b");
const manager = actor("manager", "profile_manager");
const employee = actor("employee", "profile_employee");

test.describe("Owner Studio release acceptance", () => {
  test("1. resilient audio capture: owner leaves and returns to the original audio and transcript", async ({ page }) => {
    const filename = `reflexao-${Date.now()}.wav`;
    await openStudio(page);
    await page.getByTestId("studio-audio-input").setInputFiles({
      name: filename,
      mimeType: "audio/wav",
      buffer: wavFixture()
    });

    await expect(page.getByLabel("Materiais do documento").getByRole("heading", { name: filename })).toBeVisible();
    await expect(page.getByText("Transcrição determinística: preservar a fala original e organizar a próxima revisão.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Baixar áudio original" })).toBeVisible();

    await page.getByRole("link", { name: "Painel", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Bom dia|Acompanhamento operacional/ })).toBeVisible();
    await page.getByRole("link", { name: "Estúdio", exact: true }).click();
    await page.getByRole("button", { name: "Entrada", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(filename) }).click();

    await expect(page.getByLabel("Materiais do documento").getByRole("heading", { name: filename })).toBeVisible();
    await expect(page.getByText("Transcrição determinística: preservar a fala original e organizar a próxima revisão.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Baixar áudio original" })).toBeVisible();
  });

  test("2. AI organization: accepting a goal-like proposal preserves the readable original version", async ({ page }) => {
    const original = `Quero reduzir a dependência operacional sem perder qualidade ${Date.now()}.`;
    await openStudio(page);
    await page.getByRole("textbox", { name: "Registre um pensamento" }).fill(original);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toContainText(original);
    await page.getByLabel("O que você quer entender melhor?").fill("Organize como uma meta revisável.");
    await page.getByRole("checkbox", { name: "Criar proposta revisável" }).check();
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const suggestion = page.getByRole("region", { name: "Proposta revisável da IA" });
    await expect(suggestion).toContainText(`Meta proposta: ${original}`);
    await suggestion.getByRole("button", { name: "Aceitar como nova versão" }).click();
    await expect(suggestion.getByRole("button", { name: "Aplicada em nova versão" })).toBeVisible();

    await page.getByRole("button", { name: "Ver histórico de versões" }).click();
    const history = page.getByRole("region", { name: "Histórico de versões" });
    await expect(history).toContainText(original);
    await expect(history).toContainText(`Meta proposta: ${original}`);
  });

  test("3. related thoughts: four matching thoughts expose the correct private sources", async ({ page, request }) => {
    const marker = `capacidade-recorrente-${Date.now()}`;
    const documents = [];
    for (let index = 1; index <= 5; index += 1) {
      documents.push(await createDocument(request, ownerA, `Pensamento relacionado ${index} ${marker}`, `${marker} aparece na reflexão ${index}.`));
    }
    const source = documents[0]!;
    await expect.poll(async () => {
      const response = await api(request, ownerA, `/studio/documents/${source.id}/related?limit=4`);
      if (!response.ok()) return [];
      return (await response.json()).related.map((item: { document: { id: string } }) => item.document.id);
    }).toEqual(documents.slice(1).map((document) => document.id));

    await page.goto(`/#estudio/document/${encodeURIComponent(source.id)}`);
    await expect(page.getByRole("heading", { name: source.title })).toBeVisible();
    await page.getByRole("button", { name: "Encontrar conexões" }).click();
    for (const document of documents.slice(1)) {
      await expect(page.locator(".studio-related article").filter({ hasText: document.title })).toBeVisible();
    }
  });

  test("4. operational citations: owner chooses a period and opens the cited routine", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Análise operacional ${Date.now()}`, "Quero entender o período antes de decidir.");
    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await expect(page.getByRole("heading", { name: document.title })).toBeVisible();

    await page.getByRole("checkbox", { name: "Usar dados da operação nesta pergunta" }).check();
    await page.getByLabel("Início do período operacional").fill("2026-07-01");
    await page.getByLabel("Fim do período operacional").fill("2026-07-14");
    await page.getByLabel("O que você quer entender melhor?").fill("Analise as rotinas deste período.");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();

    await page.getByRole("button", { name: /fontes?/ }).click();
    const sources = page.getByRole("complementary", { name: "Fontes da resposta" });
    await expect(sources).toContainText("Abertura do dia - Social");
    await expect(sources).toContainText("2026-07-01 — 2026-07-14");
    await sources.getByRole("button", { name: /Abertura do dia - Social/ }).click();
    await expect(page.getByRole("heading", { name: "Rotinas" })).toBeVisible();
  });

  test("5. explicit web research: consent is per turn and external sources remain separate", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Pesquisa explícita ${Date.now()}`, "Comparar uma hipótese com informação pública.");
    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    const consent = page.getByRole("checkbox", { name: "Pesquisar na internet nesta pergunta" });
    await consent.check();
    await page.getByLabel("O que você quer entender melhor?").fill("Pesquise uma referência pública para esta hipótese.");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(consent).not.toBeChecked();
    await page.getByRole("button", { name: "1 fonte" }).click();
    const sources = page.getByRole("complementary", { name: "Fontes da resposta" });
    const external = sources.getByRole("link", { name: /Fonte pública determinística/ });
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toContainText("Fonte externa");
  });

  test("6. prepared ritual: weekly review arrives prepared and produces a pending decision", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Ritual de capacidade ${Date.now()}`, "Revisar decisões abertas toda semana.");
    const created = await api(request, ownerA, `/studio/documents/${document.id}/structures`, {
      method: "POST",
      data: {
        kind: "ritual",
        cadence_json: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" },
        properties_json: {
          intention: "Revisar a capacidade e decisões abertas.",
          guide_questions: ["O que mudou?", "Qual decisão precisa permanecer explícita?"]
        }
      }
    });
    expect(created.status()).toBe(201);
    const ritual = (await created.json()).structure;

    await page.goto("/#estudio/rituals");
    await page.getByRole("button", { name: new RegExp(`Iniciar ${escapeRegex(document.title)}`) }).click();
    await expect(page.getByRole("heading", { name: "O que mudou?" })).toBeVisible();
    await page.getByText("Ver contexto preparado").click();
    await expect(page.getByText("A preparação usa apenas fontes autorizadas para este dono.")).toBeVisible();
    await page.getByRole("textbox", { name: "Resposta para O que mudou?" }).fill("A demanda aumentou.");
    await page.getByRole("button", { name: "Salvar e continuar" }).click();
    await page.getByRole("textbox", { name: "Resposta para Qual decisão precisa permanecer explícita?" }).fill("Revisar capacidade semanalmente.");
    await page.getByRole("button", { name: "Concluir ritual" }).click();

    const pending = page.getByRole("region", { name: "Sugestões para revisar" });
    await expect(pending).toContainText("Revisar a capacidade toda segunda-feira.");
    await expect(pending).toContainText("Pendente");
    expect(ritual.id).toBeTruthy();
  });

  test("7. idempotent routine creation: edited preview creates exactly one operational routine", async ({ request }) => {
    const title = `Rotina originada no Estúdio ${Date.now()}`;
    const document = await createDocument(request, ownerA, `Decisão estratégica ${Date.now()}`, "Criar uma revisão operacional semanal.");
    const turn = await api(request, ownerA, "/studio/assistant/turns", {
      method: "POST",
      data: { document_id: document.id, message: "Prepare uma proposta revisável.", request_text_suggestion: true }
    });
    expect(turn.status()).toBe(200);
    const suggestion = sse(await turn.text(), "suggestion");
    expect(suggestion).toBeTruthy();
    const draft = {
      resource_type: "routine",
      payload: {
        title: "Título antes da revisão",
        area_id: null,
        frequency: "weekly",
        weekdays: ["mon"],
        due_hint: "Primeira atividade da manhã",
        assignee_profile_ids: [],
        execution_mode: "shared",
        approval_mode: "direct",
        evidence_policy: "optional",
        task_templates: [{
          title: "Revisar decisões abertas",
          process_id: null,
          assignee_profile_id: null,
          due_hint: null,
          approval_mode: "direct",
          evidence_policy: "optional"
        }]
      }
    };
    const previewResponse = await api(request, ownerA, `/studio/suggestions/${suggestion.id}/operation-preview`, {
      method: "POST", data: draft
    });
    expect(previewResponse.status()).toBe(201);
    const preview = (await previewResponse.json()).preview;
    expect(preview.status).toBe("preview");
    const edited = { ...draft, payload: { ...draft.payload, title } };
    const idempotencyKey = "4be66569-9968-4f8d-8652-91cf2e005b51";
    const confirmation = {
      method: "POST" as const,
      headers: { "idempotency-key": idempotencyKey },
      data: { preview_id: preview.id, draft: edited }
    };
    const first = await api(request, ownerA, `/studio/suggestions/${suggestion.id}/operation-confirm`, confirmation);
    const repeated = await api(request, ownerA, `/studio/suggestions/${suggestion.id}/operation-confirm`, confirmation);
    expect(first.status()).toBe(201);
    expect(repeated.status()).toBe(200);
    expect((await repeated.json()).link.id).toBe((await first.json()).link.id);
    const routines = (await (await api(request, ownerA, "/routines")).json()).routines;
    expect(routines.filter((routine: { title: string }) => routine.title === title)).toHaveLength(1);
  });

  test("8. cross-owner and role isolation: another owner, manager and employee cannot discover the Studio", async ({ page, request }) => {
    const secret = `SEGREDO_E2E_${Date.now()}`;
    const document = await createDocument(request, ownerA, secret, secret);
    const foreign = await api(request, ownerB, `/studio/documents/${document.id}`);
    expect(foreign.status()).toBe(404);
    expect(await foreign.text()).not.toContain(secret);
    for (const actorHeaders of [manager, employee]) {
      const response = await api(request, actorHeaders, `/studio/documents/${document.id}`);
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain(secret);
    }

    await page.goto("/#estudio");
    await expect(page.getByRole("link", { name: "Estúdio", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Gestor", exact: true }).click();
    await expect(page.getByRole("link", { name: "Estúdio", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Funcionário", exact: true }).click();
    await expect(page.getByRole("link", { name: "Estúdio", exact: true })).toHaveCount(0);
  });

  test("9. provider outage: writing and durable autosave continue while AI is unavailable", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Escrita resiliente ${Date.now()}`, "Conteúdo inicial preservado.");
    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await page.getByLabel("O que você quer entender melhor?").fill("E2E_PROVIDER_OUTAGE");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Seu documento continua salvo");

    const resilientText = ` Escrita continua mesmo sem provider ${Date.now()}.`;
    const editor = page.getByRole("textbox", { name: "Conteúdo do documento" });
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(resilientText);
    await expect(page.getByRole("status", { name: "Estado do salvamento" })).toContainText("Salvo");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toContainText(resilientText.trim());
  });
});

async function openStudio(page: Page) {
  await page.goto("/#estudio");
  await expect(page.getByRole("heading", { level: 1, name: "Estúdio" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Nova captura" })).toBeVisible();
}

function actor(role: "owner" | "manager" | "employee", profileId: string) {
  return {
    "x-baase-workspace-id": "workspace_a",
    "x-baase-role": role,
    "x-baase-profile-id": profileId
  };
}

async function api(
  request: APIRequestContext,
  actorHeaders: Record<string, string>,
  path: string,
  options: { method?: string; data?: unknown; headers?: Record<string, string> } = {}
) {
  return request.fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: { ...actorHeaders, ...(options.headers ?? {}) },
    ...(options.data === undefined ? {} : { data: options.data })
  });
}

async function createDocument(request: APIRequestContext, actorHeaders: Record<string, string>, title: string, bodyText: string) {
  const response = await api(request, actorHeaders, "/studio/documents", {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      title,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] },
      body_text: bodyText,
      capture_mode: "text"
    }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).document as { id: string; title: string; revision: number };
}

function sse(body: string, eventName: string) {
  const frame = body.split("\n\n").find((candidate) => candidate.startsWith(`event: ${eventName}\n`));
  if (!frame) return null;
  const data = frame.split("\n").find((line) => line.startsWith("data: "));
  return data ? JSON.parse(data.slice("data: ".length)) : null;
}

function wavFixture() {
  const sampleRate = 8_000;
  const sampleCount = sampleRate;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 12) * 1_000), 44 + index * 2);
  }
  return buffer;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
