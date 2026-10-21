import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import { uploadService } from "@/features/files/upload";
import { subscribeUploadMirror } from "@/features/files/upload/reduxMirror";
import { subscribeUploadErrorToasts } from "@/features/files/upload/uploadErrorToasts";
import { setTrayView } from "@/features/files/store/uploadSlice";

/** Wires the Redux mirror, failure toasts, the recall shortcut, and reload recovery. Renders nothing. */
export function UploadBoot() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => subscribeUploadMirror(dispatch), [dispatch]);
  useEffect(() => subscribeUploadErrorToasts(), []);

  useShortcutHandler("app.showUploads", () => dispatch(setTrayView("expanded")));

  // Each scope this tab enters resumes its own stored uploads; other scopes' records wait for theirs.
  useEffect(() => {
    if (userId && organizationId) {
      void uploadService.recover({ userId, organizationId });
    }
  }, [userId, organizationId]);

  return null;
}
