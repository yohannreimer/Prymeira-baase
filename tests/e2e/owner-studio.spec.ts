import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:3090";
const ownerA = actor("owner", "profile_owner");
const ownerB = actor("owner", "profile_owner_b");
const manager = actor("manager", "profile_manager");
const employee = actor("employee", "profile_employee");

test.describe("Owner Studio release acceptance", () => {
  test("1. resilient audio capture: owner leaves and returns to the original audio and transcript", async ({ page }, testInfo) => {
    const captureMarker = `captura-audio-${uniqueTestMarker(testInfo)}`;
    const filename = `reflexao-${Date.now()}.wav`;
    await openStudio(page);
    await page.getByRole("textbox", { name: "Registre um pensamento" }).fill(captureMarker);
    await page.getByTestId("studio-audio-input").setInputFiles({
      name: filename,
      mimeType: "audio/wav",
      buffer: wavFixture()
    });

    await page.getByRole("button", { name: `Abrir ${filename}` }).click();
    await expectReadyAudioInspector(page, filename);
    await page.getByRole("button", { name: "Fechar material" }).click();
    await expect(page.getByRole("dialog", { name: `Material ${filename}` })).toHaveCount(0);

    await page.getByRole("link", { name: "Painel", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Bom dia|Acompanhamento operacional/ })).toBeVisible();
    await page.getByRole("link", { name: "Estúdio", exact: true }).click();
    await page.getByRole("button", { name: "Entrada", exact: true }).click();
    const exactCapture = page.getByRole("listitem").filter({ hasText: captureMarker });
    await expect(exactCapture).toHaveCount(1);
    await exactCapture.getByRole("button", { name: /^Registro em áudio/u }).click();
    await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toContainText(captureMarker);

    await page.getByRole("button", { name: `Abrir ${filename}` }).click();
    await expectReadyAudioInspector(page, filename);
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
    const history = page.getByRole("dialog", { name: "Histórico de versões" });
    await expect(history.getByRole("document", { name: "Prévia imutável da versão 2" })).toContainText(`Meta proposta: ${original}`);
    await history.getByRole("button", { name: /^Histórico anterior/u }).click();
    await history.getByRole("button", { name: /^Versão 1/u }).click();
    await expect(history.getByRole("document", { name: "Prévia imutável da versão 1" })).toContainText(original);
  });

  test("3. related thoughts: four matching thoughts expose the correct private sources", async ({ page, request }, testInfo) => {
    const marker = `capacidade-recorrente-${uniqueTestMarker(testInfo)}`;
    const documents = [];
    for (let index = 1; index <= 5; index += 1) {
      documents.push(await createDocument(request, ownerA, `Pensamento relacionado ${index} ${marker}`, `${marker} aparece na reflexão ${index}.`));
    }
    const source = documents[0]!;
    await expect.poll(async () => {
      const response = await api(request, ownerA, `/studio/documents/${source.id}/related?limit=4`);
      if (!response.ok()) return [];
      return (await response.json()).related
        .map((item: { document: { id: string } }) => item.document.id)
        .sort();
    }).toEqual(documents.slice(1).map((document) => document.id).sort());

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

  test("6. weekly light summary stays separate from the owner's answers", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Ritual de capacidade ${Date.now()}`, "Revisar decisões abertas toda semana.");
    const created = await api(request, ownerA, `/studio/documents/${document.id}/structures`, {
      method: "POST",
      data: {
        kind: "ritual",
        cadence_json: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" },
        properties_json: {
          intention: "Revisar a capacidade e decisões abertas.",
          guide_questions: ["O que mudou?", "Qual decisão precisa permanecer explícita?"],
          support_mode: "light_summary"
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

    await expect(page.getByRole("heading", { name: "Ritual registrado" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Resumo da IA" })).toContainText("A revisão tornou a decisão explícita");
    await expect(page.getByRole("region", { name: "Respostas deste ritual" })).toContainText("Revisar capacidade semanalmente.");
    await expect(page.getByRole("region", { name: "Pontos para continuar pensando" })).toHaveCount(0);
    expect(ritual.id).toBeTruthy();
  });

  test("6b. daily record keeps three answers in dated history and leaves AI optional", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Ritual diário ${Date.now()}`, "Registrar o foco do dia sem criar novas ações.");
    const created = await api(request, ownerA, `/studio/documents/${document.id}/structures`, {
      method: "POST",
      data: {
        kind: "ritual",
        cadence_json: { frequency: "daily", local_time: "08:00", timezone: "America/Sao_Paulo" },
        properties_json: {
          intention: "Manter o foco do dia com os pés no chão.",
          guide_questions: ["Qual é o foco principal?", "Quais são os dois apoios?", "O que você vai estudar?"],
          support_mode: "record_only"
        }
      }
    });
    expect(created.status()).toBe(201);

    await page.goto("/#estudio/rituals");
    await page.getByRole("button", { name: new RegExp(`Iniciar ${escapeRegex(document.title)}`) }).click();
    await page.getByRole("textbox", { name: "Resposta para Qual é o foco principal?" }).fill("Gravar o vídeo autoral.");
    await page.getByRole("button", { name: "Salvar e continuar" }).click();
    await page.getByRole("textbox", { name: "Resposta para Quais são os dois apoios?" }).fill("Roteiro e revisão comercial.");
    await page.getByRole("button", { name: "Salvar e continuar" }).click();
    await page.getByRole("textbox", { name: "Resposta para O que você vai estudar?" }).fill("Continuar Isso é Marketing.");
    await page.getByRole("button", { name: "Concluir ritual" }).click();

    await expect(page.getByRole("heading", { name: "Ritual registrado" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprofundar com IA" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Resumo da IA" })).toHaveCount(0);
    await page.locator(".studio-rituals__back").click();
    await page.locator(".studio-ritual-row__open").filter({ hasText: document.title }).click();
    const history = page.getByRole("region", { name: "Histórico do ritual" });
    await history.locator("summary").first().click();
    await expect(history).toContainText("Gravar o vídeo autoral.");
    await expect(history).toContainText("Continuar Isso é Marketing.");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  });

  test("6c. monthly guided reflection offers a short set of thinking points", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Reflexão mensal ${Date.now()}`, "Revisar o rumo da empresa.");
    const created = await api(request, ownerA, `/studio/documents/${document.id}/structures`, {
      method: "POST",
      data: {
        kind: "ritual",
        cadence_json: { frequency: "monthly", month_day: 14, local_time: "09:00", timezone: "America/Sao_Paulo" },
        properties_json: {
          intention: "Revisar o rumo da empresa.",
          guide_questions: ["O que merece uma reflexão mais profunda?"],
          support_mode: "guided_reflection"
        }
      }
    });
    expect(created.status()).toBe(201);

    await page.goto("/#estudio/rituals");
    await page.getByRole("button", { name: new RegExp(`Iniciar ${escapeRegex(document.title)}`) }).click();
    await page.getByRole("textbox", { name: "Resposta para O que merece uma reflexão mais profunda?" }).fill("A capacidade sem perder qualidade.");
    await page.getByRole("button", { name: "Concluir ritual" }).click();

    const reflection = page.getByRole("region", { name: "Pontos para continuar pensando" });
    await expect(reflection).toContainText("Revisar a capacidade toda segunda-feira.");
    await expect(reflection.locator("li")).toHaveCount(2);
    await expect(reflection).not.toContainText("Pendente");
  });

  test("7. idempotent task creation: edited UI preview survives a lost response and creates exactly one task", async ({ page, request }, testInfo) => {
    const marker = uniqueTestMarker(testInfo);
    const title = `Tarefa originada no Estúdio ${marker}`;
    const dueDay = 20 + ((testInfo.repeatEachIndex + testInfo.retry) % 8);
    const dueDate = `2026-07-${String(dueDay).padStart(2, "0")}`;
    const document = await createDocument(
      request,
      ownerA,
      `Decisão estratégica ${marker}`,
      "Criar um próximo passo operacional revisável."
    );
    const confirmationKeys: string[] = [];
    let confirmationRequests = 0;
    let committedResponseStatus: number | undefined;

    await page.route("**/api/studio/suggestions/*/operation-confirm", async (route) => {
      confirmationRequests += 1;
      confirmationKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (confirmationRequests === 1) {
        const committedResponse = await route.fetch();
        committedResponseStatus = committedResponse.status();
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "E2E_LOST_CONFIRMATION_RESPONSE",
              message: "A criação foi processada, mas a resposta não chegou ao cliente."
            }
          })
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await expect(page.getByRole("heading", { name: document.title })).toBeVisible();
    await page.getByLabel("O que você quer entender melhor?").fill("Prepare uma proposta revisável para este próximo passo.");
    await page.getByRole("checkbox", { name: "Criar proposta revisável" }).check();
    await page.getByRole("button", { name: "Enviar", exact: true }).click();

    const suggestion = page.getByRole("region", { name: "Proposta revisável da IA" });
    await expect(suggestion).toBeVisible();
    await suggestion.getByRole("button", { name: "Levar para a operação" }).click();

    const preview = suggestion.getByRole("region", { name: "Prévia operacional" });
    await expect(preview).toBeVisible();
    await preview.getByLabel("Título", { exact: true }).fill(title);
    await preview.getByLabel("Data de vencimento").fill(dueDate);
    await preview.getByRole("button", { name: "Confirmar e criar 1 registro" }).click();

    await expect(preview.getByRole("alert")).toContainText("A criação não foi confirmada");
    await preview.getByRole("button", { name: "Tentar confirmação novamente" }).dblclick();

    const created = suggestion.getByRole("region", { name: "Recurso criado" });
    await expect(created).toContainText(title);
    expect(committedResponseStatus).toBe(201);
    expect(confirmationRequests).toBe(2);
    expect(confirmationKeys).toHaveLength(2);
    expect(confirmationKeys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(confirmationKeys[1]).toBe(confirmationKeys[0]);

    await created.getByRole("button", { name: "Abrir tarefa" }).click();
    const taskDetails = page.getByRole("dialog", { name: "Detalhes da tarefa" });
    await expect(taskDetails.getByRole("heading", { name: title })).toBeVisible();

    const todayResponse = await api(request, ownerA, `/today?date=${dueDate}`);
    expect(todayResponse.status()).toBe(200);
    const today = await todayResponse.json();
    expect(today.tasks.filter((task: { title: string }) => task.title === title)).toHaveLength(1);
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

  test("10. clipboard fallback copies a safe source link without escaping the material dialog", async ({ page, context, request }) => {
    const sourceUrl = `https://example.com/referencia-${Date.now()}`;
    const document = await createDocument(request, ownerA, `Referência ${Date.now()}`, "Contexto preservado.");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5190" });
    await page.addInitScript(() => {
      Object.defineProperty(window, "__nativeClipboard", { value: navigator.clipboard });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await page.route(`**/api/studio/documents/${document.id}/assets`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assets: [{
          id: "asset_link_fallback",
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          document_id: document.id,
          idempotency_key: null,
          kind: "link_snapshot",
          display_name: "Referência externa",
          source_url: sourceUrl,
          final_url: sourceUrl,
          mime_type: "text/html",
          size_bytes: 512,
          extraction_status: "ready",
          extracted_text: "Trecho preservado da referência externa.",
          last_error_code: null,
          attempt_count: 1,
          next_attempt_at: null,
          created_at: now,
          updated_at: now
        }] })
      });
    });

    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await page.getByRole("button", { name: "Abrir Referência externa" }).click();
    const materialDialog = page.getByRole("dialog", { name: "Material Referência externa" });
    const copyButton = materialDialog.getByRole("button", { name: "Copiar link" });
    await copyButton.click();

    await expect(materialDialog.getByRole("status")).toContainText("Link copiado");
    await expect(copyButton).toBeFocused();
    const clipboardText = await page.evaluate(async () => {
      const nativeClipboard = (window as unknown as { __nativeClipboard: Clipboard }).__nativeClipboard;
      return nativeClipboard.readText();
    });
    expect(clipboardText).toBe(sourceUrl);
  });

  test("11. owner structure, collection, connections and trash lifecycle stay coherent", async ({ page, request }, testInfo) => {
    const marker = uniqueTestMarker(testInfo);
    const title = `Direção trimestral ${marker}`;
    const collectionName = `Q3 ${marker.slice(-8)}`;
    const document = await createDocument(request, ownerA, title, `Contexto privado ${marker}`);

    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await page.getByRole("button", { name: "Estruturar este pensamento" }).click();
    await page.getByRole("button", { name: "Decisão", exact: true }).click();
    await page.getByLabel("Decisão tomada", { exact: true }).fill("Preservar foco no trimestre.");
    await page.getByRole("button", { name: "Criar decisão" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Decisão: ${escapeRegex(title)}`) })).toBeVisible();

    await page.getByRole("button", { name: "Decisões", exact: true }).click();
    await expect(page.getByRole("listitem", { name: title })).toBeVisible();

    await page.getByRole("button", { name: "Coleções", exact: true }).click();
    await page.getByLabel("Nova coleção").fill(collectionName);
    await page.getByRole("button", { name: "Criar", exact: true }).click();
    await expect(page.getByRole("button", { name: collectionName, exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Tudo", exact: true }).click();
    let row = page.getByRole("listitem", { name: title });
    await row.getByRole("button", { name: "Organizar em coleções" }).click();
    await row.getByRole("checkbox", { name: collectionName }).check();
    await expect(page.getByRole("status").filter({ hasText: "Documento adicionado à coleção." })).toBeAttached();
    await page.reload();
    row = page.getByRole("listitem", { name: title });
    await row.getByRole("button", { name: "Organizar em coleções" }).click();
    await expect(row.getByRole("checkbox", { name: collectionName })).toBeChecked();

    await row.locator(".studio-library-row__open").click();
    await page.getByRole("button", { name: "Encontrar conexões" }).click();
    await expect(page.getByText(/Nenhuma conexão encontrada|Pensamento relacionado/u).first()).toBeVisible();

    await page.getByRole("button", { name: "Tudo", exact: true }).click();
    row = page.getByRole("listitem", { name: title });
    await row.getByRole("button", { name: "Mover para a lixeira" }).click();
    await row.getByRole("button", { name: "Mover para a lixeira" }).click();
    await page.getByRole("button", { name: "Lixeira", exact: true }).click();
    await page.getByRole("button", { name: `Restaurar ${title}` }).click();

    await page.getByRole("button", { name: "Tudo", exact: true }).click();
    row = page.getByRole("listitem", { name: title });
    await row.getByRole("button", { name: "Mover para a lixeira" }).click();
    await row.getByRole("button", { name: "Mover para a lixeira" }).click();
    await page.getByRole("button", { name: "Lixeira", exact: true }).click();
    await page.getByRole("button", { name: `Excluir definitivamente ${title}` }).click();
    const dialog = page.getByRole("dialog", { name: "Excluir definitivamente?" });
    await dialog.getByRole("textbox").fill(title);
    await dialog.getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0);
    expect((await api(request, ownerA, `/studio/documents/${document.id}`)).status()).toBe(404);
  });

  test("12. connection index reports transient and failed states honestly", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Conexões honestas ${Date.now()}`, "Memória ainda em preparação.");
    let calls = 0;
    await page.route(`**/api/studio/documents/${document.id}/related?*`, async (route) => {
      calls += 1;
      const status = calls === 1 ? "pending" : calls === 2 ? "failed" : "unavailable";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ index: { status, code: `E2E_${status.toUpperCase()}`, indexedVersionId: null }, related: [] })
      });
    });
    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await page.getByRole("button", { name: "Encontrar conexões" }).click();
    await expect(page.getByText("Preparando conexões deste pensamento…")).toBeVisible();
    await expect(page.getByText("As conexões não puderam ser preparadas.")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByText("As conexões estão indisponíveis neste momento.")).toBeVisible();
  });

  test("13. history stays bounded while compact PDF opens in the material inspector", async ({ page, request }, testInfo) => {
    const document = await createDocument(request, ownerA, `Histórico e material ${Date.now()}`, "Texto base.");
    for (let index = 0; index < 12; index += 1) {
      const response = await api(request, ownerA, `/studio/documents/${document.id}/checkpoints`, {
        method: "POST",
        data: { expected_revision: document.revision, reason: "manual", checkpoint_key: `e2e:${uniqueTestMarker(testInfo)}:${index}` }
      });
      expect(response.status()).toBe(201);
    }
    await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
    await page.getByRole("button", { name: "Ver histórico de versões" }).click();
    const history = page.getByRole("dialog", { name: "Histórico de versões" });
    await expect(history.getByRole("button", { name: /^Versão / })).toHaveCount(10);
    await history.getByRole("button", { name: "Fechar histórico" }).click();

    const filename = `direcao-${Date.now()}.pdf`;
    await page.getByTestId("studio-material-file-input").setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: minimalPdfFixture("Direcao trimestral")
    });
    const compactMaterial = page.getByRole("button", { name: `Abrir ${filename}` });
    await expect(compactMaterial).toBeVisible();
    await compactMaterial.click();
    const inspector = page.getByRole("dialog", { name: `Material ${filename}` });
    await expect(inspector.getByRole("heading", { name: `Material ${filename}` })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Baixar original" })).toBeVisible();
  });

  test("14. ritual starts before slow AI preparation finishes", async ({ page, request }) => {
    const document = await createDocument(request, ownerA, `Ritual não bloqueante ${Date.now()}`, "Revisão semanal.");
    const created = await api(request, ownerA, `/studio/documents/${document.id}/structures`, {
      method: "POST",
      data: {
        kind: "ritual",
        cadence_json: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" },
        properties_json: { intention: "E2E_SLOW_PREPARATION", guide_questions: ["O que mudou?"] }
      }
    });
    expect(created.status()).toBe(201);
    await page.goto("/#estudio/rituals");
    await page.getByRole("button", { name: new RegExp(`Iniciar ${escapeRegex(document.title)}`) }).click();
    await expect(page.getByRole("heading", { name: "O que mudou?" })).toBeVisible();
    await expect(page.getByText("Preparando contexto em segundo plano…")).toBeVisible();
    await page.getByRole("textbox", { name: "Resposta para O que mudou?" }).fill("A escrita começa sem esperar a IA.");
    await expect(page.getByText("Ver contexto preparado")).toBeVisible({ timeout: 5_000 });
  });

  test("15. private export moves from queue to a real named download", async ({ page }) => {
    await page.goto("/#estudio/privacy");
    await page.getByRole("button", { name: "Preparar exportação" }).click();
    await expect(page.getByText(/Sua cópia está na fila|Preparando sua cópia|Sua cópia está pronta/u)).toBeVisible();
    const downloadLink = page.getByRole("link", { name: "Baixar cópia privada" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });
    await expect(downloadLink).toHaveAttribute("download", /^prymeira-baase-estudio-.*\.zip$/u);
    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^prymeira-baase-estudio-.*\.zip$/u);
  });
});

async function openStudio(page: Page) {
  await page.goto("/#estudio");
  await expect(page.getByRole("heading", { level: 1, name: "Estúdio" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Nova captura" })).toBeVisible();
}

async function expectReadyAudioInspector(page: Page, filename: string) {
  const dialog = page.getByRole("dialog", { name: `Material ${filename}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Trecho da transcrição")).toContainText(
    "Transcrição determinística: preservar a fala original e organizar a próxima revisão."
  );
  await expect(dialog.getByLabel(`Ouvir áudio original: ${filename}`)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Inserir no documento" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Baixar original" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Tentar processamento novamente" })).toHaveCount(0);
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

function uniqueTestMarker(testInfo: TestInfo) {
  return [
    testInfo.project.name,
    `repeat-${testInfo.repeatEachIndex}`,
    `retry-${testInfo.retry}`,
    `worker-${testInfo.workerIndex}`,
    crypto.randomUUID()
  ].join("-");
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

function minimalPdfFixture(text: string) {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  return Buffer.from(body, "utf8");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
