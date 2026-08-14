import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setPdfWatermark } from "@/features/files/store/viewerSlice";
import { buildWatermarkedPdf } from "@/features/files/components/viewer/pdf/pdfStamp";
import { ensurePdfExtension, uploadPdfBlob } from "@/features/files/utils/uploadPdfBlob";
import { getCachedBlob } from "@/features/files/components/viewer/hooks/blobCache";
import { fetchFileBlob } from "@/features/files/components/viewer/hooks/useFileDownload";
import type { SerializedFile } from "@/features/files/store/filesThunks";

/** Bakes the pending viewer watermark into a saved copy. */
export function usePdfStamper(file: SerializedFile) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const watermark = useAppSelector((state) => state.fileViewer.pdfWatermark);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasStamps = Boolean(watermark?.text.trim());

  const save = useCallback(
    async (finalFilename: string, versionOfFileId?: string): Promise<boolean> => {
      if (!organizationId || !watermark) return false;
      setIsSaving(true);
      setSaveError(null);
      try {
        // The blob LRU usually holds the open document; the ranged path
        // (>16MB) downloads it once here.
        const cached = getCachedBlob(file.id);
        const sourceBlob =
          cached?.blob ??
          (await fetchFileBlob(file.id, organizationId).then((r) => r?.blob ?? null));
        if (!sourceBlob) throw new Error("Unable to load the source PDF");

        const stamped = await buildWatermarkedPdf(await sourceBlob.arrayBuffer(), watermark);
        await uploadPdfBlob(stamped, finalFilename, organizationId, dispatch, {
          versionOfFileId,
        });
        dispatch(setPdfWatermark(null));
        setIsSaving(false);
        return true;
      } catch (error) {
        setIsSaving(false);
        const message = error instanceof Error ? error.message : "Failed to save PDF";
        // Standard-font stamping only supports WinAnsi-encodable text.
        setSaveError(
          message.includes("WinAnsi") ? "Watermark text contains unsupported characters" : message,
        );
        return false;
      }
    },
    [organizationId, file.id, watermark, dispatch],
  );

  const saveAsNewFile = useCallback((name: string) => save(ensurePdfExtension(name)), [save]);
  const saveAsNewVersion = useCallback(
    () => save(file.filename, file.id),
    [save, file.filename, file.id],
  );

  return {
    hasStamps,
    isSaving,
    saveError,
    clearSaveError: () => setSaveError(null),
    saveAsNewFile,
    saveAsNewVersion,
  };
}
