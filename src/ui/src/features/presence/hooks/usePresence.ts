import { useEffect } from "react";
import { isUuid } from "@/shared/utils/uuid";
import { useAppSelector } from "@/app/hooks";
import { getStoreRef } from "@/app/storeRef";
import { fetchBulkPresence } from "@/features/presence/store/presenceThunks";
import type { AppDispatch, RootState } from "@/app/store";

// 150ms debounce coalesces concurrent usePresence callers into one bulk RPC.
const pendingUserIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingPresence() {
  flushTimer = null;
  if (pendingUserIds.size === 0) return;

  const store = getStoreRef();
  if (!store) return;

  const state = store.getState() as RootState;
  const organizationId = state.auth.currentOrganizationId;
  if (!organizationId) return;

  // Drop any IDs that arrived in the store while debouncing.
  const ids = [...pendingUserIds].filter((id) => !(id in state.presence.statuses));
  pendingUserIds.clear();

  if (ids.length === 0) return;

  (store.dispatch as AppDispatch)(fetchBulkPresence({ organizationId, userIds: ids }));
}

function requestPresence(userId: string) {
  // Backend raises INVALID_ARGUMENT on non-UUID subjects (agents, placeholders).
  if (!userId || !isUuid(userId)) return;
  pendingUserIds.add(userId);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPendingPresence, 150);
}

/** Returns 'offline' while the bulk fetch is in flight. */
export function usePresence(userId: string): string {
  const status = useAppSelector((state) => state.presence.statuses[userId]);

  useEffect(() => {
    if (!userId || status !== undefined) return;
    requestPresence(userId);
  }, [userId, status]);

  return status ?? "offline";
}
