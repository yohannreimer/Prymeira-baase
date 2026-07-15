import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioMaterialComposer from "./StudioMaterialComposer";
import type { StudioAsset } from "./studio.types";

describe("StudioMaterialComposer", () => {
  it("attaches a selected file with a stable operation identity", async () => {
    const user = userEvent.setup();
    const attached = asset({ id: "asset_file", kind: "file", displayName: "plano.txt" });
    const attachFile = vi.fn(async () => attached);
    const onAttached = vi.fn();
    renderComposer({ attachFile, onAttached });

    const file = new File(["plano"], "plano.txt", { type: "text/plain" });
    await user.upload(screen.getByTestId("studio-material-file-input"), file);

    await waitFor(() => expect(attachFile).toHaveBeenCalledTimes(1));
    expect(attachFile).toHaveBeenCalledWith(
      "document_1",
      file,
      "plano.txt",
      expect.stringMatching(/^[0-9a-f-]{36}$/u)
    );
    expect(onAttached).toHaveBeenCalledOnce();
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("attaches an image from a dedicated image picker", async () => {
    const user = userEvent.setup();
    const attached = asset({ id: "asset_image", kind: "image", displayName: "quadro.png" });
    const attachFile = vi.fn(async () => attached);
    const onAttached = vi.fn();
    renderComposer({ attachFile, onAttached });

    const input = screen.getByTestId("studio-material-image-input");
    expect(input).toHaveAttribute("accept", "image/*");
    const image = new File(["image"], "quadro.png", { type: "image/png" });
    await user.upload(input, image);

    await waitFor(() => expect(attachFile).toHaveBeenCalledTimes(1));
    expect(attachFile).toHaveBeenCalledWith(
      "document_1",
      image,
      "quadro.png",
      expect.stringMatching(/^[0-9a-f-]{36}$/u)
    );
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("uses the shared labelled recorder and attaches its captured audio as a file", async () => {
    const user = userEvent.setup();
    const attached = asset({ id: "asset_audio", kind: "audio", displayName: "reflexao.webm" });
    const attachFile = vi.fn(async () => attached);
    const onAttached = vi.fn();
    renderComposer({ attachFile, onAttached });

    expect(screen.getByRole("button", { name: "Gravar áudio" })).toHaveTextContent("Gravar áudio");
    const audio = new File(["audio"], "reflexao.webm", { type: "audio/webm" });
    await user.upload(screen.getByTestId("studio-material-audio-input"), audio);

    await waitFor(() => expect(attachFile).toHaveBeenCalledTimes(1));
    expect(attachFile).toHaveBeenCalledWith(
      "document_1",
      audio,
      "reflexao.webm",
      expect.stringMatching(/^[0-9a-f-]{36}$/u)
    );
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("captures a public HTTP(S) link and reports the attached asset", async () => {
    const user = userEvent.setup();
    const attached = asset({ id: "asset_link", kind: "link_snapshot", displayName: "Referência" });
    const attachLink = vi.fn(async () => attached);
    const onAttached = vi.fn();
    renderComposer({ attachLink, onAttached });

    await user.click(screen.getByRole("button", { name: "Capturar link" }));
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "https://example.com/referencia");
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));

    await waitFor(() => expect(attachLink).toHaveBeenCalledTimes(1));
    expect(attachLink).toHaveBeenCalledWith(
      "document_1",
      "https://example.com/referencia",
      expect.stringMatching(/^[0-9a-f-]{36}$/u)
    );
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("shows exactly the four material actions under their accessible label", () => {
    renderComposer();

    const actions = screen.getByRole("group", { name: "Adicionar material" });
    expect(within(actions).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([
      "Gravar áudio",
      "Adicionar arquivo",
      "Adicionar imagem",
      "Capturar link"
    ]);
  });

  it("retries the exact failed material and idempotency key, then attaches once", async () => {
    const user = userEvent.setup();
    const attached = asset({ id: "asset_retry", kind: "file", displayName: "plano.txt" });
    const attachFile = vi.fn()
      .mockRejectedValueOnce(new Error("upload unavailable"))
      .mockResolvedValueOnce(attached);
    const onAttached = vi.fn();
    renderComposer({ attachFile, onAttached });

    const file = new File(["plano"], "plano.txt", { type: "text/plain" });
    await user.upload(screen.getByTestId("studio-material-file-input"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("não foi adicionado");

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(attachFile).toHaveBeenCalledTimes(2));
    expect(attachFile.mock.calls[1]?.[1]).toBe(attachFile.mock.calls[0]?.[1]);
    expect(attachFile.mock.calls[1]?.[2]).toBe(attachFile.mock.calls[0]?.[2]);
    expect(attachFile.mock.calls[1]?.[3]).toBe(attachFile.mock.calls[0]?.[3]);
    expect(onAttached).toHaveBeenCalledTimes(1);
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("discards only the failed local material and its status", async () => {
    const user = userEvent.setup();
    const attachFile = vi.fn().mockRejectedValue(new Error("upload unavailable"));
    const onAttached = vi.fn();
    render(
      <>
        <input aria-label="Título externo" defaultValue="Rascunho preservado" />
        <StudioMaterialComposer
          documentId="document_1"
          attachFile={attachFile}
          attachLink={vi.fn()}
          onAttached={onAttached}
        />
      </>
    );

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["plano"], "plano.txt", { type: "text/plain" })
    );
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Descartar" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Título externo" })).toHaveValue("Rascunho preservado");
    expect(attachFile).toHaveBeenCalledTimes(1);
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("starts only one request when activated twice while busy", async () => {
    const attached = asset({ id: "asset_once", kind: "file" });
    const request = deferred<StudioAsset>();
    const attachFile = vi.fn(() => request.promise);
    const onAttached = vi.fn();
    renderComposer({ attachFile, onAttached });
    const input = screen.getByTestId("studio-material-file-input");
    const file = new File(["plano"], "plano.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });

    expect(attachFile).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(attached));
    expect(onAttached).toHaveBeenCalledOnce();
  });

  it("does not disable typing outside the composer during an upload", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    render(
      <>
        <textarea aria-label="Documento aberto" />
        <StudioMaterialComposer
          documentId="document_1"
          attachFile={vi.fn(() => request.promise)}
          attachLink={vi.fn()}
          onAttached={vi.fn()}
        />
      </>
    );

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["plano"], "plano.txt", { type: "text/plain" })
    );
    const editor = screen.getByRole("textbox", { name: "Documento aberto" });
    expect(editor).toBeEnabled();
    await user.type(editor, "Continuo escrevendo");
    expect(editor).toHaveValue("Continuo escrevendo");

    await act(async () => request.resolve(asset()));
  });

  it("does not disable typing outside the composer while capturing a link", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    render(
      <>
        <textarea aria-label="Documento aberto" />
        <StudioMaterialComposer
          documentId="document_1"
          attachFile={vi.fn()}
          attachLink={vi.fn(() => request.promise)}
          onAttached={vi.fn()}
        />
      </>
    );

    await user.click(screen.getByRole("button", { name: "Capturar link" }));
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));
    const editor = screen.getByRole("textbox", { name: "Documento aberto" });
    expect(editor).toBeEnabled();
    await user.type(editor, "Texto externo");
    expect(editor).toHaveValue("Texto externo");

    await act(async () => request.resolve(asset({ kind: "link_snapshot" })));
  });

  it("validates public HTTP(S) links and restores focus when link mode closes", async () => {
    const user = userEvent.setup();
    const attachLink = vi.fn();
    renderComposer({ attachLink });
    const trigger = screen.getByRole("button", { name: "Capturar link" });

    await user.click(trigger);
    const linkInput = screen.getByRole("textbox", { name: "Endereço do link" });
    expect(linkInput).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Fechar captura de link" }));
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "http://localhost/admin");
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("URL pública HTTP ou HTTPS");
    expect(attachLink).not.toHaveBeenCalled();
  });

  it("exposes progress, failures, and recovery controls accessibly", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    const attachFile = vi.fn(() => request.promise);
    renderComposer({ attachFile });

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["plano"], "plano.txt", { type: "text/plain" })
    );
    expect(screen.getByRole("status")).toHaveTextContent("Adicionando material");
    await act(async () => request.reject(new Error("offline")));

    expect(await screen.findByRole("alert")).toHaveTextContent("não foi adicionado");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeEnabled();
  });

  it("lets a server-owned request finish after unmount without firing local callbacks", async () => {
    const request = deferred<StudioAsset>();
    const attachFile = vi.fn(() => request.promise);
    const onAttached = vi.fn();
    const view = renderComposer({ attachFile, onAttached });

    fireEvent.change(screen.getByTestId("studio-material-file-input"), {
      target: { files: [new File(["plano"], "plano.txt", { type: "text/plain" })] }
    });
    expect(attachFile).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => request.resolve(asset()));

    expect(onAttached).not.toHaveBeenCalled();
  });
});

type ComposerOverrides = {
  attachFile?: (...args: Parameters<NonNullable<React.ComponentProps<typeof StudioMaterialComposer>["attachFile"]>>) => Promise<StudioAsset>;
  attachLink?: (...args: Parameters<NonNullable<React.ComponentProps<typeof StudioMaterialComposer>["attachLink"]>>) => Promise<StudioAsset>;
  onAttached?: (asset: StudioAsset) => void;
};

function renderComposer(overrides: ComposerOverrides = {}) {
  return render(
    <StudioMaterialComposer
      documentId="document_1"
      attachFile={overrides.attachFile ?? vi.fn()}
      attachLink={overrides.attachLink ?? vi.fn()}
      onAttached={overrides.onAttached ?? vi.fn()}
    />
  );
}

function asset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset_1",
    workspaceId: "workspace_1",
    ownerProfileId: "owner_1",
    documentId: "document_1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    kind: "file",
    displayName: "material.txt",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "text/plain",
    sizeBytes: 8,
    extractionStatus: "pending",
    extractedText: null,
    lastErrorCode: null,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
