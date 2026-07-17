import { useEffect, useState } from "react";
import { listSharedStudioDocuments } from "./studio-api";
import type { StudioSharedDocument } from "./studio.types";

export default function StudioSharedLibrary({ onOpen }: { onOpen(item: StudioSharedDocument): void }) {
  const [items, setItems] = useState<StudioSharedDocument[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void listSharedStudioDocuments(fetch, controller.signal).then((next) => { if (!controller.signal.aborted) { setItems(next); setState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, []);
  if (state === "loading") return <p role="status">Carregando folhas compartilhadas…</p>;
  if (state === "error") return <p role="alert">Não foi possível carregar as folhas compartilhadas.</p>;
  if (!items.length) return <div className="studio-library__empty"><i className="ph-light ph-users" aria-hidden="true" /><p>Nenhuma folha foi compartilhada com você.</p></div>;
  return <div className="studio-library__list" role="list">{items.map((item) => <article className="studio-shared-row" role="listitem" key={`${item.author.profileId}:${item.document.id}`}>
    <button type="button" onClick={() => onOpen(item)}><strong>{item.document.title || "Sem título"}</strong><span>Por {item.author.name}</span><p>{item.document.bodyText || "Folha sem texto."}</p></button>
  </article>)}</div>;
}

