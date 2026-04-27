/**
 * Upload Dropzone Component
 *
 * Drag and drop zone for file and folder uploads with click-to-browse support.
 * Detects dropped folders and triggers the folder upload flow.
 */

import { useCallback, useRef, useState } from 'react';
import { CloudArrowUp, FolderOpen } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { addToQueue } from '@/features/files/store/uploadSlice';
import { storeFile } from '@/features/files/utils/fileStore';
import {
    hasDroppedFolders,
    scanDroppedItems,
    scanInputFiles,
    isFolderUploadSupported,
} from '@/features/files/utils/folderScanner';
import { useFolderUpload } from '@/features/files/hooks/useFolderUpload';
import { FolderUploadConfirmDialog } from '@/features/files/components/FolderUploadConfirmDialog';

interface UploadDropzoneProps {
    folderId?: string;
    onFilesSelected?: (files: File[]) => void;
    className?: string;
    compact?: boolean;
}

export function UploadDropzone({
    folderId,
    onFilesSelected,
    className,
    compact = false,
}: UploadDropzoneProps) {
    const dispatch = useAppDispatch();
    const inputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const folderSupported = isFolderUploadSupported();

    const {
        scanResult,
        showConfirm,
        openConfirmDialog,
        cancelUpload,
        confirmUpload,
    } = useFolderUpload();

    const handleFiles = useCallback(
        (files: FileList | null) => {
            if (!files || files.length === 0) return;

            const fileArray = Array.from(files);
            const uploadItems = fileArray.map((file) => {
                const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                storeFile(id, file);
                return {
                    id,
                    filename: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    totalSize: file.size,
                    folderId,
                };
            });

            dispatch(addToQueue(uploadItems));
            onFilesSelected?.(fileArray);
        },
        [dispatch, folderId, onFilesSelected]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);

            // Check if drop contains folders
            if (hasDroppedFolders(e.dataTransfer)) {
                const result = await scanDroppedItems(e.dataTransfer);
                if (result.files.length > 0) {
                    openConfirmDialog(result, folderId);
                }
                return;
            }

            handleFiles(e.dataTransfer.files);
        },
        [handleFiles, openConfirmDialog, folderId]
    );

    const handleClick = useCallback(() => {
        inputRef.current?.click();
    }, []);

    const handleFolderClick = useCallback(() => {
        folderInputRef.current?.click();
    }, []);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            handleFiles(e.target.files);
            e.target.value = '';
        },
        [handleFiles]
    );

    const handleFolderChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            if (!e.target.files || e.target.files.length === 0) return;
            const result = scanInputFiles(e.target.files);
            if (result.files.length > 0) {
                openConfirmDialog(result, folderId);
            }
            e.target.value = '';
        },
        [openConfirmDialog, folderId]
    );

    if (compact) {
        return (
            <>
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    onChange={handleChange}
                    className="hidden"
                />
                <input
                    ref={folderInputRef}
                    type="file"
                    onChange={handleFolderChange}
                    className="hidden"
                    {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
                />
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleClick}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed transition-all",
                            isDragOver
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-primary/50 hover:bg-muted/50",
                            className
                        )}
                    >
                        <CloudArrowUp size={20} weight="duotone" className="text-primary" />
                        <span className="text-sm font-medium">Upload files</span>
                    </button>
                    {folderSupported && (
                        <button
                            onClick={handleFolderClick}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed transition-all",
                                "border-border hover:border-primary/50 hover:bg-muted/50",
                            )}
                        >
                            <FolderOpen size={20} weight="duotone" className="text-primary" />
                            <span className="text-sm font-medium">Upload folder</span>
                        </button>
                    )}
                </div>

                <FolderUploadConfirmDialog
                    open={showConfirm}
                    scanResult={scanResult}
                    onConfirm={confirmUpload}
                    onCancel={cancelUpload}
                />
            </>
        );
    }

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                multiple
                onChange={handleChange}
                className="hidden"
            />
            <input
                ref={folderInputRef}
                type="file"
                onChange={handleFolderChange}
                className="hidden"
                {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
            />
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "relative flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer",
                    isDragOver
                        ? "border-primary bg-primary/5 scale-[1.02]"
                        : "border-border hover:border-primary/50 hover:bg-muted/30",
                    className
                )}
            >
                <div
                    className={cn(
                        "flex items-center justify-center w-16 h-16 rounded-full mb-4 transition-colors",
                        isDragOver ? "bg-primary/20" : "bg-muted"
                    )}
                >
                    <CloudArrowUp
                        size={32}
                        weight="duotone"
                        className={cn(
                            "transition-colors",
                            isDragOver ? "text-primary" : "text-muted-foreground"
                        )}
                    />
                </div>

                <p className="text-lg font-medium mb-1">
                    {isDragOver ? "Drop files or folders here" : "Drag & drop files or folders"}
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                    or click to browse files
                </p>

                {folderSupported && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleFolderClick();
                        }}
                        className="text-sm text-primary hover:underline"
                    >
                        Or select a folder to upload
                    </button>
                )}

                {isDragOver && (
                    <div className="absolute inset-0 rounded-xl border-2 border-primary animate-pulse pointer-events-none" />
                )}
            </div>

            <FolderUploadConfirmDialog
                open={showConfirm}
                scanResult={scanResult}
                onConfirm={confirmUpload}
                onCancel={cancelUpload}
            />
        </>
    );
}
