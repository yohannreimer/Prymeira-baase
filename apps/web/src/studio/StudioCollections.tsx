import { useEffect, useState } from "react";
import StudioLibrary from "./StudioLibrary";
import { createStudioCollection, deleteStudioCollection, listStudioCollections, renameStudioCollection } from "./studio-api";
import type { StudioCollection, StudioDocument } from "./studio.types";

export default function StudioCollections({ onOpenDocument }: { onOpenDocument(document: StudioDocument): void }) {
  const [collections, setCollections] = useState<StudioCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [status, setStatus] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listStudioCollections(fetch, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setCollections(items);
      setSelectedId((current) => current ?? items[0]?.id ?? null);
    }).catch(() => { if (!controller.signal.aborted) setStatus("Não foi possível carregar as coleções."); });
    return () => controller.abort();
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busyAction) return;
    setBusyAction("create");
    try {
      const created = await createStudioCollection(trimmed);
      setCollections((current) => [...current, created]);
      setSelectedId(created.id);
      setName("");
      setStatus("Coleção criada.");
    } catch {
      setStatus("Não foi possível criar a coleção.");
    } finally {
      setBusyAction(null);
    }
  }

  async function rename(collection: StudioCollection) {
    const trimmed = editingName.trim();
    if (!trimmed || busyAction) return;
    setBusyAction(`rename:${collection.id}`);
    try {
      const updated = await renameStudioCollection(collection.id, trimmed);
      setCollections((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingId(null);
      setStatus("Coleção renomeada.");
    } catch {
      setStatus("Não foi possível renomear a coleção.");
    } finally {
      setBusyAction(null);
    }
  }

  async function remove(collection: StudioCollection) {
    if (busyAction) return;
    setBusyAction(`delete:${collection.id}`);
    try {
      await deleteStudioCollection(collection.id);
      const next = collections.filter((item) => item.id !== collection.id);
      setCollections(next);
      setSelectedId((selected) => selected === collection.id ? next[0]?.id ?? null : selected);
      setStatus("Coleção excluída. Os documentos continuam preservados.");
    } catch {
      setStatus("Não foi possível excluir a coleção.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="studio-collections" aria-label="Gerenciar coleções">
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      <form className="studio-collections__create" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label htmlFor="studio-new-collection">Nova coleção</label>
        <input id="studio-new-collection" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Estratégia 2027" />
        <button type="submit" disabled={!name.trim() || busyAction !== null}>{busyAction === "create" ? "Criando…" : "Criar"}</button>
      </form>
      {collections.length ? (
        <div className="studio-collections__layout">
          <div className="studio-collections__list" role="list" aria-label="Coleções">
            {collections.map((collection) => (
              <div role="listitem" key={collection.id} className="studio-collections__item">
                {editingId === collection.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); void rename(collection); }}>
                    <input aria-label={`Nome de ${collection.name}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                    <button type="submit" disabled={busyAction !== null}>{busyAction === `rename:${collection.id}` ? "Salvando…" : "Salvar"}</button>
                    <button type="button" disabled={busyAction !== null} onClick={() => setEditingId(null)}>Cancelar</button>
                  </form>
                ) : (
                  <>
                    <button type="button" aria-pressed={selectedId === collection.id} disabled={busyAction !== null} onClick={() => setSelectedId(collection.id)}>{collection.name}</button>
                    <button type="button" disabled={busyAction !== null} aria-label={`Renomear ${collection.name}`} onClick={() => { setEditingId(collection.id); setEditingName(collection.name); }}><i aria-hidden="true" className="ph-light ph-pencil" /></button>
                    <button type="button" disabled={busyAction !== null} aria-label={`Excluir ${collection.name}`} onClick={() => void remove(collection)}><i aria-hidden="true" className="ph-light ph-trash" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
          {selectedId ? <StudioLibrary query={{ status: "active", collection_id: selectedId }} onOpenDocument={onOpenDocument} /> : null}
        </div>
      ) : <p className="studio-home__invitation">Crie uma coleção para reunir registros sem duplicá-los.</p>}
    </section>
  );
}
