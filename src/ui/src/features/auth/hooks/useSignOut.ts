import { useCallback } from "react";
import { createClient } from "@connectrpc/connect";
import { useNavigate } from "react-router-dom";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { AppDispatch } from "@/app/store";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { clearMemoryAccessToken, unaryTransport } from "@/config/api";
import { logout } from "@/features/auth/store/authSlice";
import {
  selectOrganizations,
  type OrganizationSummary,
} from "@/features/auth/store/organizationsSlice";
import { clearBlobCache } from "@/features/files/components/viewer/hooks/blobCache";
import { clearStoredFilesFilters } from "@/features/files/store/filesFilterStorage";
import { uploadService } from "@/features/files/upload";
import { clearLibraryScope } from "@/features/library/store/clearLibraryScope";
import {
  clearAllCache as clearNotesCache,
  clearCachedNotes,
} from "@/features/notes/utils/notesCache";
import {
  clearPendingDocsFor,
  discoverStoredPendingDocs,
  hasUnsyncedEdits,
  listPendingOrganizations,
} from "@/features/realtime";
import { cancelRecording } from "@/features/recording/store/recordingThunks";
import {
  clearRecentItemsForOrganization,
  clearRecentItemsForUser,
} from "@/features/search/utils/recentItems";
import { teardownStorageEncryption } from "@/shared/crypto/storageEncryption";

/**
 * The boundary that ends this tab's caches. A switch moves only this tab, so only its memory goes;
 * a lost grant also drops that organization's device stores; sign-out drops the account's.
 */
export type SessionCacheBoundary =
  | { reason: "switch" }
  | {
      reason: "lost-grant";
      organizationId?: string;
      userId?: string;
      preserveCurrentScope?: boolean;
    }
  | { reason: "sign-out"; userId?: string };

/**
 * Caches outside the store; Redux state is reset by `withSessionScope`. Stores shared by every tab
 * of the origin are keyed by organization and user, so a switch leaves them to the tabs that need
 * them. Resolves once the device stores settle; failures are logged, never thrown.
 */
export async function clearSessionCaches(
  dispatch: AppDispatch,
  boundary: SessionCacheBoundary,
): Promise<void> {
  if (boundary.reason !== "lost-grant" || !boundary.preserveCurrentScope) {
    clearLibraryScope(dispatch);
    clearBlobCache();
  }
  const work: Promise<unknown>[] = [];
  if (boundary.reason === "switch") {
    uploadService.resetForScope();
  } else if (boundary.reason === "lost-grant") {
    const { organizationId, userId } = boundary;
    if (organizationId) {
      work.push(
        uploadService.purgeOrganization(organizationId, userId),
        clearCachedNotes(organizationId),
      );
      if (userId) clearRecentItemsForOrganization(organizationId, userId);
    } else {
      uploadService.resetForScope();
    }
  } else {
    const { userId } = boundary;
    if (userId) {
      work.push(uploadService.purgeUser(userId));
      clearRecentItemsForUser(userId);
      clearStoredFilesFilters(userId);
    } else {
      uploadService.resetForScope();
    }
    work.push(clearNotesCache());
  }
  for (const result of await Promise.allSettled(work)) {
    if (result.status === "rejected")
      console.error("[auth] session cache cleanup failed", result.reason);
  }
}

/**
 * True while an edit of the user that no checkpoint covers would be lost: an open document, a
 * drain registry entry, or stored pending or dirty rows. Unreadable storage counts as holding one.
 * Scans storage, then rechecks live state, since typing can go on during the scan.
 */
export async function scanUnsyncedEdits(userId: string | null): Promise<boolean> {
  if (hasUnsyncedEdits(userId)) return true;
  if (!userId) return false;
  try {
    if (await discoverStoredPendingDocs(userId)) return true;
  } catch {
    return true;
  }
  return hasUnsyncedEdits(userId);
}

export interface PendingOrganization {
  id: string;
  /** Null when the user is no member of it now, so no switch reaches it. */
  organization: OrganizationSummary | null;
}

const LEFT_ORGANIZATION_LABEL = "an organization you no longer belong to";

/** The organizations' names as one phrase, such as "Acme and Globex", for a confirmation prompt. */
export function pendingOrganizationNames(pending: PendingOrganization[]): string {
  const names = new Set(
    pending.map(({ organization }) => organization?.name ?? LEFT_ORGANIZATION_LABEL),
  );
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format([...names]);
}

/** Names the organizations holding the user's unsynced edits, so a prompt can offer to go there. */
export function usePendingOrganizations(): () => Promise<PendingOrganization[]> {
  const userId = useAppSelector((state) => state.auth?.user?.id ?? null);
  const organizations = useAppSelector(selectOrganizations);

  return useCallback(async () => {
    if (!userId) return [];
    let ids: string[];
    try {
      ids = await listPendingOrganizations(userId);
    } catch {
      return [];
    }
    return ids.map((id) => ({
      id,
      organization: organizations.find((organization) => organization.id === id) ?? null,
    }));
  }, [organizations, userId]);
}

export interface SignOutOptions {
  /** The caller confirmed that edits no checkpoint covers yet may be lost. */
  discardUnsynced?: boolean;
  /** Where the tab lands signed out instead of `/auth`, in place of the current entry. */
  returnTo?: string;
}

/**
 * Returns false without signing out while realtime edits are unsynced, because the storage
 * teardown below makes their encrypted rows unreadable; callers name the organizations through
 * `usePendingOrganizations`, confirm, and retry with `discardUnsynced`.
 */
export function useSignOut(): (options?: SignOutOptions) => Promise<boolean> {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const userId = useAppSelector((state) => state.auth?.user?.id ?? null);

  return useCallback(
    async (options?: SignOutOptions) => {
      if (!options?.discardUnsynced && (await scanUnsyncedEdits(userId))) return false;
      void dispatch(cancelRecording());
      if (refreshToken) {
        const client = createClient(AuthService, unaryTransport);
        client.logout({ refreshToken }).catch(() => {});
      }
      if (userId) clearPendingDocsFor(userId);
      clearMemoryAccessToken();
      teardownStorageEncryption();
      void clearSessionCaches(dispatch, { reason: "sign-out", userId: userId ?? undefined });
      dispatch(logout());
      if (options?.returnTo) navigate(options.returnTo, { replace: true });
      else navigate("/auth");
      return true;
    },
    [dispatch, navigate, refreshToken, userId],
  );
}
