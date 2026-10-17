import type * as Y from "yjs";
import {
  MARKDOWN_MIRROR_FIELD,
  MIRROR_ACTIVE_KEY,
  PROSEMIRROR_FRAGMENT_FIELD,
  fragmentHasRealContent,
} from "@/features/realtime/docContent";

export type ColdStartFragmentAction = "seed" | "keep" | "rebuild";

interface AwarenessStates {
  clientID: number;
  getStates: () => Map<number, { markdownEditor?: unknown }>;
}

/** Only an awareness state carrying `markdownEditor` is a rich editor; Markdown mode and mobile write Y.Text directly and leave the fragment behind. */
export function hasRichPeer(awareness: AwarenessStates): boolean {
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId !== awareness.clientID && state?.markdownEditor) return true;
  }
  return false;
}

/**
 * How a rich editor reconciles the shared fragment with Y.Text("markdown") before its first
 * mirror flush. `active=false` marks an explicit text write, which wins over the fragment even
 * with peers attached; an unset flag keeps a rich peer's in-flight fragment and self-heals solo.
 */
export function resolveColdStartFragment(
  ydoc: Y.Doc,
  _awareness: AwarenessStates,
  fragmentMatchesText: () => boolean,
): ColdStartFragmentAction {
  const fragment = ydoc.getXmlFragment(PROSEMIRROR_FRAGMENT_FIELD);
  if (!fragmentHasRealContent(fragment)) return "seed";
  const active = ydoc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY);
  if (active === true) return "keep";
  if (fragmentMatchesText()) return "keep";
  if (active === false) return "rebuild";
  return "keep";
}
