import { sanitizeMentionLabel } from "@shared/mentions/mentionLabel";
import type { MentionToken } from "@features/mentions/useMentionTypeahead";
import type { SerializedSearchResult } from "@features/search/searchSerializer";

export type MentionPick = {
  text: string;
  cursor: number;
  mention: { label: string; urn: string };
};

/** Replace the active `@token` with `@Label `; the urn rides the caller's
 *  mention list until send canonicalizes. Returns the new draft + caret. */
export function applyMentionPick(
  draft: string,
  token: MentionToken,
  item: SerializedSearchResult,
): MentionPick {
  // Sanitized once here so the composer text and the mention entry agree; a
  // raw title would let `toCanonical` emit markup the author never wrote.
  // Broadcast suggestions display as "@channel"; the insert adds its own "@".
  const label = sanitizeMentionLabel(item.title.replace(/^@+/, ""));
  const before = draft.slice(0, token.start);
  const after = draft.slice(token.end);
  const insert = `@${label} `;
  return {
    text: before + insert + after,
    cursor: before.length + insert.length,
    mention: { label, urn: item.urn },
  };
}
