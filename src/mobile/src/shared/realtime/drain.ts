import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { realtimeMultiplexer } from "@shared/realtime/multiplexer";
import {
  discardGeneration,
  listDraftKeys,
  restoreDraft,
  readStoredDrafts,
  isDraftStorageActive,
} from "@shared/realtime/draftStorage";

const active = new Map<string, () => void>();

export function abortMobileDrain(name: string): void {
  active.get(name)?.();
}
export function stopMobileDrains(): void {
  for (const stop of active.values()) stop();
}

export async function runMobileDrain(
  userId: string,
  organizationId: string,
  isActive: () => boolean,
): Promise<void> {
  for (const key of await listDraftKeys(userId)) {
    if (!isActive() || !isDraftStorageActive(userId)) return;
    const [, owner, org, contentType, contentId] = key.split(".");
    if (owner !== userId || org !== organizationId || !contentId) continue;
    const name = `${contentType}:${contentId}`;
    if (active.has(name) || realtimeMultiplexer.isAttached(name)) continue;
    const drafts = await readStoredDrafts(key);
    if (
      !drafts.some((draft) => !draft.generation.startsWith("unmerged:")) ||
      !isActive() ||
      realtimeMultiplexer.isAttached(name)
    )
      continue;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    let finished = false;
    let hydrated = false;
    const finish = (acknowledged = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      active.delete(name);
      const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
      subscription.destroy();
      awareness.destroy();
      doc.destroy();
      if (acknowledged && generation) void discardGeneration(key, generation).catch(console.warn);
    };
    const subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      organizationId,
      ydoc: doc,
      awareness,
      onSync: () =>
        void restoreDraft(key, doc, "drain", () => !finished && isActive())
          .then(() => {
            if (finished) return;
            hydrated = true;
            if (!realtimeMultiplexer.isOutboundPending(name)) finish(true);
          })
          .catch(() => finish()),
      onPending: (pending) => {
        if (hydrated && !pending) finish(true);
      },
      onWriteDenied: () => finish(),
      onGenerationMismatch: () => finish(),
    });
    const timer = setTimeout(() => finish(), 60_000);
    active.set(name, () => finish());
  }
}
