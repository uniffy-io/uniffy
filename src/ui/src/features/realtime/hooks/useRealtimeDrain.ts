import { useEffect, useSyncExternalStore } from "react";
import { useAppSelector } from "@/app/hooks";
import { runRealtimeDrain } from "@/features/realtime/drain";
import {
  hasPendingDoc,
  hasPendingDocs,
  subscribePendingDocs,
} from "@/features/realtime/pendingDocs";
import { AUTH_REFRESHED_EVENT } from "@/features/realtime/protocol";
import { ENCRYPTION_READY_EVENT } from "@/shared/crypto/storageEncryption";
import { useUnloadGuard } from "@/shared/hooks/useUnloadGuard";
import { discoverStoredPendingDocs } from "@/features/realtime/persistence/encryptedYjsPersistence";

/** Mount once in the authenticated shell: replays stranded edits whenever a connection becomes possible. */
export function useRealtimeDrain(): void {
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const stranded = useSyncExternalStore(subscribePendingDocs, () =>
    userId ? hasPendingDocs(userId) : false,
  );
  // Stranded rows survive a reload, but the prompt stops an accidental close mid-drain.
  useUnloadGuard(stranded);

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
    window.addEventListener("online", kick);
    window.addEventListener(AUTH_REFRESHED_EVENT, kick);
    window.addEventListener(ENCRYPTION_READY_EVENT, discover);
    const unsubscribe = subscribePendingDocs(kick);
    return () => {
      cancelled = true;
      window.removeEventListener("online", kick);
      window.removeEventListener(AUTH_REFRESHED_EVENT, kick);
      window.removeEventListener(ENCRYPTION_READY_EVENT, discover);
      unsubscribe();
    };
  }, [userId, organizationId]);
}

/** True while this doc waits in the drain registry for a connection. */
export function usePendingDocSync(contentType: string, contentId: string | null): boolean {
  return useSyncExternalStore(subscribePendingDocs, () =>
    contentId ? hasPendingDoc(contentType, contentId) : false,
  );
}
