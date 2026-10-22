import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { fromBase64 } from "lib0/buffer";
import { realtimeMultiplexer, type UpdateCoverageEvent } from "@shared/realtime/multiplexer";
import {
  clearUserDrafts,
  discardGeneration,
  isDraftStorageActive,
  isDrainableGeneration,
  listDraftKeys,
  readRetainedUpdates,
  readStoredDrafts,
  recordCoverage,
  restoreDraft,
  settleDraftWrites,
  settleLostAccess,
  subscribeDraftSaves,
} from "@shared/realtime/draftStorage";

// A drain that sees no checkpoint in this window detaches and keeps the draft for the next kick.
export const DRAIN_TIMEOUT_MS = 60_000;
// Each drain that ends without a checkpoint doubles the wait before that document attaches
// again, so a document whose checkpoint is stuck reattaches about every quarter hour instead of
// on every kick.
export const DRAIN_BACKOFF_MS = 60_000;
export const DRAIN_BACKOFF_MAX_MS = 15 * 60_000;
// Longer than one checkpoint window, so accepted edits can be saved before sign-out asks.
export const SIGN_OUT_SETTLE_MS = 15_000;

const active = new Map<string, () => void>();
const backoff = new Map<
  string,
  { attempts: number; waiting: ReturnType<typeof setTimeout> | null }
>();

function forgetBackoff(name: string): void {
  const entry = backoff.get(name);
  if (entry?.waiting) clearTimeout(entry.waiting);
  backoff.delete(name);
}

function delayNextAttempt(name: string): void {
  const attempts = (backoff.get(name)?.attempts ?? 0) + 1;
  forgetBackoff(name);
  const entry = { attempts, waiting: null as ReturnType<typeof setTimeout> | null };
  entry.waiting = setTimeout(
    () => {
      entry.waiting = null;
    },
    Math.min(DRAIN_BACKOFF_MS * 2 ** (attempts - 1), DRAIN_BACKOFF_MAX_MS),
  );
  backoff.set(name, entry);
}

/** An editor opening the doc takes over; the drain its close hands off to starts at once. */
export function abortMobileDrain(name: string): void {
  forgetBackoff(name);
  active.get(name)?.();
}
export function stopMobileDrains(): void {
  for (const stop of active.values()) stop();
}
/** Connectivity came back, which may be what held the checkpoints: every drain may run now. */
export function resumeMobileDrains(): void {
  for (const entry of backoff.values()) if (entry.waiting) clearTimeout(entry.waiting);
  backoff.clear();
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
  realtimeMultiplexer.restorePending(docName, generation, updates);
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
 * Gives attached documents up to one checkpoint window to save every own edit, then names the
 * organizations where this user still has edits that only this device holds, each once.
 * Sign-out asks before deleting them.
 */
export async function settleUnsyncedEdits(userId: string): Promise<string[]> {
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
  const organizations = new Set<string>();
  for (const key of await listDraftKeys(userId)) {
    const [, , organizationId, contentType, contentId] = key.split(".");
    if (organizations.has(organizationId)) continue;
    const name = `${contentType}:${contentId}`;
    const { checkpointPending, generation } = realtimeMultiplexer.getDocState(name);
    // An open document whose every edit is checkpointed keeps only a cache of its own generation.
    const cached =
      realtimeMultiplexer.isAttached(name) &&
      !checkpointPending &&
      generation !== null &&
      (await readStoredDrafts(key)).every((draft) => draft.generation === generation);
    if (!cached) organizations.add(organizationId);
  }
  return [...organizations];
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
  if (active.has(name) || realtimeMultiplexer.isAttached(name) || backoff.get(name)?.waiting)
    return;
  const drafts = await readStoredDrafts(key);
  const lineages = [...new Set(drafts.map((draft) => draft.generation))].filter(
    isDrainableGeneration,
  );
  if (!lineages.length || !isActive() || active.has(name) || realtimeMultiplexer.isAttached(name))
    return;
  const doc = new Y.Doc();
  // Hydrating first makes the attaching SyncStep1 carry what this device holds, so the server
  // answers with what changed since instead of the whole document. Drafts of more than one
  // lineage wait for the generation the server names.
  const held = lineages.length === 1 ? lineages[0] : null;
  for (const draft of drafts)
    if (draft.generation === held) Y.applyUpdate(doc, fromBase64(draft.update), "drain");
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  let finished = false;
  let hydrated = false;
  // "retry" waits out a backoff; "stopped" leaves the next attach to its trigger.
  const finish = (outcome: "drained" | "retry" | "stopped") => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    stopWatching();
    active.delete(name);
    if (outcome === "retry") delayNextAttempt(name);
    else if (outcome === "drained") forgetBackoff(name);
    const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
    subscription.destroy();
    awareness.destroy();
    doc.destroy();
    if (outcome === "drained" && generation)
      void discardGeneration(key, generation).catch(console.warn);
  };
  // The server keeps what it accepted. Only a drain that has seen every own update accepted on
  // this socket may drop the device copy; otherwise it becomes a recovered draft.
  const settleLost = () => {
    const state = realtimeMultiplexer.getDocState(name);
    const keepDraft = !state.coverageKnown || state.transportPending;
    const generations = state.generation ? [state.generation] : held ? [held] : lineages;
    finish("stopped");
    for (const generation of generations)
      void settleLostAccess(key, generation, keepDraft).catch((error) => {
        console.warn("[realtime] could not settle a document without access", error);
        delayNextAttempt(name);
      });
  };
  const retain = retainCoverage(key, name);
  const subscription = realtimeMultiplexer.attach({
    contentType,
    contentId,
    organizationId,
    ydoc: doc,
    awareness,
    heldGeneration: held,
    onCoverage: (events) => void retain(events).catch(console.warn),
    onSync: () =>
      void replayRetainedUpdates(key, name)
        .then(() => restoreDraft(key, doc, "drain", () => !finished && isActive()))
        .then(() => {
          if (finished) return;
          hydrated = true;
          if (!realtimeMultiplexer.getDocState(name).checkpointPending) finish("drained");
        })
        .catch(() => finish("retry")),
    // A view denial settles only when a socket of the draft's own organization said it.
    onWriteDenied: (_reason, noView) =>
      noView && realtimeMultiplexer.servesOrganization(organizationId)
        ? settleLost()
        : finish("retry"),
    onGenerationMismatch: () => finish("retry"),
    // No server of this organization answered, so nothing is known about access: rows and entry
    // stay for a socket of the right organization.
    onOrganizationMismatch: () => finish("retry"),
  });
  // Only a checkpoint ends the drain; a receipt leaves the device copy dirty.
  const stopWatching = realtimeMultiplexer.subscribeDocState(name, (state) => {
    if (hydrated && !state.checkpointPending) finish("drained");
  });
  const timer = setTimeout(() => finish("retry"), DRAIN_TIMEOUT_MS);
  active.set(name, () => finish("stopped"));
}
