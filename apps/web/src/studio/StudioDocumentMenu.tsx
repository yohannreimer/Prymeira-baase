import { useEffect, useRef, useState } from "react";
import StudioSharePanel from "./StudioSharePanel";
import type { StudioDocument } from "./studio.types";

export default function StudioDocumentMenu({ document, access, onImported, onExport }: {
  document: StudioDocument;
  access: "owned" | "shared_read_comment";
  onImported?(document: StudioDocument): void;
  onExport?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    documentGlobal().addEventListener("mousedown", close);
    return () => documentGlobal().removeEventListener("mousedown", close);
  }, [open]);
  return <>
    <div className="studio-document-menu" ref={root}>
      <button type="button" aria-label="Mais opções da folha" aria-expanded={open} onClick={() => setOpen((value) => !value)}><i className="ph-light ph-dots-three" aria-hidden="true" /></button>
      {open ? <div className="studio-document-menu__popover" role="menu">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); setSharing(true); }}><i className="ph-light ph-users" aria-hidden="true" />{access === "owned" ? "Compartilhar" : "Comentários e importação"}</button>
        {access === "owned" ? <button type="button" role="menuitem" onClick={() => { setOpen(false); onExport?.(); }}><i className="ph-light ph-export" aria-hidden="true" />Exportar</button> : null}
      </div> : null}
    </div>
    {sharing ? <StudioSharePanel document={document} access={access} onClose={() => setSharing(false)} onImported={onImported} /> : null}
  </>;
}

function documentGlobal() { return globalThis.document; }

