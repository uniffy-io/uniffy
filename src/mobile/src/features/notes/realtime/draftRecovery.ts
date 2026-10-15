import type { MobileRecoveredDraft } from "@shared/realtime/draftStorage";
import type { TextBindingCallbacks } from "@features/notes/realtime/textBinding";
import { fineDiff, transformIndex } from "@features/notes/realtime/textDelta";

export function hydrateOfflineDraft(
  drafts: MobileRecoveredDraft[],
  callbacks: TextBindingCallbacks,
): MobileRecoveredDraft | null {
  const loaded = callbacks.getLoadedCanonical();
  if (loaded === null || callbacks.getLocalCanonical() !== loaded || callbacks.isComposing?.())
    return null;
  const draft = drafts.findLast((item) => item.generation.startsWith("unmerged:"));
  if (!draft || draft.base !== loaded) return null;
  const delta = fineDiff(loaded, draft.text);
  callbacks.applyRemote(draft.text, (index) => transformIndex(index, delta, true));
  return draft;
}

export function offlineReplayBase(draft: MobileRecoveredDraft, serverText: string): string | null {
  // Text-only drafts have no causal identity. A changed base needs explicit recovery.
  if (serverText === draft.base || serverText === draft.text) return serverText;
  return null;
}
