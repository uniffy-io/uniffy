import { useCallback, useMemo, useSyncExternalStore } from "react";
import { realtimeMultiplexer, type RealtimeDocState } from "@/features/realtime/multiplexer";
import {
  getDeviceRecoveryState,
  subscribeDeviceRecovery,
  type DeviceRecoveryState,
} from "@/features/realtime/persistence/encryptedYjsPersistence";

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
});

export function useRealtimeDocState(docName: string | null): RealtimeDocState {
  const subscribe = useCallback(
    (onChange: () => void) =>
      docName ? realtimeMultiplexer.subscribeDocState(docName, onChange) : () => {},
    [docName],
  );
  const getSnapshot = () => (docName ? realtimeMultiplexer.getDocState(docName) : NO_DOC_STATE);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const NO_DEVICE_STATE: DeviceRecoveryState = Object.freeze({
  storage: "available",
  unpersisted: false,
});

/** What this device holds of a document's own edits, for the chip and the Done hand-off. */
export function useDeviceRecoveryState(docName: string | null): DeviceRecoveryState {
  const subscribe = useCallback(
    (onChange: () => void) => (docName ? subscribeDeviceRecovery(docName, onChange) : () => {}),
    [docName],
  );
  const getSnapshot = () => (docName ? getDeviceRecoveryState(docName) : NO_DEVICE_STATE);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface SaveStateStore {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => SaveState;
}

/** Save state of one document for a single subscriber; its timers run only while subscribed. */
export function createSaveStateStore(docName: string): SaveStateStore {
  let settling = false;
  // The oldest-edit timestamp whose thirty seconds ran out without a checkpoint.
  let delayedFor: number | null = null;

  const getSnapshot = (): SaveState => {
    const state = realtimeMultiplexer.getDocState(docName);
    if (state.savingUnavailable) return "unavailable";
    if (state.oldestUncheckpointedAt !== null && state.oldestUncheckpointedAt === delayedFor)
      return "delayed";
    if (state.transportPending || settling) return "syncing";
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

const NO_SAVE_STATE = {
  subscribe: () => () => {},
  getSnapshot: () => null,
};

/** Null without a document; viewers pass null because they have no edits to save. */
export function useDocSaveState(docName: string | null): SaveState | null {
  const store = useMemo(() => (docName ? createSaveStateStore(docName) : NO_SAVE_STATE), [docName]);
  return useSyncExternalStore<SaveState | null>(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
