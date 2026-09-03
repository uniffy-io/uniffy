import { stripMarkdown } from "@features/notes/noteSerializer";

/**
 * Plain text for a card's preview. Descriptions arrive cut to a length, so a
 * mention can be sliced open at the end; the dangling half is dropped rather
 * than shown as raw markup.
 */
export function cardSnippet(raw: string): string {
  return stripMarkdown(raw.replace(/\[\[\[[^\]]*$/, "")).trim();
}
