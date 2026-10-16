import { useEffect, useSyncExternalStore } from "react";
import { useAppSelector } from "@/app/hooks";
import { runRealtimeDrain } from "@/features/realtime/drain";
import { hasPendingDoc, subscribePendingDocs } from "@/features/realtime/pendingDocs";
import { AUTH_REFRESHED_EVENT } from "@/features/realtime/protocol";
import { ENCRYPTION_READY_EVENT } from "@/shared/crypto/storageEncryption";
import { discoverStoredPendingDocs } from "@/features/realtime/persistence/encryptedYjsPersistence";

// A drain that timed out waiting for its checkpoint keeps the entry; this retries it.
const DRAIN_RETRY_MS = 30_000;

/** Mount once in the authenticated shell: replays stranded edits whenever a connection becomes
 * possible. Registry entries are written only after their rows reach the device, so they need
 * no unload prompt. */
export function useRealtimeDrain(): void {
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    if (!userId || !organizationId) return;
    let cancelled = false;
    const kick = () => {
      if (!cancelled) runRealtimeDrain({ userId, organizationId });
    };
    const discover = () =>
      void discoverStoredPendingDocs(userId)
        .then(kick)
        .catch((error) => console.warn("[realtime] pending discovery failed", error));
    discover();
    kick();
    const retry = setInterval(kick, DRAIN_RETRY_MS);
    window.addEventListener("online", kick);
    window.addEventListener(AUTH_REFRESHED_EVENT, kick);
    window.addEventListener(ENCRYPTION_READY_EVENT, discover);
    const unsubscribe = subscribePendingDocs(kick);
    return () => {
      cancelled = true;
      clearInterval(retry);
      window.removeEventListener("online", kick);
      window.removeEventListener(AUTH_REFRESHED_EVENT, kick);
      window.removeEventListener(ENCRYPTION_READY_EVENT, discover);
      unsubscribe();
    };
  }, [userId, organizationId]);
}

/** True while this doc waits in the drain registry for its checkpoint. */
export function usePendingDocSync(contentType: string, contentId: string | null): boolean {
  return useSyncExternalStore(subscribePendingDocs, () =>
    contentId ? hasPendingDoc(contentType, contentId) : false,
  );
}
