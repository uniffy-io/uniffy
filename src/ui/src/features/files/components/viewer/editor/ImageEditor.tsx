/**
 * Image Editor Component
 *
 * Main editor component that orchestrates all editing functionality.
 * Combines EditorToolbar, EditorCanvas, and SaveDialog.
 */

import { useEffect, useCallback } from 'react';
import { useAppSelector } from '@/app/hooks';
import { EditorCanvas } from '@/features/files/components/viewer/editor/EditorCanvas';
import { EditorToolbar } from '@/features/files/components/viewer/editor/EditorToolbar';
import { SaveDialog } from '@/features/files/components/viewer/editor/SaveDialog';
import type { ImageFormat } from '@/features/files/components/viewer/editor/SaveDialog';
import { useImageEditor } from '@/features/files/hooks/useImageEditor';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import { useShortcutHandlers } from '@/features/settings';

interface ImageEditorProps {
    file: SerializedFile;
    onClose: () => void;
}

export function ImageEditor({ file, onClose }: ImageEditorProps) {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    const editor = useImageEditor({
        fileId: file.id,
        organizationId: organizationId || '',
        filename: file.filename,
        mimeType: file.mimeType,
    });

    // Debug logging
    console.log('[ImageEditor] State:', {
        isEditing: editor.isEditing,
        isImageReady: editor.isImageReady,
        imageLoading: editor.imageLoading,
        imageUrl: editor.imageUrl,
    });

    // Start editing when image is ready
    useEffect(() => {
        console.log('[ImageEditor] Effect - checking start conditions:', {
            isEditing: editor.isEditing,
            isImageReady: editor.isImageReady,
        });
        if (!editor.isEditing && editor.isImageReady) {
            console.log('[ImageEditor] Calling startEditing');
            editor.startEditing();
        }
    }, [editor.isEditing, editor.isImageReady, editor.startEditing]);

    // Handle cancel - exit edit mode and close
    const handleCancel = useCallback(() => {
        editor.stopEditing();
        onClose();
    }, [editor, onClose]);

    // Handle save button click - open save dialog
    const handleSaveClick = useCallback(() => {
        editor.openSaveDialog();
    }, [editor]);

    // Handle save as new file
    const handleSaveAsNew = useCallback(
        async (filename: string, format: ImageFormat, quality: number) => {
            const success = await editor.saveAsNewFile(filename, format, quality);
            if (success) {
                onClose();
            }
            return success;
        },
        [editor, onClose]
    );

    // Handle save as new version
    const handleSaveAsVersion = useCallback(
        async (format: ImageFormat, quality: number) => {
            const success = await editor.saveAsNewVersion(format, quality);
            if (success) {
                onClose();
            }
            return success;
        },
        [editor, onClose]
    );

    // Keyboard shortcuts
    useShortcutHandlers(
        {
            'imageEditor.undo': editor.undo,
            'imageEditor.redo': editor.redo,
            'imageEditor.save': () => {
                if (editor.hasChanges && !editor.isSaving) {
                    editor.openSaveDialog();
                }
            },
            'imageEditor.cancel': () => {
                if (editor.cropActive) {
                    editor.cancelCrop();
                } else if (editor.showSaveDialog) {
                    editor.closeSaveDialog();
                } else {
                    handleCancel();
                }
            },
            'imageEditor.rotateRight': editor.rotateRight,
            'imageEditor.rotateLeft': editor.rotateLeft,
            'imageEditor.flipH': editor.flipH,
            'imageEditor.flipV': editor.flipV,
            'imageEditor.crop': editor.toggleCrop,
            'imageEditor.applyCrop': () => {
                if (editor.cropActive && editor.cropRect) {
                    editor.applyCrop();
                }
            },
        },
        { enabled: editor.isEditing && !editor.isSaving }
    );

    // Show loading state while image is loading
    if (editor.imageLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="animate-pulse w-12 h-12 rounded-full bg-white/10" />
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col bg-black/20">
            {/* Editor Toolbar */}
            <EditorToolbar
                rotation={editor.rotation}
                flipH={editor.flipH}
                flipV={editor.flipV}
                brightness={editor.brightness}
                contrast={editor.contrast}
                cropActive={editor.cropActive}
                cropRect={editor.cropRect}
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                hasChanges={editor.hasChanges}
                isSaving={editor.isSaving}
                onRotateLeft={editor.rotateLeft}
                onRotateRight={editor.rotateRight}
                onFlipH={editor.flipH}
                onFlipV={editor.flipV}
                onBrightnessChange={editor.setBrightness}
                onBrightnessCommit={editor.commitBrightness}
                onContrastChange={editor.setContrast}
                onContrastCommit={editor.commitContrast}
                onToggleCrop={editor.toggleCrop}
                onApplyCrop={editor.applyCrop}
                onCancelCrop={editor.cancelCrop}
                onUndo={editor.undo}
                onRedo={editor.redo}
                onReset={editor.reset}
                onSave={handleSaveClick}
                onCancel={handleCancel}
            />

            {/* Editor Canvas */}
            <EditorCanvas
                imageUrl={editor.imageUrl}
                loading={editor.imageLoading}
                rotation={editor.rotation}
                flipH={editor.flipH}
                flipV={editor.flipV}
                brightness={editor.brightness}
                contrast={editor.contrast}
                cropActive={editor.cropActive}
                cropRect={editor.cropRect}
                isCropped={editor.isCropped}
                onCropChange={editor.setCropRect}
            />

            {/* Save Dialog */}
            <SaveDialog
                isOpen={editor.showSaveDialog}
                onClose={editor.closeSaveDialog}
                onSaveAsNew={handleSaveAsNew}
                onSaveAsVersion={handleSaveAsVersion}
                originalFilename={file.filename}
                originalMimeType={file.mimeType}
                isSaving={editor.isSaving}
                error={editor.saveError}
            />
        </div>
    );
}
