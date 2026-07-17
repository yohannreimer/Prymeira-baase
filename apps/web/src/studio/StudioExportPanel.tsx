import { useState } from "react";
import { createPublication, createPublicationExternalLink, downloadPublication, type Publication } from "./publication-api";

export default function StudioExportPanel({ documentId, title, onClose }: { documentId: string; title: string; onClose(): void }) {
  const [format, setFormat] = useState<"pdf" | "zip">("pdf");
  const [publication, setPublication] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [externalUrl, setExternalUrl] = useState("");

  async function generate() {
    setBusy(true); setMessage(""); setExternalUrl("");
    try { setPublication(await createPublication("studio_document", documentId, format)); }
    catch { setMessage("Não foi possível preparar o arquivo agora."); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!publication) return;
    setBusy(true);
    try { globalThis.location.assign(await downloadPublication(publication.id)); }
    catch { setMessage("Não foi possível abrir o download."); }
    finally { setBusy(false); }
  }
  async function external() {
    if (!publication) return;
    setBusy(true);
    try {
      const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const link = await createPublicationExternalLink(publication.id, expiry);
      setExternalUrl(link.url);
    } catch { setMessage("Não foi possível criar o link externo."); }
    finally { setBusy(false); }
  }
  async function copy() {
    await globalThis.navigator.clipboard.writeText(externalUrl);
    setMessage("Link copiado. Ele expira em 7 dias.");
  }

  return <div className="studio-export-panel" role="dialog" aria-modal="true" aria-label="Exportar folha">
    <header><div><span className="mono">Publicação</span><h3>{title}</h3></div><button type="button" aria-label="Fechar exportação" onClick={onClose}><i className="ph-light ph-x" /></button></header>
    <section><h4>Como deseja levar esta folha?</h4>
      <label><input type="radio" name="studio-export-format" checked={format === "pdf"} onChange={() => setFormat("pdf")} />
        <span><strong>PDF editorial</strong><small>Uma leitura limpa, pronta para imprimir ou enviar.</small></span></label>
      <label><input type="radio" name="studio-export-format" checked={format === "zip"} onChange={() => setFormat("zip")} />
        <span><strong>Pacote completo</strong><small>PDF, arquivos originais e índice dos links.</small></span></label>
      {!publication || publication.format !== format ? <button className="studio-export-panel__primary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? "Preparando…" : "Preparar arquivo"}</button> : <div className="studio-export-panel__ready">
        <p><i className="ph-light ph-check-circle" /> Arquivo pronto</p>
        <button className="studio-export-panel__primary" type="button" disabled={busy} onClick={() => void download()}>Baixar {format.toUpperCase()}</button>
        <button type="button" disabled={busy} onClick={() => void external()}>Criar link por 7 dias</button>
      </div>}
      {externalUrl ? <div className="studio-export-panel__link"><input aria-label="Link externo" readOnly value={externalUrl} /><button type="button" onClick={() => void copy()}>Copiar</button></div> : null}
      {message ? <p role="status" className="studio-export-panel__message">{message}</p> : null}
    </section>
  </div>;
}
