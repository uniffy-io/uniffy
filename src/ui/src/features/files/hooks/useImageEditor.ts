import { useCallback, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  enterEditMode,
  exitEditMode,
  rotateRight,
  rotateLeft,
  toggleFlipH,
  toggleFlipV,
  setBrightness,
  commitBrightness,
  setContrast,
  commitContrast,
  toggleCropTool,
  setCropActive,
  setCropRect,
  applyCrop,
  cancelCrop,
  undo,
  redo,
  resetToOriginal,
  openSaveDialog,
  closeSaveDialog,
  setSaving,
  setSaveError,
  selectCanUndo,
  selectCanRedo,
  selectHasChanges,
} from "@/features/files/store/imageEditorSlice";
import type { CropRect } from "@/features/files/store/imageEditorSlice";
import {
  loadImageToCanvas,
  applyAllTransforms,
  exportCanvasToBlob,
  getCssFilter,
  getCssTransform,
} from "@/features/files/utils/imageEditing";
import { useFileDownload } from "@/features/files/components/viewer/hooks/useFileDownload";
import { filesApi } from "@/features/files/api/filesApi";

interface UseImageEditorOptions {
  fileId: string;
  organizationId: string;
  filename: string;
  mimeType: string;
  initialRotation?: number;
}

export function useImageEditor(options: UseImageEditorOptions) {
  const { fileId, organizationId, filename, initialRotation } = options;
  const dispatch = useAppDispatch();

  const editorState = useAppSelector((state) => state.imageEditor);
  const canUndo = useAppSelector(selectCanUndo);
  const canRedo = useAppSelector(selectCanRedo);
  const hasChanges = useAppSelector(selectHasChanges);

  const { url: downloadedImageUrl, loading: downloadLoading } = useFileDownload(fileId);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isImageReady = !downloadLoading && !!downloadedImageUrl;

  const startEditing = useCallback(() => {
    if (downloadedImageUrl) {
      dispatch(enterEditMode({ imageUrl: downloadedImageUrl, initialRotation }));
    }
  }, [dispatch, downloadedImageUrl, initialRotation]);

  const stopEditing = useCallback(() => {
    dispatch(exitEditMode());
  }, [dispatch]);

  const handleRotateRight = useCallback(() => {
    dispatch(rotateRight());
  }, [dispatch]);

  const handleRotateLeft = useCallback(() => {
    dispatch(rotateLeft());
  }, [dispatch]);

  const handleFlipH = useCallback(() => {
    dispatch(toggleFlipH());
  }, [dispatch]);

  const handleFlipV = useCallback(() => {
    dispatch(toggleFlipV());
  }, [dispatch]);

  const handleBrightnessChange = useCallback(
    (value: number) => {
      dispatch(setBrightness(value));
    },
    [dispatch],
  );

  const handleBrightnessCommit = useCallback(() => {
    dispatch(commitBrightness());
  }, [dispatch]);

  const handleContrastChange = useCallback(
    (value: number) => {
      dispatch(setContrast(value));
    },
    [dispatch],
  );

  const handleContrastCommit = useCallback(() => {
    dispatch(commitContrast());
  }, [dispatch]);

  const handleToggleCrop = useCallback(() => {
    dispatch(toggleCropTool());
  }, [dispatch]);

  const handleSetCropActive = useCallback(
    (active: boolean) => {
      dispatch(setCropActive(active));
    },
    [dispatch],
  );

  const handleSetCropRect = useCallback(
    (rect: CropRect | null) => {
      dispatch(setCropRect(rect));
    },
    [dispatch],
  );

  const handleApplyCrop = useCallback(() => {
    dispatch(applyCrop());
  }, [dispatch]);

  const handleCancelCrop = useCallback(() => {
    dispatch(cancelCrop());
  }, [dispatch]);

  const handleUndo = useCallback(() => {
    dispatch(undo());
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    dispatch(redo());
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch(resetToOriginal());
  }, [dispatch]);

  const handleOpenSaveDialog = useCallback(() => {
    dispatch(openSaveDialog());
  }, [dispatch]);

  const handleCloseSaveDialog = useCallback(() => {
    dispatch(closeSaveDialog());
  }, [dispatch]);

  const exportImage = useCallback(
    async (format: "image/png" | "image/jpeg", quality: number = 0.92): Promise<Blob> => {
      if (!editorState.originalImageUrl) {
        throw new Error("No image loaded");
      }

      setIsProcessing(true);
      try {
        const originalCanvas = await loadImageToCanvas(editorState.originalImageUrl);

        const resultCanvas = applyAllTransforms(originalCanvas, {
          rotation: editorState.rotation,
          flipH: editorState.flipH,
          flipV: editorState.flipV,
          brightness: editorState.brightness,
          contrast: editorState.contrast,
          cropRect: editorState.isCropped ? editorState.cropRect : null,
        });

        return await exportCanvasToBlob(resultCanvas, format, quality);
      } finally {
        setIsProcessing(false);
      }
    },
    [editorState],
  );

  const saveAsNewFile = useCallback(
    async (newFilename: string, format: "image/png" | "image/jpeg", quality: number = 0.92) => {
      dispatch(setSaving(true));
      try {
        const blob = await exportImage(format, quality);

        const extension = format === "image/png" ? "png" : "jpg";
        const finalFilename = newFilename.includes(".")
          ? newFilename
          : `${newFilename}.${extension}`;
        const file = new File([blob], finalFilename, { type: format });

        if (file.size === 0) {
          throw new Error("Export produced an empty image");
        }

        const initResponse = await filesApi.initiateUpload({
          organizationId,
          filename: finalFilename,
          totalSize: BigInt(file.size),
          mimeType: format,
        });

        const uploadId = initResponse.uploadId;
        const chunkSize = initResponse.chunkSize;
        const totalChunks = initResponse.totalChunks;

        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);
          const arrayBuffer = await chunk.arrayBuffer();

          await filesApi.uploadChunk({
            uploadId,
            chunkNumber: i + 1,
            data: new Uint8Array(arrayBuffer),
          });
        }

        await filesApi.completeUpload({ uploadId });

        dispatch(setSaving(false));
        dispatch(closeSaveDialog());
        dispatch(exitEditMode());

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save file";
        dispatch(setSaveError(message));
        return false;
      }
    },
    [dispatch, exportImage, organizationId],
  );

  const saveAsNewVersion = useCallback(
    async (format: "image/png" | "image/jpeg", quality: number = 0.92) => {
      dispatch(setSaving(true));
      try {
        const blob = await exportImage(format, quality);

        const extension = format === "image/png" ? "png" : "jpg";

        const baseName = filename.replace(/\.[^/.]+$/, "");
        const finalFilename = `${baseName}.${extension}`;
        const file = new File([blob], finalFilename, { type: format });

        if (file.size === 0) {
          throw new Error("Export produced an empty image");
        }

        const initResponse = await filesApi.initiateUpload({
          organizationId,
          filename: finalFilename,
          totalSize: BigInt(file.size),
          mimeType: format,
        });

        const uploadId = initResponse.uploadId;
        const chunkSize = initResponse.chunkSize;
        const totalChunks = initResponse.totalChunks;

        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);
          const arrayBuffer = await chunk.arrayBuffer();

          await filesApi.uploadChunk({
            uploadId,
            chunkNumber: i + 1,
            data: new Uint8Array(arrayBuffer),
          });
        }

        // A new version swaps the bytes on the existing file row; the
        // backend requires the MIME type to stay the same.
        await filesApi.completeUpload({ uploadId, versionOfFileId: fileId });

        dispatch(setSaving(false));
        dispatch(closeSaveDialog());
        dispatch(exitEditMode());

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save file";
        dispatch(setSaveError(message));
        return false;
      }
    },
    [dispatch, exportImage, organizationId, filename, fileId],
  );

  const previewFilter = getCssFilter(editorState.brightness, editorState.contrast);

  const previewTransform = getCssTransform(
    editorState.rotation,
    editorState.flipH,
    editorState.flipV,
  );

  return {
    isEditing: editorState.isEditing,
    isProcessing,
    isSaving: editorState.isSaving,
    saveError: editorState.saveError,
    showSaveDialog: editorState.showSaveDialog,
    imageUrl: editorState.originalImageUrl,
    imageLoading: downloadLoading || !downloadedImageUrl,
    isImageReady,

    rotation: editorState.rotation,
    flipH: editorState.flipH,
    flipV: editorState.flipV,
    brightness: editorState.brightness,
    contrast: editorState.contrast,

    cropActive: editorState.cropActive,
    cropRect: editorState.cropRect,
    isCropped: editorState.isCropped,

    canUndo,
    canRedo,
    hasChanges,

    previewFilter,
    previewTransform,

    startEditing,
    stopEditing,
    rotateRight: handleRotateRight,
    rotateLeft: handleRotateLeft,
    toggleFlipH: handleFlipH,
    toggleFlipV: handleFlipV,
    setBrightness: handleBrightnessChange,
    commitBrightness: handleBrightnessCommit,
    setContrast: handleContrastChange,
    commitContrast: handleContrastCommit,
    toggleCrop: handleToggleCrop,
    setCropActive: handleSetCropActive,
    setCropRect: handleSetCropRect,
    applyCrop: handleApplyCrop,
    cancelCrop: handleCancelCrop,
    undo: handleUndo,
    redo: handleRedo,
    reset: handleReset,
    openSaveDialog: handleOpenSaveDialog,
    closeSaveDialog: handleCloseSaveDialog,

    exportImage,
    saveAsNewFile,
    saveAsNewVersion,

    canvasRef,
  };
}
