import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { realtimeMultiplexer, type UpdateCoverageEvent } from "@shared/realtime/multiplexer";
import {
  clearUserDrafts,
  discardGeneration,
  isDraftStorageActive,
  listDraftKeys,
  readRetainedUpdates,
  readStoredDrafts,
  recordCoverage,
  restoreDraft,
  settleDraftWrites,
  subscribeDraftSaves,
} from "@shared/realtime/draftStorage";

// A drain that sees no checkpoint in this window detaches and keeps the draft for the next kick.
const DRAIN_TIMEOUT_MS = 60_000;
// Longer than one checkpoint window, so accepted edits can be saved before sign-out asks.
export const SIGN_OUT_SETTLE_MS = 15_000;

const active = new Map<string, () => void>();

export function abortMobileDrain(name: string): void {
  active.get(name)?.();
}
export function stopMobileDrains(): void {
  for (const stop of active.values()) stop();
}

/** Coverage listener that keeps every uncheckpointed own update of an attached doc on device. */
export function retainCoverage(
  key: string,
  docName: string,
): (events: readonly UpdateCoverageEvent[]) => Promise<void> {
  return (events) =>
    recordCoverage(key, realtimeMultiplexer.getDocState(docName).generation, events);
}

/** After sync, re-sends what an earlier session left uncheckpointed, under the original ids. */
export async function replayRetainedUpdates(key: string, docName: string): Promise<void> {
  const { generation } = realtimeMultiplexer.getDocState(docName);
  if (!generation) return;
  const updates = await readRetainedUpdates(key, generation);
  if (updates.length) realtimeMultiplexer.restorePending(docName, generation, updates);
}

export async function runMobileDrain(
  userId: string,
  organizationId: string,
  isActive: () => boolean,
): Promise<void> {
  for (const key of await listDraftKeys(userId)) {
    if (!isActive() || !isDraftStorageActive(userId)) return;
    await drainDraft(key, userId, organizationId, isActive);
  }
}

/** Starts a headless drain for a document whose editor closed with work still pending. */
export function handOffSavedDrafts(
  userId: string,
  organizationId: string,
  isActive: () => boolean,
): () => void {
  return subscribeDraftSaves((key) => {
    if (isActive()) void drainDraft(key, userId, organizationId, isActive).catch(console.warn);
  });
}

/**
 * Gives attached documents up to one checkpoint window to save every own edit, then reports
 * whether this user still has edits that only this device holds. Sign-out asks before deleting
 * them.
 */
export async function settleUnsyncedEdits(userId: string): Promise<boolean> {
  const waiting = realtimeMultiplexer.flushPending();
  if (waiting.length) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        for (const stop of stops) stop();
        resolve();
      };
      const stops = waiting.map((name) =>
        realtimeMultiplexer.subscribeDocState(name, () => {
          if (waiting.every((doc) => !realtimeMultiplexer.getDocState(doc).checkpointPending))
            done();
        }),
      );
      const timer = setTimeout(done, SIGN_OUT_SETTLE_MS);
    });
  }
  await settleDraftWrites();
  for (const key of await listDraftKeys(userId)) {
    const [, , , contentType, contentId] = key.split(".");
    const name = `${contentType}:${contentId}`;
    const { checkpointPending, generation } = realtimeMultiplexer.getDocState(name);
    // An open document whose every edit is checkpointed keeps only a cache of its own generation.
    const cached =
      realtimeMultiplexer.isAttached(name) &&
      !checkpointPending &&
      generation !== null &&
      (await readStoredDrafts(key)).every((draft) => draft.generation === generation);
    if (!cached) return true;
  }
  return false;
}

/** Stops drains and deletes this user's drafts and their key. */
export async function signOutDrafts(userId: string): Promise<void> {
  stopMobileDrains();
  await clearUserDrafts(userId);
}

async function drainDraft(
  key: string,
  userId: string,
  organizationId: string,
  isActive: () => boolean,
): Promise<void> {
  const [, owner, org, contentType, contentId] = key.split(".");
  if (owner !== userId || org !== organizationId || !contentId) return;
  const name = `${contentType}:${contentId}`;
  if (active.has(name) || realtimeMultiplexer.isAttached(name)) return;
  const drafts = await readStoredDrafts(key);
  if (
    !drafts.some((draft) => !draft.generation.startsWith("unmerged:")) ||
    !isActive() ||
    active.has(name) ||
    realtimeMultiplexer.isAttached(name)
  )
    return;
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  let finished = false;
  let hydrated = false;
  const finish = (checkpointed = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    stopWatching();
    active.delete(name);
    const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
    subscription.destroy();
    awareness.destroy();
    doc.destroy();
    if (checkpointed && generation) void discardGeneration(key, generation).catch(console.warn);
  };
  const retain = retainCoverage(key, name);
  const subscription = realtimeMultiplexer.attach({
    contentType,
    contentId,
    organizationId,
    ydoc: doc,
    awareness,
    onCoverage: (events) => void retain(events).catch(console.warn),
    onSync: () =>
      void replayRetainedUpdates(key, name)
        .then(() => restoreDraft(key, doc, "drain", () => !finished && isActive()))
        .then(() => {
          if (finished) return;
          hydrated = true;
          if (!realtimeMultiplexer.getDocState(name).checkpointPending) finish(true);
        })
        .catch(() => finish()),
    onWriteDenied: () => finish(),
    onGenerationMismatch: () => finish(),
  });
  // Only a checkpoint ends the drain; a receipt leaves the device copy dirty.
  const stopWatching = realtimeMultiplexer.subscribeDocState(name, (state) => {
    if (hydrated && !state.checkpointPending) finish(true);
  });
  const timer = setTimeout(() => finish(), DRAIN_TIMEOUT_MS);
  active.set(name, () => finish());
}
