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
    initialRotation?: number;
    onClose: () => void;
}

export function ImageEditor({ file, initialRotation, onClose }: ImageEditorProps) {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    const editor = useImageEditor({
        fileId: file.id,
        organizationId: organizationId || '',
        filename: file.filename,
        mimeType: file.mimeType,
        initialRotation,
    });

    const { isEditing, isImageReady, startEditing } = editor;

    // Start editing when image is ready
    useEffect(() => {
        if (!isEditing && isImageReady) {
            startEditing();
        }
    }, [isEditing, isImageReady, startEditing]);

    const handleCancel = useCallback(() => {
        editor.stopEditing();
        onClose();
    }, [editor, onClose]);

    const handleSaveClick = useCallback(() => {
        editor.openSaveDialog();
    }, [editor]);

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
            'imageEditor.flipH': editor.toggleFlipH,
            'imageEditor.flipV': editor.toggleFlipV,
            'imageEditor.crop': editor.toggleCrop,
            'imageEditor.applyCrop': () => {
                if (editor.cropActive && editor.cropRect) {
                    editor.applyCrop();
                }
            },
        },
        { enabled: editor.isEditing && !editor.isSaving }
    );

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
                onFlipH={editor.toggleFlipH}
                onFlipV={editor.toggleFlipV}
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
