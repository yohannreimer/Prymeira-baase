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

  it("keeps competing material actions disabled during a real recording and releases them after stop", async () => {
    const user = userEvent.setup();
    const trackStop = vi.fn();
    const recorder = installRecordingHarness(trackStop);
    const attachFile = vi.fn(async (
      _documentId: string,
      _file: Blob,
      _filename: string,
      _idempotencyKey: string
    ) => asset({ kind: "audio" }));
    try {
      renderComposer({ attachFile });

      const record = screen.getByRole("button", { name: "Gravar áudio" });
      expect(record).toHaveAttribute("aria-pressed", "false");
      expect(record).toHaveTextContent("Gravar áudio");
      await user.click(record);
      const stop = await screen.findByRole("button", { name: "Parar gravação" });
      expect(stop).toBeEnabled();
      expect(stop).toHaveAttribute("aria-pressed", "true");
      expect(stop).toHaveTextContent("Parar gravação");
      expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Adicionar imagem" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Capturar link" })).toBeDisabled();

      recorder.emit("dataavailable", new Blob(["audio"], { type: "audio/webm" }));
      await user.click(stop);

      await waitFor(() => expect(attachFile).toHaveBeenCalledOnce());
      expect(attachFile.mock.calls[0]?.[0]).toBe("document_1");
      expect(attachFile.mock.calls[0]?.[1]).toBeInstanceOf(Blob);
      expect(attachFile.mock.calls[0]?.[2]).toMatch(/\.webm$/u);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Adicionar imagem" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Capturar link" })).toBeEnabled();
      });
      expect(trackStop).toHaveBeenCalledOnce();
    } finally {
      restoreRecordingHarness();
    }
  });

  it("captures a public HTTP(S) link and reports the attached asset", async () => {
    const user = userEvent.setup();
    const attached = asset({ id: "asset_link", kind: "link_snapshot", displayName: "Referência" });
    const attachLink = vi.fn(async () => attached);
    const onAttached = vi.fn();
    renderComposer({ attachLink, onAttached });

    await user.click(screen.getByRole("button", { name: "Capturar link" }));
    expect(screen.getByRole("form", { name: "Captura de link" })).toHaveClass("studio-material-composer__link");
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "https://example.com/referencia");
    expect(screen.getByRole("textbox", { name: "Endereço do link" })).toHaveClass("studio-material-composer__link-input");
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));

    await waitFor(() => expect(attachLink).toHaveBeenCalledTimes(1));
    expect(attachLink).toHaveBeenCalledWith(
      "document_1",
      "https://example.com/referencia",
      expect.stringMatching(/^[0-9a-f-]{36}$/u)
    );
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("restores focus to the link trigger after a successful capture", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    renderComposer({ attachLink: vi.fn(() => request.promise) });

    const trigger = screen.getByRole("button", { name: "Capturar link" });
    await user.click(trigger);
    await user.type(
      screen.getByRole("textbox", { name: "Endereço do link" }),
      "https://example.com/referencia"
    );
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));
    await act(async () => request.resolve(asset({ kind: "link_snapshot" })));

    await waitFor(() => {
      expect(screen.queryByRole("form", { name: "Captura de link" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("shows exactly the four material actions under their accessible label", () => {
    renderComposer();

    const actions = screen.getByRole("group", { name: "Adicionar material" });
    const label = screen.getByText("Adicionar material");
    const composer = actions.closest(".studio-material-composer");
    expect(composer).not.toBeNull();
    expect(actions).toHaveClass("studio-material-composer__actions");
    expect(label).toHaveClass("studio-material-composer__label");
    expect(actions).toHaveAttribute("aria-labelledby", label.id);
    expect(label).toBeVisible();
    const actionButtons = within(actions).getAllByRole("button");
    expect(actionButtons.every((button) => button.classList.contains("studio-material-composer__action"))).toBe(true);
    expect(actionButtons.map((button) => button.textContent?.trim())).toEqual([
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
    expect(screen.getByRole("group", { name: "Recuperar material" })).toHaveClass("studio-material-composer__recovery");

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(attachFile).toHaveBeenCalledTimes(2));
    expect(attachFile.mock.calls[1]?.[1]).toBe(attachFile.mock.calls[0]?.[1]);
    expect(attachFile.mock.calls[1]?.[2]).toBe(attachFile.mock.calls[0]?.[2]);
    expect(attachFile.mock.calls[1]?.[3]).toBe(attachFile.mock.calls[0]?.[3]);
    expect(onAttached).toHaveBeenCalledTimes(1);
    expect(onAttached).toHaveBeenCalledWith(attached);
  });

  it("reports a server-owned upload to its original owner while isolating the next document session", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    const attachFile = vi.fn(() => request.promise);
    const onAttachedA = vi.fn();
    const onAttachedB = vi.fn();
    const view = render(
      <StudioMaterialComposer
        documentId="document_A"
        attachFile={attachFile}
        attachLink={vi.fn()}
        onAttached={onAttachedA}
      />
    );

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["A"], "a.txt", { type: "text/plain" })
    );
    expect(attachFile).toHaveBeenCalledWith(
      "document_A",
      expect.any(Blob),
      "a.txt",
      expect.any(String)
    );

    view.rerender(
      <StudioMaterialComposer
        documentId="document_B"
        attachFile={attachFile}
        attachLink={vi.fn()}
        onAttached={onAttachedB}
      />
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const nextDocumentFile = screen.getByRole("button", { name: "Adicionar arquivo" });
    expect(nextDocumentFile).toBeEnabled();
    nextDocumentFile.focus();
    expect(nextDocumentFile).toHaveFocus();

    await act(async () => request.resolve(asset({ documentId: "document_A" })));
    expect(onAttachedA).toHaveBeenCalledOnce();
    expect(onAttachedA).toHaveBeenCalledWith(expect.objectContaining({ documentId: "document_A" }));
    expect(onAttachedB).not.toHaveBeenCalled();
    expect(attachFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(nextDocumentFile).toBeEnabled();
    expect(nextDocumentFile).toHaveFocus();
  });

  it("drops a failed attempt when the open document changes instead of retrying it in the new document", async () => {
    const user = userEvent.setup();
    const attachFile = vi.fn().mockRejectedValue(new Error("offline"));
    const view = render(
      <StudioMaterialComposer
        documentId="document_A"
        attachFile={attachFile}
        attachLink={vi.fn()}
        onAttached={vi.fn()}
      />
    );

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["A"], "a.txt", { type: "text/plain" })
    );
    await screen.findByRole("button", { name: "Tentar novamente" });

    view.rerender(
      <StudioMaterialComposer
        documentId="document_B"
        attachFile={attachFile}
        attachLink={vi.fn()}
        onAttached={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toBeEnabled();
    expect(attachFile).toHaveBeenCalledTimes(1);
    expect(attachFile.mock.calls[0]?.[0]).toBe("document_A");
  });

  it("uses the latest callback when props update within the same document session", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    const attachFile = vi.fn(() => request.promise);
    const previousCallback = vi.fn();
    const latestCallback = vi.fn();
    const view = render(
      <StudioMaterialComposer
        documentId="document_A"
        attachFile={attachFile}
        attachLink={vi.fn()}
        onAttached={previousCallback}
      />
    );

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["A"], "a.txt", { type: "text/plain" })
    );
    view.rerender(
      <StudioMaterialComposer
        documentId="document_A"
        attachFile={attachFile}
        attachLink={vi.fn()}
        onAttached={latestCallback}
      />
    );
    await act(async () => request.resolve(asset({ documentId: "document_A" })));

    expect(previousCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
  });

  it("uses the latest attachment API when retrying within the same document session", async () => {
    const user = userEvent.setup();
    const initialAttach = vi.fn(async (
      _documentId: string,
      _file: Blob,
      _filename: string,
      _idempotencyKey: string
    ) => Promise.reject(new Error("offline")));
    const latestAttach = vi.fn(async (
      _documentId: string,
      _file: Blob,
      _filename: string,
      _idempotencyKey: string
    ) => asset({ documentId: "document_A" }));
    const onAttached = vi.fn();
    const view = render(
      <StudioMaterialComposer
        documentId="document_A"
        attachFile={initialAttach}
        attachLink={vi.fn()}
        onAttached={onAttached}
      />
    );

    const file = new File(["A"], "a.txt", { type: "text/plain" });
    await user.upload(screen.getByTestId("studio-material-file-input"), file);
    await screen.findByRole("button", { name: "Tentar novamente" });
    const firstKey = initialAttach.mock.calls[0]?.[3];

    view.rerender(
      <StudioMaterialComposer
        documentId="document_A"
        attachFile={latestAttach}
        attachLink={vi.fn()}
        onAttached={onAttached}
      />
    );
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(latestAttach).toHaveBeenCalledOnce());
    expect(initialAttach).toHaveBeenCalledOnce();
    expect(latestAttach).toHaveBeenCalledWith("document_A", file, "a.txt", firstKey);
    expect(onAttached).toHaveBeenCalledOnce();
  });

  it("terminates an old document recording and ignores its late recorder events", async () => {
    const user = userEvent.setup();
    const trackStop = vi.fn();
    const recorder = installRecordingHarness(trackStop);
    const attachFile = vi.fn();
    try {
      const view = render(
        <StudioMaterialComposer
          documentId="document_A"
          attachFile={attachFile}
          attachLink={vi.fn()}
          onAttached={vi.fn()}
        />
      );
      await user.click(screen.getByRole("button", { name: "Gravar áudio" }));
      await screen.findByRole("button", { name: "Parar gravação" });

      view.rerender(
        <StudioMaterialComposer
          documentId="document_B"
          attachFile={attachFile}
          attachLink={vi.fn()}
          onAttached={vi.fn()}
        />
      );
      expect(trackStop).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Gravar áudio" })).toBeEnabled();

      recorder.emit("dataavailable", new Blob(["late"], { type: "audio/webm" }));
      recorder.emit("stop");
      await Promise.resolve();
      expect(attachFile).not.toHaveBeenCalled();
    } finally {
      restoreRecordingHarness();
    }
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
    expect(screen.getByRole("group", { name: "Recuperar material" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descartar" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Título externo" })).toHaveValue("Rascunho preservado");
    expect(attachFile).toHaveBeenCalledTimes(1);
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("restores focus to link capture after discarding its failed material", async () => {
    const user = userEvent.setup();
    renderComposer({ attachLink: vi.fn().mockRejectedValue(new Error("offline")) });
    const trigger = screen.getByRole("button", { name: "Capturar link" });

    await user.click(trigger);
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Descartar" }));

    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    const attachFile = vi.fn(() => request.promise);
    render(
      <>
        <textarea aria-label="Documento aberto" />
        <StudioMaterialComposer
          documentId="document_1"
          attachFile={attachFile}
          attachLink={vi.fn()}
          onAttached={vi.fn()}
        />
      </>
    );

    await user.upload(
      screen.getByTestId("studio-material-file-input"),
      new File(["plano"], "plano.txt", { type: "text/plain" })
    );
    expect(attachFile).toHaveBeenCalledOnce();
    const editor = screen.getByRole("textbox", { name: "Documento aberto" });
    expect(editor).toBeEnabled();
    await user.type(editor, "Continuo escrevendo");
    expect(editor).toHaveValue("Continuo escrevendo");

    await act(async () => request.resolve(asset()));
    expect(editor).toHaveFocus();
  });

  it("keeps external editor focus when a file upload fails", async () => {
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
    await user.type(editor, "Ainda escrevendo");
    await act(async () => request.reject(new Error("offline")));

    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it("does not disable typing outside the composer while capturing a link", async () => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    const attachLink = vi.fn(() => request.promise);
    render(
      <>
        <textarea aria-label="Documento aberto" />
        <StudioMaterialComposer
          documentId="document_1"
          attachFile={vi.fn()}
          attachLink={attachLink}
          onAttached={vi.fn()}
        />
      </>
    );

    await user.click(screen.getByRole("button", { name: "Capturar link" }));
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));
    expect(attachLink).toHaveBeenCalledOnce();
    const editor = screen.getByRole("textbox", { name: "Documento aberto" });
    expect(editor).toBeEnabled();
    await user.type(editor, "Texto externo");
    expect(editor).toHaveValue("Texto externo");

    request.resolve(asset({ kind: "link_snapshot" }));
    await screen.findByText("Material adicionado.");
    expect(editor).toHaveFocus();
  });

  it("keeps external editor focus when link capture fails", async () => {
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
    await user.type(editor, "Continuo no editor");
    await act(async () => request.reject(new Error("offline")));

    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it.each([
    ["file", "studio-material-file-input", "Adicionar arquivo", "material.txt", "text/plain"],
    ["image", "studio-material-image-input", "Adicionar imagem", "quadro.png", "image/png"],
    ["audio", "studio-material-audio-input", "Gravar áudio", "reflexao.webm", "audio/webm"]
  ])("restores the %s origin after success when focus was lost", async (
    kind,
    inputTestId,
    triggerName,
    filename,
    mimeType
  ) => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    renderComposer({ attachFile: vi.fn(() => request.promise) });

    await user.upload(
      screen.getByTestId(inputTestId),
      new File([kind], filename, { type: mimeType })
    );
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();
    await act(async () => request.resolve(asset({ kind: kind as StudioAsset["kind"] })));

    expect(screen.getByRole("button", { name: triggerName })).toHaveFocus();
  });

  it.each([
    ["file", "studio-material-file-input", "material.txt", "text/plain"],
    ["image", "studio-material-image-input", "quadro.png", "image/png"],
    ["audio", "studio-material-audio-input", "reflexao.webm", "audio/webm"]
  ])("focuses recovery after a failed %s operation when focus was lost", async (
    _kind,
    inputTestId,
    filename,
    mimeType
  ) => {
    const user = userEvent.setup();
    const request = deferred<StudioAsset>();
    renderComposer({ attachFile: vi.fn(() => request.promise) });

    await user.upload(
      screen.getByTestId(inputTestId),
      new File(["material"], filename, { type: mimeType })
    );
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();
    await act(async () => request.reject(new Error("offline")));

    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toHaveFocus();
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

  it.each([
    ["canonicalized loopback", "http://127.1/admin"],
    ["integer loopback", "http://2130706433/admin"],
    ["hex loopback", "http://0x7f000001/admin"],
    ["private IPv4", "http://192.168.1.8/admin"],
    ["IPv6 loopback", "http://[::1]/admin"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/admin"],
    ["IPv6 unique local", "http://[fd00::1]/admin"],
    ["expanded IPv6 unique local", "http://[fd00:0000:0000:0000:0000:0000:0000:0001]/admin"],
    ["IPv6 link-local", "http://[fe80::1]/admin"],
    ["deprecated IPv6 site-local", "http://[fec0::1]/admin"],
    ["IPv6 documentation CIDR", "http://[2001:db8::1]/admin"],
    ["expanded IPv6 documentation CIDR", "http://[2001:0db8:0000:0000:0000:0000:0000:0001]/admin"],
    ["credentials", "https://user:secret@example.com/private"],
    ["single-label hostname", "http://intranet/private"],
    ["uppercase localhost", "http://LOCALHOST/admin"],
    ["uppercase local suffix", "http://SERVICE.INTERNAL/admin"],
    ["local suffix", "http://printer.local/admin"],
    ["one trailing dot", "https://example.com./private"],
    ["multiple trailing dots", "https://example.com../private"]
  ])("rejects %s before calling the link API", async (_label, unsafeUrl) => {
    const user = userEvent.setup();
    const attachLink = vi.fn();
    renderComposer({ attachLink });

    await user.click(screen.getByRole("button", { name: "Capturar link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Endereço do link" }), {
      target: { value: unsafeUrl }
    });
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("URL pública HTTP ou HTTPS");
    expect(attachLink).not.toHaveBeenCalled();
  });

  it.each([
    ["public IPv6 outside documentation CIDR", "https://[2001:db80::1]/resource"],
    ["fully expanded public IPv6", "https://[2606:2800:0220:0001:0248:1893:25c8:1946]/resource"],
    ["IPv4-mapped public address", "https://[::ffff:93.184.216.34]/resource"],
    ["uppercase public hostname", "HTTPS://EXAMPLE.COM/Resource"]
  ])("accepts %s", async (_label, publicUrl) => {
    const user = userEvent.setup();
    const attachLink = vi.fn(async () => asset({ kind: "link_snapshot" }));
    renderComposer({ attachLink });

    await user.click(screen.getByRole("button", { name: "Capturar link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Endereço do link" }), {
      target: { value: publicUrl }
    });
    await user.click(screen.getByRole("button", { name: "Capturar este link" }));

    await waitFor(() => expect(attachLink).toHaveBeenCalledOnce());
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
    const status = screen.getByRole("status");
    const actionGroup = screen.getByRole("group", { name: "Adicionar material" });
    expect(status).toHaveTextContent("Adicionando material");
    expect(status).toHaveClass("studio-material-composer__status");
    expect(actionGroup).toHaveAttribute("aria-busy", "true");
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    await act(async () => request.reject(new Error("offline")));

    expect(await screen.findByRole("alert")).toHaveTextContent("não foi adicionado");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeEnabled();
  });

  it("delivers a server-owned attachment after unmount without updating the local session", async () => {
    const request = deferred<StudioAsset>();
    const attachFile = vi.fn(() => request.promise);
    const onAttached = vi.fn();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const view = renderComposer({ attachFile, onAttached });

    fireEvent.change(screen.getByTestId("studio-material-file-input"), {
      target: { files: [new File(["plano"], "plano.txt", { type: "text/plain" })] }
    });
    expect(attachFile).toHaveBeenCalledOnce();
    focus.mockClear();
    view.unmount();
    await act(async () => request.resolve(asset()));

    expect(onAttached).toHaveBeenCalledOnce();
    expect(onAttached).toHaveBeenCalledWith(expect.objectContaining({ documentId: "document_1" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
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

let originalMediaDevices: PropertyDescriptor | undefined;
let originalMediaRecorder: PropertyDescriptor | undefined;

function installRecordingHarness(trackStop: ReturnType<typeof vi.fn>) {
  originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  originalMediaRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  let currentRecorder: TestMediaRecorder | null = null;
  const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) }
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: class extends TestMediaRecorder {
      constructor(input: MediaStream) {
        super(input);
        currentRecorder = this;
      }
    }
  });
  return {
    emit(type: "dataavailable" | "stop", data = new Blob()) {
      if (!currentRecorder) throw new Error("Recorder not started");
      currentRecorder.emit(type, data);
    }
  };
}

function restoreRecordingHarness() {
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  if (originalMediaRecorder) {
    Object.defineProperty(globalThis, "MediaRecorder", originalMediaRecorder);
  } else {
    Reflect.deleteProperty(globalThis, "MediaRecorder");
  }
  originalMediaDevices = undefined;
  originalMediaRecorder = undefined;
}

class TestMediaRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  private listeners = new Map<string, Array<(event: { data: Blob }) => void>>();

  constructor(_stream: MediaStream) {}

  addEventListener(type: string, listener: (event: { data: Blob }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.emit("stop");
  }

  emit(type: string, data = new Blob()) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}
