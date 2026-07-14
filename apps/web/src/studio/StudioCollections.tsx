import { useEffect, useState } from "react";
import StudioLibrary from "./StudioLibrary";
import type { StudioCollection, StudioDocument } from "./studio.types";
import type { StudioCollectionsStore } from "./useStudioCollections";

export default function StudioCollections({
  onOpenDocument,
  store
}: {
  onOpenDocument(document: StudioDocument): void;
  store: StudioCollectionsStore;
}) {
  const { collections } = store;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [status, setStatus] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId((current) => current && collections.some((item) => item.id === current)
      ? current
      : collections[0]?.id ?? null);
  }, [collections]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busyAction) return;
    setBusyAction("create");
    try {
      const created = await store.create(trimmed);
      if (!created) {
        setStatus("Não foi possível criar a coleção.");
        return;
      }
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
      const updated = await store.rename(collection, trimmed);
      if (!updated) {
        setStatus("Não foi possível renomear a coleção.");
        return;
      }
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
      const wasSelected = selectedId === collection.id;
      const removed = await store.remove(collection);
      if (!removed) {
        if (wasSelected) setSelectedId(collection.id);
        setStatus("Não foi possível excluir a coleção.");
        return;
      }
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
        <button type="submit" disabled={store.loading || !name.trim() || busyAction !== null}>{busyAction === "create" ? "Criando…" : "Criar"}</button>
      </form>
      {store.loading ? <p className="studio-library-opening" role="status">Carregando coleções…</p> : collections.length ? (
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
          {selectedId ? <StudioLibrary collections={collections} query={{ status: "active", collection_id: selectedId }} onOpenDocument={onOpenDocument} /> : null}
        </div>
      ) : <p className="studio-home__invitation">{store.loadError ? "Não foi possível carregar as coleções." : "Crie uma coleção para reunir registros sem duplicá-los."}</p>}
    </section>
  );
}
