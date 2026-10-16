import { useCallback, useMemo, useSyncExternalStore } from "react";
import { canReleaseSession } from "@/features/realtime/hooks/useDocSession";
import { realtimeMultiplexer, type RealtimeDocState } from "@/features/realtime/multiplexer";
import {
  getDeviceRecoveryState,
  subscribeDeviceRecovery,
  type DeviceRecoveryState,
  type DeviceStorage,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import type { RealtimeStatus } from "@/features/realtime/protocol";

/** What the persistence chip tells the user about their own edits on one document. */
export type SaveState = "syncing" | "synced" | "delayed" | "unavailable" | "saved";

export const SAVE_DELAYED_AFTER_MS = 30_000;
// Receipts arrive per transport batch, so without a hold the label would flip several times a
// second while someone types.
export const SYNCING_SETTLE_MS = 1_000;

const NO_DOC_STATE: RealtimeDocState = Object.freeze({
  transportPending: false,
  checkpointPending: false,
  oldestUncheckpointedAt: null,
  savingUnavailable: false,
  coverageKnown: false,
});

const NO_DEVICE_STATE: DeviceRecoveryState = Object.freeze({
  storage: "available",
  unpersisted: false,
});

/** One value derived from a document's transport and device state. Subscribers hear only its
 * changes, so a host re-renders when that value flips, not on every batch and receipt. */
export interface DocValueStore<T> {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => T;
}

function derivedStore<T>(docName: string | null, read: () => T): DocValueStore<T> {
  return {
    subscribe: (onChange) => {
      if (!docName) return () => {};
      let last = read();
      const notify = () => {
        const next = read();
        if (Object.is(next, last)) return;
        last = next;
        onChange();
      };
      const stopDoc = realtimeMultiplexer.subscribeDocState(docName, notify);
      const stopDevice = subscribeDeviceRecovery(docName, notify);
      return () => {
        stopDoc();
        stopDevice();
      };
    },
    getSnapshot: read,
  };
}

const docState = (docName: string | null) =>
  docName ? realtimeMultiplexer.getDocState(docName) : NO_DOC_STATE;
const deviceState = (docName: string | null) =>
  docName ? getDeviceRecoveryState(docName) : NO_DEVICE_STATE;

/** Some own edit is not in a checkpoint yet; flips at the first edit and at the checkpoint. */
export function checkpointPendingStore(docName: string | null): DocValueStore<boolean> {
  return derivedStore(docName, () => docState(docName).checkpointPending);
}

export function deviceStorageStore(docName: string | null): DocValueStore<DeviceStorage> {
  return derivedStore(docName, () => deviceState(docName).storage);
}

/** Whether a closing editor may hand its document to the drain, per `canReleaseSession`. */
export function releasableStore(
  docName: string | null,
  status: RealtimeStatus,
): DocValueStore<boolean> {
  return derivedStore(docName, () =>
    canReleaseSession(status, docState(docName), deviceState(docName)),
  );
}

function useDocValue<T>(store: DocValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useCheckpointPending(docName: string | null): boolean {
  return useDocValue(useMemo(() => checkpointPendingStore(docName), [docName]));
}

export function useDeviceStorage(docName: string | null): DeviceStorage {
  return useDocValue(useMemo(() => deviceStorageStore(docName), [docName]));
}

/** Pass a document only while it matters, such as while an editor closes; without one the status
 * alone decides. */
export function useSessionReleasable(docName: string | null, status: RealtimeStatus): boolean {
  return useDocValue(useMemo(() => releasableStore(docName, status), [docName, status]));
}

/** What this device holds of a document's own edits, for the chip and the Done hand-off. */
export function useDeviceRecoveryState(docName: string | null): DeviceRecoveryState {
  const subscribe = useCallback(
    (onChange: () => void) => (docName ? subscribeDeviceRecovery(docName, onChange) : () => {}),
    [docName],
  );
  const getSnapshot = () => deviceState(docName);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface SaveStateStore {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => SaveState | null;
}

/** Save state of one document for a single subscriber; its timers run only while subscribed.
 * Null while nothing is unsent yet coverage is unknown: only the current socket's session state
 * can show Synced or Saved. */
export function createSaveStateStore(docName: string): SaveStateStore {
  let settling = false;
  // The oldest-edit timestamp whose thirty seconds ran out without a checkpoint.
  let delayedFor: number | null = null;

  const getSnapshot = (): SaveState | null => {
    const state = realtimeMultiplexer.getDocState(docName);
    if (state.savingUnavailable) return "unavailable";
    const oldest = state.oldestUncheckpointedAt;
    // Only this socket's session state says whether that edit is still waiting: a reconnect
    // that missed its checkpoint must not flash a delay. A restored old edit is late at once.
    if (
      oldest !== null &&
      state.coverageKnown &&
      (oldest === delayedFor || Date.now() >= oldest + SAVE_DELAYED_AFTER_MS)
    )
      return "delayed";
    if (state.transportPending || settling) return "syncing";
    if (!state.coverageKnown) return null;
    return state.checkpointPending ? "synced" : "saved";
  };

  const subscribe = (onChange: () => void) => {
    let previous = realtimeMultiplexer.getDocState(docName);
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    const watchDelay = (oldest: number | null) => {
      clearTimeout(delayTimer);
      if (oldest === null) return;
      delayTimer = setTimeout(
        () => {
          delayedFor = oldest;
          onChange();
        },
        oldest + SAVE_DELAYED_AFTER_MS - Date.now(),
      );
    };
    watchDelay(previous.oldestUncheckpointedAt);
    const unsubscribe = realtimeMultiplexer.subscribeDocState(docName, (state) => {
      if (state.transportPending) {
        clearTimeout(settleTimer);
        settling = false;
      } else if (previous.transportPending) {
        settling = true;
        settleTimer = setTimeout(() => {
          settling = false;
          onChange();
        }, SYNCING_SETTLE_MS);
      }
      if (state.oldestUncheckpointedAt !== previous.oldestUncheckpointedAt)
        watchDelay(state.oldestUncheckpointedAt);
      previous = state;
      onChange();
    });
    return () => {
      unsubscribe();
      clearTimeout(settleTimer);
      clearTimeout(delayTimer);
      settling = false;
    };
  };

  return { subscribe, getSnapshot };
}

const NO_SAVE_STATE: SaveStateStore = {
  subscribe: () => () => {},
  getSnapshot: () => null,
};

/** Null without a document or before its coverage is known; viewers pass null because they have
 * no edits to save. */
export function useDocSaveState(docName: string | null): SaveState | null {
  const store = useMemo(() => (docName ? createSaveStateStore(docName) : NO_SAVE_STATE), [docName]);
  return useSyncExternalStore<SaveState | null>(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
