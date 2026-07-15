import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import OperationPreview from "./OperationPreview";

afterEach(() => vi.restoreAllMocks());

describe("OperationPreview", () => {
  it("shows the exact multi-record plan, every operational field, missing references, steps, and source", async () => {
    const drafts = [taskDraft(), routineDraft()];
    let previewIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      expect(init?.method).toBe("POST");
      const draft = drafts[previewIndex]!;
      previewIndex += 1;
      return json({ preview: rawPreview(`preview_${previewIndex}`, draft) }, 201);
    });

    render(<OperationPreview
      suggestionId="suggestion_1"
      sourceDocument={{ id: "document_1", title: "Decisão sobre capacidade" }}
      drafts={drafts}
    />);

    const preview = await screen.findByRole("region", { name: "Prévia operacional" });
    expect(within(preview).getByText("2 registros")).toBeInTheDocument();
    expect(within(preview).getByText("Decisão sobre capacidade")).toBeInTheDocument();
    expect(within(preview).getByText(/1\. Tarefa pontual/)).toBeInTheDocument();
    expect(within(preview).getByDisplayValue("Revisar fechamento")).toBeInTheDocument();
    expect(within(preview).getByLabelText("Data de vencimento")).toHaveValue("2026-07-20");
    expect(within(preview).getByText("Área não definida")).toBeInTheDocument();
    expect(within(preview).getByText("Responsável não definido")).toBeInTheDocument();
    expect(within(preview).getByRole("textbox", { name: "Item 1 do checklist" })).toHaveValue("Conferir saldo");
    expect(within(preview).getByRole("textbox", { name: "Item 2 do checklist" })).toHaveValue("Registrar diferença");

    await userEvent.click(within(preview).getByText(/2\. Rotina/));
    expect(within(preview).getByDisplayValue("Fechamento diário")).toBeInTheDocument();
    expect(within(preview).getByText("Revisar o cenário")).toBeInTheDocument();
    expect(within(preview).getAllByDisplayValue("owner_a")).toHaveLength(2);
  });

  it("adds and removes empty checklist, responsible, weekday and step rows without erasing them while editing", async () => {
    const user = userEvent.setup();
    const drafts = [taskDraft(), routineDraft()];
    let index = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const draft = drafts[index++]!;
      return json({ preview: rawPreview(`preview_${index}`, draft) }, 201);
    });
    render(<OperationPreview suggestionId="suggestion_1" sourceDocument={{ id: "document_1", title: "Plano" }} drafts={drafts} />);
    const preview = await screen.findByRole("region", { name: "Prévia operacional" });

    await user.click(within(preview).getByRole("button", { name: "Adicionar item ao checklist" }));
    const emptyChecklist = within(preview).getByRole("textbox", { name: "Item 3 do checklist" });
    expect(emptyChecklist).toHaveValue("");
    expect(within(preview).getByRole("button", { name: "Confirmar e criar 2 registros" })).toBeDisabled();
    await user.type(emptyChecklist, "Validar divergências");
    expect(emptyChecklist).toHaveValue("Validar divergências");
    await user.click(within(preview).getByRole("button", { name: "Remover item 3 do checklist" }));
    expect(within(preview).queryByRole("textbox", { name: "Item 3 do checklist" })).not.toBeInTheDocument();

    await user.click(within(preview).getByText(/2\. Rotina/));
    await user.click(within(preview).getByRole("button", { name: "Adicionar responsável" }));
    const responsible = within(preview).getByRole("textbox", { name: "Responsável 2" });
    expect(responsible).toHaveValue("");
    await user.type(responsible, "owner_b");
    await user.click(within(preview).getByRole("button", { name: "Remover responsável 2" }));

    await user.click(within(preview).getByRole("button", { name: "Adicionar dia da semana" }));
    expect(within(preview).getByRole("combobox", { name: "Dia da semana 1" })).toBeInTheDocument();
    await user.click(within(preview).getByRole("button", { name: "Remover dia da semana 1" }));

    await user.click(within(preview).getByRole("button", { name: "Adicionar etapa" }));
    const newStep = within(preview).getByRole("textbox", { name: "Título da etapa 2" });
    expect(newStep).toHaveValue("");
    await user.type(newStep, "Registrar decisão");
    await user.click(within(preview).getByRole("button", { name: "Remover etapa 2" }));
    expect(within(preview).queryByRole("textbox", { name: "Título da etapa 2" })).not.toBeInTheDocument();
  });

  it("edits quiz options as multiline text and adds/removes complete question rows", async () => {
    const user = userEvent.setup();
    const draft = announcementDraft();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ preview: rawPreview("preview_1", draft) }, 201));
    render(<OperationPreview suggestionId="suggestion_1" sourceDocument={{ id: "document_1", title: "Comunicado" }} drafts={[draft]} />);
    const options = await screen.findByRole("textbox", { name: "Opções da pergunta 1" });
    expect(options.tagName).toBe("TEXTAREA");
    await user.type(options, "\n");
    expect(options).toHaveValue("yes: Sim\nno: Não\n");
    expect(screen.getByRole("button", { name: "Confirmar e criar 1 registro" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Adicionar pergunta" }));
    expect(screen.getByRole("textbox", { name: "Pergunta 2" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Remover pergunta 2" }));
    expect(screen.queryByRole("textbox", { name: "Pergunta 2" })).not.toBeInTheDocument();
  });

  it("edits before an explicit final confirmation, blocks invalid/double submit, reuses its UUID, and links success", async () => {
    const user = userEvent.setup();
    const confirmBodies: unknown[] = [];
    const confirmationKeys: string[] = [];
    let confirmationAttempt = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/operation-preview")) return json({ preview: rawPreview("preview_1", taskDraft()) }, 201);
      confirmationAttempt += 1;
      confirmBodies.push(JSON.parse(String(init?.body)));
      confirmationKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      if (confirmationAttempt === 1) return json({ error: { code: "TEMPORARY", message: "Tente novamente" } }, 503);
      return json({ link: rawLink() }, 201);
    });
    const onNavigate = vi.fn();
    render(<OperationPreview
      suggestionId="suggestion_1"
      sourceDocument={{ id: "document_1", title: "Decisão estratégica" }}
      drafts={[taskDraft()]}
      onNavigate={onNavigate}
    />);

    const title = await screen.findByLabelText("Título");
    await user.clear(title);
    expect(screen.getByRole("button", { name: "Confirmar e criar 1 registro" })).toBeDisabled();
    await user.type(title, "Fechamento revisado");
    const confirm = screen.getByRole("button", { name: "Confirmar e criar 1 registro" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByRole("alert");
    expect(confirmBodies).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Tentar confirmação novamente" }));
    const linked = await screen.findByRole("region", { name: "Recurso criado" });
    expect(linked).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(linked).toHaveFocus());
    expect(within(linked).getByText("Fechamento revisado")).toBeInTheDocument();
    expect(within(linked).getByText(/Decisão estratégica/)).toBeInTheDocument();
    expect(confirmationKeys[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(confirmationKeys[1]).toBe(confirmationKeys[0]);
    expect(confirmBodies).toHaveLength(2);
    expect(confirmBodies[1]).toMatchObject({
      preview_id: "preview_1",
      draft: { payload: { title: "Fechamento revisado" } }
    });
    await user.click(within(linked).getByRole("button", { name: "Abrir tarefa" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ resourceType: "task", resourceId: "task_1" }));
  });
});

function taskDraft() {
  return {
    resource_type: "task" as const,
    payload: {
      title: "Revisar fechamento", area_id: null, assignee_profile_id: null, due_date: "2026-07-20",
      due_hint: "Até 17h", approval_mode: "direct" as const, evidence_policy: "optional" as const,
      checklist_items: ["Conferir saldo", "Registrar diferença"]
    }
  };
}

function routineDraft() {
  return {
    resource_type: "routine" as const,
    payload: {
      title: "Fechamento diário", area_id: "area_finance", frequency: "daily" as const, weekdays: [],
      due_hint: "Até 17h", assignee_profile_ids: ["owner_a"], execution_mode: "individual" as const,
      approval_mode: "direct" as const, evidence_policy: "comment_required" as const,
      task_templates: [{ title: "Revisar o cenário", process_id: null, assignee_profile_id: "owner_a",
        due_hint: null, approval_mode: "direct" as const, evidence_policy: "comment_required" as const }]
    }
  };
}

function announcementDraft() {
  return {
    resource_type: "announcement" as const,
    payload: {
      title: "Mudança de processo", body: "Leia com atenção.", type: "process_change" as const,
      requirement: "quiz_confirmation" as const, audience: { type: "all" as const },
      related_process_id: null, related_training_id: null,
      quiz_questions: [{ prompt: "Você entendeu?", options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Não" }],
        correct_option_id: "yes", explanation: null }]
    }
  };
}

function rawPreview(id: string, draft: ReturnType<typeof taskDraft> | ReturnType<typeof routineDraft> | ReturnType<typeof announcementDraft>) {
  return {
    id, source_suggestion_id: "suggestion_1", source_document_id: "document_1",
    resource_type: draft.resource_type, payload: draft, confirmed_payload: null, status: "preview",
    expires_at: "2026-07-15T12:00:00.000Z", idempotency_key: null, result_resource_id: null,
    created_at: "2026-07-14T12:00:00.000Z", updated_at: "2026-07-14T12:00:00.000Z", confirmed_at: null
  };
}

function rawLink() {
  return {
    id: "link_1", preview_id: "preview_1", source_suggestion_id: "suggestion_1",
    source_document_id: "document_1", source_structure_id: null, resource_type: "task", resource_id: "task_1",
    relation_type: "created", created_by_profile_id: "owner_a", created_at: "2026-07-14T12:00:00.000Z"
  };
}

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }));
}
