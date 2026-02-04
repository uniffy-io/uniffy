/**
 * Store Reference Module
 *
 * This module provides a way to access the Redux store without creating
 * a circular dependency. The store reference is set during app initialization.
 *
 * Pattern:
 * 1. store.ts creates the store and calls setStoreRef()
 * 2. Other modules import getStoreRef() to access the store
 * 3. This breaks the circular dependency chain:
 *    api.ts -> store.ts -> authSlice.ts -> (back to api.ts)
 *
 * Why this pattern?
 * - Avoids dynamic imports which cause Vite warnings about mixed import styles
 * - Provides synchronous access to the store after initialization
 * - Works with code splitting since the reference is set at runtime
 */

import type { Store } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '@/app/store';

// Store reference - set once during app initialization
let _store: Store<RootState> | null = null;

/**
 * Set the store reference. Called once from store.ts after store creation.
 */
export function setStoreRef(store: Store<RootState>): void {
  _store = store;
}

/**
 * Get the store reference. Returns null if called before initialization.
 * Use this in modules that need store access but can't import store.ts directly.
 */
export function getStoreRef(): Store<RootState> | null {
  return _store;
}

/**
 * Get the store reference, throwing if not initialized.
 * Use this when you're certain the store is initialized.
 */
export function getStoreRefOrThrow(): Store<RootState> {
  if (!_store) {
    throw new Error('Store not initialized. Ensure setStoreRef() is called before accessing the store.');
  }
  return _store;
}

/**
 * Dispatch an action to the store.
 * Convenience method that handles the null check.
 */
export function dispatchAction<T>(action: { type: string; payload?: T }): void {
  if (_store) {
    (_store.dispatch as AppDispatch)(action);
  } else {
    console.warn('Store not initialized, action not dispatched:', action.type);
  }
}

/**
 * Get current state from the store.
 * Returns null if store is not initialized.
 */
export function getState(): RootState | null {
  return _store?.getState() ?? null;
}
