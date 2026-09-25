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
import { cancelRecording } from "@/features/recording/store/recordingThunks";
import { teardownStorageEncryption } from "@/shared/crypto/storageEncryption";

/** Caches outside the store that hold one organization's content; Redux state is reset by `withSessionScope`. */
export function clearSessionCaches(dispatch: AppDispatch): void {
  // The upload engine is module-level; cancel in-flight uploads before the tray projection resets.
  uploadService.cancelAll();
  clearLibraryScope(dispatch);
  clearBlobCache();
  clearNotesCache().catch(console.error);
}

export function useSignOut(): () => void {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);

  return useCallback(() => {
    void dispatch(cancelRecording());
    if (refreshToken) {
      const client = createClient(AuthService, unaryTransport);
      client.logout({ refreshToken }).catch(() => {});
    }
    clearMemoryAccessToken();
    teardownStorageEncryption();
    clearSessionCaches(dispatch);
    dispatch(logout());
    navigate("/auth");
  }, [dispatch, navigate, refreshToken]);
}
