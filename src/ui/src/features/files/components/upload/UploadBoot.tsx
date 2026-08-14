import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import { uploadService } from "@/features/files/upload";
import { subscribeUploadMirror } from "@/features/files/upload/reduxMirror";
import { subscribeUploadErrorToasts } from "@/features/files/upload/uploadErrorToasts";
import { setTrayView } from "@/features/files/store/uploadSlice";

let recovered = false;

/** Wires the Redux mirror, failure toasts, the recall shortcut, and reload recovery. Renders nothing. */
export function UploadBoot() {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => subscribeUploadMirror(dispatch), [dispatch]);
  useEffect(() => subscribeUploadErrorToasts(), []);

  useShortcutHandler("app.showUploads", () => dispatch(setTrayView("expanded")));

  useEffect(() => {
    if (organizationId && !recovered) {
      recovered = true;
      void uploadService.recover();
    }
  }, [organizationId]);

  return null;
}
