import * as Y from "yjs";
import { diffStrings } from "@features/notes/realtime/textDiff";

// Canonical markdown field shared with the web editor and the backend
// snapshot pipeline (`Y.Text("markdown")`).
export const MARKDOWN_TEXT_FIELD = "markdown";

export function getMarkdownYText(ydoc: Y.Doc): Y.Text {
  return ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text);
}

/** Minimal-delta write keeps the Yjs update proportional to the edit, not the doc. */
export function replaceMarkdownYText(ydoc: Y.Doc, next: string, origin: unknown): void {
  const ytext = getMarkdownYText(ydoc);
  const delta = diffStrings(ytext.toString(), next);
  if (!delta) return;
  ydoc.transact(() => {
    if (delta.deleteCount > 0) ytext.delete(delta.index, delta.deleteCount);
    if (delta.insert.length > 0) ytext.insert(delta.index, delta.insert);
  }, origin);
}
