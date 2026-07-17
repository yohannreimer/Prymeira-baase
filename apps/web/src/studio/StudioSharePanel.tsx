import { useEffect, useState } from "react";
import { createBaaseHeaders, withConfiguredAuth, type ApiPerson } from "../api";
import {
  addStudioComment, getStudioShares, importSharedStudioDocument, listStudioComments, replaceStudioShares
} from "./studio-api";
import type { StudioComment, StudioDocument, StudioShareAudience } from "./studio.types";

export default function StudioSharePanel({ document, access, onClose, onImported }: {
  document: StudioDocument;
  access: "owned" | "shared_read_comment";
  onClose(): void;
  onImported?(document: StudioDocument): void;
}) {
  const [owners, setOwners] = useState<ApiPerson[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [allOwners, setAllOwners] = useState(false);
  const [comments, setComments] = useState<StudioComment[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      listStudioComments(document.id),
      access === "owned" ? getStudioShares(document.id) : Promise.resolve([]),
      access === "owned" ? loadOwners() : Promise.resolve([])
    ]).then(([nextComments, shares, nextOwners]) => {
      if (!active) return;
      setComments(nextComments);
      setOwners(nextOwners);
      setAllOwners(shares.some((share) => share.audience.type === "all_owners"));
      setSelected(shares.flatMap((share) => share.audience.type === "owner" ? [share.audience.profileId] : []));
    }).catch(() => { if (active) setMessage("Não foi possível carregar o compartilhamento agora."); });
    return () => { active = false; };
  }, [access, document.id]);

  async function saveShares() {
    setBusy(true);
    setMessage("");
    try {
      const audiences: StudioShareAudience[] = allOwners
        ? [{ type: "all_owners" }]
        : selected.map((profileId) => ({ type: "owner" as const, profileId }));
      await replaceStudioShares(document.id, audiences);
      setMessage("Acesso atualizado.");
    } catch { setMessage("Não foi possível atualizar o acesso."); } finally { setBusy(false); }
  }

  async function comment() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const created = await addStudioComment(document.id, body);
      setComments((current) => [...current, created]);
      setBody("");
    } catch { setMessage("Não foi possível enviar o comentário."); } finally { setBusy(false); }
  }

  async function importCopy() {
    setBusy(true);
    try { onImported?.(await importSharedStudioDocument(document.id)); }
    catch { setMessage("Não foi possível importar esta folha."); }
    finally { setBusy(false); }
  }

  return (
    <div className="studio-share-panel" role="dialog" aria-modal="true" aria-label="Compartilhar folha">
      <header><div><span className="mono">Compartilhamento</span><h3>{document.title || "Sem título"}</h3></div>
        <button type="button" aria-label="Fechar compartilhamento" onClick={onClose}><i className="ph-light ph-x" aria-hidden="true" /></button></header>
      {access === "owned" ? <section>
        <h4>Quem pode acompanhar</h4>
        <label className="studio-share-panel__choice"><input type="checkbox" checked={allOwners} onChange={(event) => setAllOwners(event.currentTarget.checked)} /> Todos os donos atuais e futuros</label>
        {!allOwners ? <div className="studio-share-panel__owners">{owners.filter((owner) => owner.role === "owner").map((owner) => (
          <label key={owner.id}><input type="checkbox" checked={selected.includes(owner.id)} onChange={(event) => setSelected((current) => event.currentTarget.checked ? [...new Set([...current, owner.id])] : current.filter((id) => id !== owner.id))} />{owner.name}</label>
        ))}</div> : null}
        <button className="studio-share-panel__primary" type="button" disabled={busy} onClick={() => void saveShares()}>Salvar acesso</button>
      </section> : <section className="studio-share-panel__import"><p>Esta folha foi compartilhada para leitura e comentários.</p>
        <button className="studio-share-panel__primary" type="button" disabled={busy} onClick={() => void importCopy()}>Importar para meu Estúdio</button></section>}
      <section><h4>Comentários</h4>
        <div className="studio-share-panel__comments">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p></article>) : <p className="studio-share-panel__empty">Nenhum comentário ainda.</p>}</div>
        <label><span className="sr-only">Novo comentário</span><textarea value={body} onChange={(event) => setBody(event.currentTarget.value)} placeholder="Escreva um comentário geral…" /></label>
        <button type="button" disabled={busy || !body.trim()} onClick={() => void comment()}>Comentar</button>
      </section>
      {message ? <p role="status" className="studio-share-panel__message">{message}</p> : null}
    </div>
  );
}

async function loadOwners(): Promise<ApiPerson[]> {
  const response = await fetch("/api/people", await withConfiguredAuth({ headers: createBaaseHeaders("dono") }));
  if (!response.ok) throw new Error("PEOPLE_UNAVAILABLE");
  const payload = await response.json() as { people?: ApiPerson[] };
  return payload.people ?? [];
}

