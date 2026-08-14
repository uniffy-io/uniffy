/** Indirection layer so modules can reach the store without importing store.ts (breaks api.ts <-> store.ts <-> authSlice.ts cycle). */

import type { Store } from "@reduxjs/toolkit";
import type { RootState, AppDispatch } from "@/app/store";

let _store: Store<RootState> | null = null;

export function setStoreRef(store: Store<RootState>): void {
  _store = store;
}

export function getStoreRef(): Store<RootState> | null {
  return _store;
}

export function getStoreRefOrThrow(): Store<RootState> {
  if (!_store) {
    throw new Error(
      "Store not initialized. Ensure setStoreRef() is called before accessing the store.",
    );
  }
  return _store;
}

export function dispatchAction<T>(action: { type: string; payload?: T }): void {
  if (_store) {
    (_store.dispatch as AppDispatch)(action);
  } else {
    console.warn("Store not initialized, action not dispatched:", action.type);
  }
}

export function getState(): RootState | null {
  return _store?.getState() ?? null;
}
