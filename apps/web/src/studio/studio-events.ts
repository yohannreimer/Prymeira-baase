import type { StudioStructureKind } from "./studio.types";

export type StudioDataEvent =
  | { type: "structure-changed"; documentId: string; kind: StudioStructureKind }
  | { type: "document-lifecycle-changed"; documentId: string };

const STUDIO_DATA_EVENT = "studio-data";
const target = new EventTarget();

export function publishStudioEvent(event: StudioDataEvent) {
  target.dispatchEvent(new CustomEvent<StudioDataEvent>(STUDIO_DATA_EVENT, { detail: event }));
}

export function subscribeStudioEvents(listener: (event: StudioDataEvent) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<StudioDataEvent>).detail);
  target.addEventListener(STUDIO_DATA_EVENT, handler);
  return () => target.removeEventListener(STUDIO_DATA_EVENT, handler);
}
