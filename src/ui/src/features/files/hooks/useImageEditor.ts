/**
 * Image Editor Hook
 *
 * Provides editor logic and state management for the image editor.
 * Handles canvas operations, transforms, and export functionality.
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
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
} from '@/features/files/store/imageEditorSlice';
import type { CropRect } from '@/features/files/store/imageEditorSlice';
import {
    loadImageToCanvas,
    applyAllTransforms,
    exportCanvasToBlob,
    getCssFilter,
    getCssTransform,
} from '@/features/files/utils/imageEditing';
import { useFileDownload } from '@/features/files/components/viewer/hooks/useFileDownload';
import { filesApi } from '@/features/files/api/filesApi';

interface UseImageEditorOptions {
    fileId: string;
    organizationId: string;
    filename: string;
    mimeType: string;
}

/**
 * Hook for image editor functionality.
 */
export function useImageEditor(options: UseImageEditorOptions) {
    const { fileId, organizationId, filename, mimeType } = options;
    const dispatch = useAppDispatch();

    // Get editor state from Redux
    const editorState = useAppSelector((state) => state.imageEditor);
    const canUndo = useAppSelector(selectCanUndo);
    const canRedo = useAppSelector(selectCanRedo);
    const hasChanges = useAppSelector(selectHasChanges);

    // Get the image URL from file download hook
    const { url: downloadedImageUrl, loading: downloadLoading, error: downloadError } = useFileDownload(fileId);

    // Debug logging
    console.log('[useImageEditor] Download state:', {
        fileId,
        downloadedImageUrl: downloadedImageUrl ? 'exists' : null,
        downloadLoading,
        downloadError,
    });

    // Local state for canvas reference
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    // Track if the downloaded URL is ready (not just loading=false, but URL is actually available)
    const isImageReady = !downloadLoading && !!downloadedImageUrl;

    console.log('[useImageEditor] isImageReady:', isImageReady);

    // Enter edit mode when image is available
    const startEditing = useCallback(() => {
        if (downloadedImageUrl) {
            dispatch(enterEditMode({ imageUrl: downloadedImageUrl }));
        }
    }, [dispatch, downloadedImageUrl]);

    // Exit edit mode
    const stopEditing = useCallback(() => {
        dispatch(exitEditMode());
    }, [dispatch]);

    // Transform actions
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

    // Adjustment actions
    const handleBrightnessChange = useCallback(
        (value: number) => {
            dispatch(setBrightness(value));
        },
        [dispatch]
    );

    const handleBrightnessCommit = useCallback(() => {
        dispatch(commitBrightness());
    }, [dispatch]);

    const handleContrastChange = useCallback(
        (value: number) => {
            dispatch(setContrast(value));
        },
        [dispatch]
    );

    const handleContrastCommit = useCallback(() => {
        dispatch(commitContrast());
    }, [dispatch]);

    // Crop actions
    const handleToggleCrop = useCallback(() => {
        dispatch(toggleCropTool());
    }, [dispatch]);

    const handleSetCropActive = useCallback(
        (active: boolean) => {
            dispatch(setCropActive(active));
        },
        [dispatch]
    );

    const handleSetCropRect = useCallback(
        (rect: CropRect | null) => {
            dispatch(setCropRect(rect));
        },
        [dispatch]
    );

    const handleApplyCrop = useCallback(() => {
        dispatch(applyCrop());
    }, [dispatch]);

    const handleCancelCrop = useCallback(() => {
        dispatch(cancelCrop());
    }, [dispatch]);

    // History actions
    const handleUndo = useCallback(() => {
        dispatch(undo());
    }, [dispatch]);

    const handleRedo = useCallback(() => {
        dispatch(redo());
    }, [dispatch]);

    const handleReset = useCallback(() => {
        dispatch(resetToOriginal());
    }, [dispatch]);

    // Save dialog actions
    const handleOpenSaveDialog = useCallback(() => {
        dispatch(openSaveDialog());
    }, [dispatch]);

    const handleCloseSaveDialog = useCallback(() => {
        dispatch(closeSaveDialog());
    }, [dispatch]);

    /**
     * Export the edited image as a Blob.
     */
    const exportImage = useCallback(
        async (format: 'image/png' | 'image/jpeg', quality: number = 0.92): Promise<Blob> => {
            if (!editorState.originalImageUrl) {
                throw new Error('No image loaded');
            }

            setIsProcessing(true);
            try {
                // Load original image
                const originalCanvas = await loadImageToCanvas(editorState.originalImageUrl);

                // Apply all transforms
                const resultCanvas = applyAllTransforms(originalCanvas, {
                    rotation: editorState.rotation,
                    flipH: editorState.flipH,
                    flipV: editorState.flipV,
                    brightness: editorState.brightness,
                    contrast: editorState.contrast,
                    cropRect: editorState.isCropped ? editorState.cropRect : null,
                });

                // Export to blob
                return await exportCanvasToBlob(resultCanvas, format, quality);
            } finally {
                setIsProcessing(false);
            }
        },
        [editorState]
    );

    /**
     * Save as a new file.
     */
    const saveAsNewFile = useCallback(
        async (newFilename: string, format: 'image/png' | 'image/jpeg', quality: number = 0.92) => {
            dispatch(setSaving(true));
            try {
                const blob = await exportImage(format, quality);

                // Create File object from blob
                const extension = format === 'image/png' ? 'png' : 'jpg';
                const finalFilename = newFilename.includes('.')
                    ? newFilename
                    : `${newFilename}.${extension}`;
                const file = new File([blob], finalFilename, { type: format });

                // Calculate chunk size (1MB chunks)
                const CHUNK_SIZE = 1024 * 1024;
                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

                // Initiate upload
                const initResponse = await filesApi.initiateUpload({
                    organizationId,
                    filename: finalFilename,
                    sizeBytes: BigInt(file.size),
                    mimeType: format,
                });

                const uploadId = initResponse.uploadId;

                // Upload chunks
                for (let i = 0; i < totalChunks; i++) {
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(start + CHUNK_SIZE, file.size);
                    const chunk = file.slice(start, end);
                    const arrayBuffer = await chunk.arrayBuffer();

                    await filesApi.uploadChunk({
                        uploadId,
                        chunkIndex: i,
                        data: new Uint8Array(arrayBuffer),
                    });
                }

                // Complete upload
                await filesApi.completeUpload({ uploadId });

                dispatch(setSaving(false));
                dispatch(closeSaveDialog());
                dispatch(exitEditMode());

                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to save file';
                dispatch(setSaveError(message));
                return false;
            }
        },
        [dispatch, exportImage, organizationId]
    );

    /**
     * Save as a new version of the current file.
     * Note: This requires backend support for file versioning.
     * For now, it creates a new file with the same name.
     */
    const saveAsNewVersion = useCallback(
        async (format: 'image/png' | 'image/jpeg', quality: number = 0.92) => {
            dispatch(setSaving(true));
            try {
                const blob = await exportImage(format, quality);

                // Create File object from blob
                const extension = format === 'image/png' ? 'png' : 'jpg';

                // Extract base filename without extension
                const baseName = filename.replace(/\.[^/.]+$/, '');
                const finalFilename = `${baseName}.${extension}`;
                const file = new File([blob], finalFilename, { type: format });

                // Calculate chunk size (1MB chunks)
                const CHUNK_SIZE = 1024 * 1024;
                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

                // Initiate upload
                const initResponse = await filesApi.initiateUpload({
                    organizationId,
                    filename: finalFilename,
                    sizeBytes: BigInt(file.size),
                    mimeType: format,
                });

                const uploadId = initResponse.uploadId;

                // Upload chunks
                for (let i = 0; i < totalChunks; i++) {
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(start + CHUNK_SIZE, file.size);
                    const chunk = file.slice(start, end);
                    const arrayBuffer = await chunk.arrayBuffer();

                    await filesApi.uploadChunk({
                        uploadId,
                        chunkIndex: i,
                        data: new Uint8Array(arrayBuffer),
                    });
                }

                // Complete upload
                await filesApi.completeUpload({ uploadId });

                dispatch(setSaving(false));
                dispatch(closeSaveDialog());
                dispatch(exitEditMode());

                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to save file';
                dispatch(setSaveError(message));
                return false;
            }
        },
        [dispatch, exportImage, organizationId, filename]
    );

    // Get CSS filter for live preview
    const previewFilter = getCssFilter(editorState.brightness, editorState.contrast);

    // Get CSS transform for live preview
    const previewTransform = getCssTransform(
        editorState.rotation,
        editorState.flipH,
        editorState.flipV
    );

    return {
        // State
        isEditing: editorState.isEditing,
        isProcessing,
        isSaving: editorState.isSaving,
        saveError: editorState.saveError,
        showSaveDialog: editorState.showSaveDialog,
        imageUrl: editorState.originalImageUrl,
        imageLoading: downloadLoading || !downloadedImageUrl, // Still loading if download in progress OR URL not yet available
        isImageReady,

        // Transform state
        rotation: editorState.rotation,
        flipH: editorState.flipH,
        flipV: editorState.flipV,
        brightness: editorState.brightness,
        contrast: editorState.contrast,

        // Crop state
        cropActive: editorState.cropActive,
        cropRect: editorState.cropRect,
        isCropped: editorState.isCropped,

        // History state
        canUndo,
        canRedo,
        hasChanges,

        // Preview helpers
        previewFilter,
        previewTransform,

        // Actions
        startEditing,
        stopEditing,
        rotateRight: handleRotateRight,
        rotateLeft: handleRotateLeft,
        flipH: handleFlipH,
        flipV: handleFlipV,
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

        // Export
        exportImage,
        saveAsNewFile,
        saveAsNewVersion,

        // Refs
        canvasRef,
    };
}
