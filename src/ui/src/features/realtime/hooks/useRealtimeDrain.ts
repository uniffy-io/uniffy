import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAppSelector } from "@/app/hooks";
import { ORGANIZATION_LOST_EVENT } from "@/config/api";
import { abortDrainsOutside, resumeDrains, runRealtimeDrain } from "@/features/realtime/drain";
import { hasPendingDoc, subscribePendingDocs } from "@/features/realtime/pendingDocs";
import { AUTH_REFRESHED_EVENT } from "@/features/realtime/protocol";
import { ENCRYPTION_READY_EVENT } from "@/shared/crypto/storageEncryption";
import {
  discoverStoredPendingDocs,
  purgeCleanSnapshots,
} from "@/features/realtime/persistence/encryptedYjsPersistence";

// A drain that timed out waiting for its checkpoint keeps the entry; this retries it once its
// backoff has passed.
const DRAIN_RETRY_MS = 30_000;

/** Mount once in the authenticated shell: replays stranded edits whenever a connection becomes
 * possible. Registry entries are written only after their rows reach the device, so they need
 * no unload prompt. */
export function useRealtimeDrain(): void {
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  // The organization this tab last held; a lost-grant event without a detail names it.
  const lastOrganizationRef = useRef<string | null>(null);

  useEffect(() => {
    // This tab drains only its own organization. Drains of one it left end as retry, keeping rows
    // and entry for a tab of that organization; this one's keep running across a remount.
    abortDrainsOutside(userId ? organizationId : null);
    if (!userId || !organizationId) return;
    lastOrganizationRef.current = organizationId;
    let cancelled = false;
    const kick = () => {
      if (!cancelled) runRealtimeDrain({ userId, organizationId });
    };
    const reconnected = () => {
      resumeDrains();
      kick();
    };
    const discover = () =>
      void discoverStoredPendingDocs(userId)
        .then(kick)
        .catch((error) => console.warn("[realtime] pending discovery failed", error));
    discover();
    kick();
    const retry = setInterval(kick, DRAIN_RETRY_MS);
    window.addEventListener("online", reconnected);
    window.addEventListener(AUTH_REFRESHED_EVENT, kick);
    window.addEventListener(ENCRYPTION_READY_EVENT, discover);
    const unsubscribe = subscribePendingDocs(kick);
    return () => {
      cancelled = true;
      clearInterval(retry);
      window.removeEventListener("online", reconnected);
      window.removeEventListener(AUTH_REFRESHED_EVENT, kick);
      window.removeEventListener(ENCRYPTION_READY_EVENT, discover);
      unsubscribe();
    };
  }, [userId, organizationId]);

  // Registered apart from the drain effect, which the same refresh tears down when it drops the
  // organization.
  useEffect(() => {
    if (!userId) return;
    const handleLost = (event: Event) => {
      const lost =
        (event as CustomEvent<{ organizationId?: string }>).detail?.organizationId ??
        lastOrganizationRef.current;
      if (!lost) return;
      void purgeCleanSnapshots(userId, lost).catch((error) =>
        console.warn("[realtime] lost organization cleanup failed", error),
      );
    };
    window.addEventListener(ORGANIZATION_LOST_EVENT, handleLost);
    return () => window.removeEventListener(ORGANIZATION_LOST_EVENT, handleLost);
  }, [userId]);
}

/** True while this doc waits in the drain registry for its checkpoint. */
export function usePendingDocSync(contentType: string, contentId: string | null): boolean {
  return useSyncExternalStore(subscribePendingDocs, () =>
    contentId ? hasPendingDoc(contentType, contentId) : false,
  );
}
