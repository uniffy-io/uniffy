import { useCallback } from "react";
import { createClient } from "@connectrpc/connect";
import { useNavigate } from "react-router-dom";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { AppDispatch } from "@/app/store";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { clearMemoryAccessToken, unaryTransport } from "@/config/api";
import { logout } from "@/features/auth/store/authSlice";
import { clearBlobCache } from "@/features/files/components/viewer/hooks/blobCache";
import { uploadService } from "@/features/files/upload";
import { clearLibraryScope } from "@/features/library/store/clearLibraryScope";
import { clearAllCache as clearNotesCache } from "@/features/notes/utils/notesCache";
import { clearPendingDocsFor, hasUnsyncedEdits } from "@/features/realtime";
import { cancelRecording } from "@/features/recording/store/recordingThunks";
import { teardownStorageEncryption } from "@/shared/crypto/storageEncryption";
import { discoverStoredPendingDocs } from "@/features/realtime/persistence/encryptedYjsPersistence";

/** Caches outside the store that hold one organization's content; Redux state is reset by `withSessionScope`. */
export function clearSessionCaches(dispatch: AppDispatch): void {
  uploadService.reset();
  clearLibraryScope(dispatch);
  clearBlobCache();
  clearNotesCache().catch(console.error);
}

export interface SignOutOptions {
  /** The caller confirmed that edits the server has not acknowledged may be lost. */
  discardUnsynced?: boolean;
}

/**
 * Returns false without signing out while realtime edits are unsynced, because the storage
 * teardown below makes their encrypted rows unreadable; callers confirm and retry with
 * `discardUnsynced`.
 */
export function useSignOut(): (options?: SignOutOptions) => Promise<boolean> {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const userId = useAppSelector((state) => state.auth?.user?.id ?? null);

  return useCallback(
    async (options?: SignOutOptions) => {
      if (!options?.discardUnsynced && hasUnsyncedEdits(userId)) return false;
      if (!options?.discardUnsynced && userId) {
        try {
          if (await discoverStoredPendingDocs(userId)) return false;
        } catch {
          return false;
        }
        if (hasUnsyncedEdits(userId)) return false;
      }
      void dispatch(cancelRecording());
      if (refreshToken) {
        const client = createClient(AuthService, unaryTransport);
        client.logout({ refreshToken }).catch(() => {});
      }
      if (userId) clearPendingDocsFor(userId);
      clearMemoryAccessToken();
      teardownStorageEncryption();
      clearSessionCaches(dispatch);
      dispatch(logout());
      navigate("/auth");
      return true;
    },
    [dispatch, navigate, refreshToken, userId],
  );
}
