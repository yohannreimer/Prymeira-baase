import { useEffect, useState } from "react";
import { dismissStudioImportUpdate, getStudioImportUpdate, importSharedStudioDocument, StudioApiError } from "./studio-api";
import type { StudioDocument, StudioImportUpdate } from "./studio.types";

export default function StudioImportNotice({ documentId, onImported }: { documentId: string; onImported(document: StudioDocument): void }) {
  const [update, setUpdate] = useState<StudioImportUpdate | null>(null);
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    let active = true;
    void getStudioImportUpdate(documentId).then((value) => { if (active) setUpdate(value); })
      .catch((error) => { if (!(error instanceof StudioApiError) || error.status !== 404) return; });
    return () => { active = false; };
  }, [documentId]);
  if (!update || update.status === "current" || update.status === "dismissed") return null;
  if (update.status === "unavailable") return <div className="studio-import-notice" role="status"><strong>Origem indisponível</strong><p>Sua cópia continua privada e intacta.</p></div>;
  return <div className="studio-import-notice" role="status"><div><strong>A folha original foi atualizada</strong><p>Você decide se quer trazer a nova versão como outra folha independente.</p></div>
    <div className="studio-import-notice__actions"><button type="button" onClick={() => setCompare((value) => !value)}>Ver alterações</button>
      <button type="button" onClick={() => void importSharedStudioDocument(update.source.documentId).then(onImported)}>Importar nova cópia</button>
      <button type="button" onClick={() => void dismissStudioImportUpdate(documentId).then(setUpdate)}>Dispensar</button></div>
    {compare && update.sourceDocument ? <div className="studio-import-notice__comparison"><strong>{update.sourceDocument.title || "Sem título"}</strong><p>{update.sourceDocument.bodyText || "Sem texto."}</p></div> : null}
  </div>;
}

