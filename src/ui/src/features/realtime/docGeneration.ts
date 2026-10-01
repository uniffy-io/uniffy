import type * as Y from "yjs";

export const DOC_META_FIELD = "doc_meta";
export const DOC_GENERATION_KEY = "generation";

export function docGeneration(ydoc: Y.Doc): string | null {
  const generation = ydoc.getMap(DOC_META_FIELD).get(DOC_GENERATION_KEY);
  return typeof generation === "string" ? generation : null;
}
