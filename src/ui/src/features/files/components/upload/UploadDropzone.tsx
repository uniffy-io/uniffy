/**
 * Upload Dropzone Component
 *
 * Drag and drop zone for file uploads with click-to-browse support.
 */

import { useCallback, useRef, useState } from 'react';
import { CloudArrowUp } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { addToQueue } from '@/features/files/store/uploadSlice';
import { storeFile } from '@/features/files/utils/fileStore';

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
    const [isDragOver, setIsDragOver] = useState(false);

    const handleFiles = useCallback(
        (files: FileList | null) => {
            if (!files || files.length === 0) return;

            const fileArray = Array.from(files);
            const uploadItems = fileArray.map((file) => {
                const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                // Store File object separately (not in Redux - non-serializable)
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
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            handleFiles(e.dataTransfer.files);
        },
        [handleFiles]
    );

    const handleClick = useCallback(() => {
        inputRef.current?.click();
    }, []);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            handleFiles(e.target.files);
            // Reset input so same file can be selected again
            e.target.value = '';
        },
        [handleFiles]
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
                    {isDragOver ? "Drop files here" : "Drag & drop files"}
                </p>
                <p className="text-sm text-muted-foreground">
                    or click to browse
                </p>

                {/* Animated border on drag */}
                {isDragOver && (
                    <div className="absolute inset-0 rounded-xl border-2 border-primary animate-pulse pointer-events-none" />
                )}
            </div>
        </>
    );
}
