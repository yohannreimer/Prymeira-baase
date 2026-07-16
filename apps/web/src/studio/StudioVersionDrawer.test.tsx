import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { StudioDocumentVersion } from "./studio.types";
import StudioVersionDrawer from "./StudioVersionDrawer";

afterEach(() => {
  vi.restoreAllMocks();
  window.document.body.style.overflow = "";
});

it("loads a bounded version drawer, groups legacy history, and paginates older checkpoints", async () => {
  const user = userEvent.setup();
  const firstPage = [
    version(14, false, "manual", "Direção atual"),
    ...Array.from({ length: 9 }, (_, index) => version(13 - index, false, "significant_pause", `Pausa ${index + 1}`))
  ];
  const duplicate = firstPage.at(-1)!;
  const legacy = version(2, true, "legacy_autosave", "Registro legado");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/versions?limit=10")) {
      return response({ versions: firstPage.map(rawVersion), nextCursor: "cursor_2" });
    }
    if (url.endsWith("/versions?limit=10&cursor=cursor_2")) {
      return response({ versions: [rawVersion(duplicate), rawVersion(legacy)], nextCursor: null });
    }
    return response({}, 404);
  });

  render(
    <StudioVersionDrawer
      documentId="doc_1"
      open
      onClose={vi.fn()}
      onRestore={vi.fn()}
    />
  );

  const drawer = await screen.findByRole("dialog", { name: "Histórico de versões" });
  expect(drawer).toHaveAttribute("aria-modal", "true");
  expect(within(drawer).getByRole("heading", { name: "Histórico de versões" })).toHaveFocus();
  expect(within(drawer).getByText("Versão atual")).toBeVisible();
  expect(within(drawer).queryByText("Histórico anterior")).not.toBeInTheDocument();
  expect(within(drawer).queryByText("Registro legado")).not.toBeInTheDocument();

  await user.click(within(drawer).getByRole("button", { name: "Carregar versões anteriores" }));
  expect(await within(drawer).findByText("Histórico anterior")).toHaveAttribute("aria-expanded", "false");
  expect(fetchSpy).toHaveBeenNthCalledWith(2,
    "/api/studio/documents/doc_1/versions?limit=10&cursor=cursor_2",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(within(drawer).getAllByRole("button", { name: new RegExp(`Versão ${duplicate.versionNumber}`, "u") })).toHaveLength(1);
  await user.click(within(drawer).getByText("Histórico anterior"));
  expect(within(drawer).getByText("Registro legado")).toBeVisible();
  expect(within(drawer).queryByRole("button", { name: "Carregar versões anteriores" })).not.toBeInTheDocument();
});

it("aborts an obsolete page and ignores its late response after the document changes", async () => {
  const oldPage = deferred<Response>();
  const oldSignal = { current: null as AbortSignal | null };
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes("/documents/doc_1/versions")) {
      oldSignal.current = init?.signal as AbortSignal;
      return oldPage.promise;
    }
    if (url.includes("/documents/doc_2/versions")) {
      return Promise.resolve(response({ versions: [rawVersion({ ...version(1, false, "manual", "Documento novo"), documentId: "doc_2" })], nextCursor: null }));
    }
    return Promise.resolve(response({}, 404));
  });

  const { rerender } = render(
    <StudioVersionDrawer documentId="doc_1" open onClose={vi.fn()} onRestore={vi.fn()} />
  );
  await waitFor(() => expect(oldSignal.current).not.toBeNull());
  rerender(<StudioVersionDrawer documentId="doc_2" open onClose={vi.fn()} onRestore={vi.fn()} />);

  expect(oldSignal.current?.aborted).toBe(true);
  expect(await screen.findByRole("button", { name: /Versão 1, atual: Documento novo/u })).toBeVisible();
  await act(async () => oldPage.resolve(response({ versions: [rawVersion(version(9, false, "manual", "Resposta obsoleta"))], nextCursor: null })));
  expect(screen.queryByText("Resposta obsoleta")).not.toBeInTheDocument();
});

it("contains focus, closes from Escape and the backdrop, and restores through confirmation", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onRestore = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ versions: [rawVersion(version(3, false, "manual", "Marco"))] }));
  vi.spyOn(window, "confirm").mockReturnValue(true);

  const { rerender } = render(
    <StudioVersionDrawer documentId="doc_1" open onClose={onClose} onRestore={onRestore} />
  );
  const drawer = await screen.findByRole("dialog", { name: "Histórico de versões" });
  await user.click(within(drawer).getByRole("button", { name: /Versão 3/u }));
  await user.click(within(drawer).getByRole("button", { name: "Restaurar como nova versão" }));
  expect(window.confirm).toHaveBeenCalled();
  expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 3 }));

  rerender(<StudioVersionDrawer documentId="doc_1" open onClose={onClose} onRestore={onRestore} />);
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();

  await user.click(screen.getByTestId("studio-version-backdrop"));
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(window.document.body.style.overflow).toBe("hidden");
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Histórico de versões" })).toBeInTheDocument());
});

it("wraps keyboard focus from the initial heading and the final drawer control", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ versions: [rawVersion(version(3, false, "manual", "Marco"))] }));
  render(<>
    <button type="button">Fora do modal</button>
    <StudioVersionDrawer documentId="doc_1" open onClose={vi.fn()} onRestore={vi.fn()} />
  </>);

  const drawer = await screen.findByRole("dialog", { name: "Histórico de versões" });
  const heading = within(drawer).getByRole("heading", { name: "Histórico de versões" });
  const close = within(drawer).getByRole("button", { name: "Fechar histórico" });
  const restore = within(drawer).getByRole("button", { name: "Restaurar como nova versão" });
  expect(heading).toHaveFocus();

  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(restore).toHaveFocus();

  await user.keyboard("{Tab}");
  expect(close).toHaveFocus();

  screen.getByRole("button", { name: "Fora do modal" }).focus();
  expect(heading).toHaveFocus();
});

function version(
  versionNumber: number,
  isLegacy: boolean,
  checkpointReason: StudioDocumentVersion["checkpointReason"],
  title: string
): StudioDocumentVersion {
  return {
    id: `version_${versionNumber}`,
    workspaceId: "workspace_a",
    ownerProfileId: "profile_owner",
    documentId: "doc_1",
    versionNumber,
    bodyJson: { type: "doc" },
    bodyText: title,
    origin: "user",
    actorProfileId: "profile_owner",
    aiRunId: null,
    createdAt: `2026-07-${String(Math.max(1, versionNumber)).padStart(2, "0")}T10:00:00.000Z`,
    title,
    checkpointReason,
    sourceRevision: versionNumber,
    isLegacy
  };
}

function rawVersion(item: StudioDocumentVersion) {
  return {
    id: item.id,
    workspace_id: item.workspaceId,
    owner_profile_id: item.ownerProfileId,
    document_id: item.documentId,
    version_number: item.versionNumber,
    body_json: item.bodyJson,
    body_text: item.bodyText,
    origin: item.origin,
    actor_profile_id: item.actorProfileId,
    ai_run_id: item.aiRunId,
    created_at: item.createdAt,
    title: item.title,
    checkpoint_reason: item.checkpointReason,
    source_revision: item.sourceRevision,
    is_legacy: item.isLegacy
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}
