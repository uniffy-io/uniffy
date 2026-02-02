/**
 * Upload Panel Component
 *
 * Floating panel showing upload progress and queue.
 */

import { useCallback } from 'react';
import {
    X,
    CloudArrowUp,
    CloudArrowDown,
    Check,
    Warning,
    ArrowsClockwise,
    ArrowCounterClockwise,
    FileZip,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setShowUploadPanel,
    abortUpload,
    retryUpload,
    clearCompleted,
    clearFailed,
    clearCompletedDownloads,
    type UploadItem,
    type DownloadItem,
} from '../../store/uploadSlice';

// Format file size
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function DownloadItemRow({ item }: { item: DownloadItem }) {
    const isActive = item.status === 'downloading' || item.status === 'archiving';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed';

    return (
        <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
            {/* Status icon */}
            <div className="flex-shrink-0">
                {isCompleted && (
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Check size={16} weight="bold" className="text-green-500" />
                    </div>
                )}
                {isFailed && (
                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                        <Warning size={16} weight="bold" className="text-red-500" />
                    </div>
                )}
                {item.status === 'archiving' && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <FileZip size={16} weight="bold" className="text-primary animate-pulse" />
                    </div>
                )}
                {item.status === 'downloading' && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <CloudArrowDown size={16} weight="bold" className="text-primary animate-pulse" />
                    </div>
                )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.filename}</p>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {item.status === 'archiving'
                            ? 'Creating archive...'
                            : item.fileCount > 1
                                ? `${item.currentFile}/${item.fileCount} files`
                                : item.currentFilename || 'Downloading...'
                        }
                    </span>
                    {isFailed && item.error && (
                        <span className="text-xs text-red-500 truncate">{item.error}</span>
                    )}
                </div>

                {/* Progress bar */}
                {isActive && (
                    <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${item.progress}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Progress percentage */}
            <div className="flex-shrink-0">
                {isActive && (
                    <span className="text-sm font-medium tabular-nums">{item.progress}%</span>
                )}
            </div>
        </div>
    );
}

function UploadItemRow({ item, onAbort, onRetry }: { item: UploadItem; onAbort?: () => void; onRetry?: () => void }) {
    const isActive = item.status === 'uploading' || item.status === 'initializing' || item.status === 'completing';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed' || item.status === 'aborted';

    return (
        <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
            {/* Status icon */}
            <div className="flex-shrink-0">
                {isCompleted && (
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Check size={16} weight="bold" className="text-green-500" />
                    </div>
                )}
                {isFailed && (
                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                        <Warning size={16} weight="bold" className="text-red-500" />
                    </div>
                )}
                {isActive && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <ArrowsClockwise size={16} weight="bold" className="text-primary animate-spin" />
                    </div>
                )}
                {item.status === 'queued' && (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <CloudArrowUp size={16} weight="duotone" className="text-muted-foreground" />
                    </div>
                )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.filename}</p>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {formatFileSize(item.uploadedBytes)} / {formatFileSize(item.totalSize)}
                    </span>
                    {isFailed && item.error && (
                        <span className="text-xs text-red-500 truncate">{item.error}</span>
                    )}
                </div>

                {/* Progress bar */}
                {isActive && (
                    <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${item.progress}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Progress percentage / Actions */}
            <div className="flex-shrink-0 flex items-center gap-2">
                {isActive && (
                    <>
                        <span className="text-sm font-medium tabular-nums">{item.progress}%</span>
                        <button
                            onClick={onAbort}
                            className="p-1 rounded hover:bg-destructive/10 transition-colors"
                            title="Cancel"
                        >
                            <X size={16} className="text-muted-foreground hover:text-destructive" />
                        </button>
                    </>
                )}
                {isFailed && onRetry && (
                    <button
                        onClick={onRetry}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title="Retry"
                    >
                        <ArrowCounterClockwise size={16} className="text-muted-foreground" />
                    </button>
                )}
            </div>
        </div>
    );
}

export function UploadPanel() {
    const dispatch = useAppDispatch();
    const showPanel = useAppSelector((state) => state.upload.showUploadPanel);
    const queue = useAppSelector((state) => state.upload.queue);
    const activeUploads = useAppSelector((state) => state.upload.activeUploads);
    const completedUploads = useAppSelector((state) => state.upload.completedUploads);
    const failedUploads = useAppSelector((state) => state.upload.failedUploads);
    const isUploading = useAppSelector((state) => state.upload.isUploading);

    // Download state
    const activeDownloads = useAppSelector((state) => state.upload.activeDownloads);
    const completedDownloads = useAppSelector((state) => state.upload.completedDownloads);
    const isDownloading = useAppSelector((state) => state.upload.isDownloading);

    const activeUploadItems = Object.values(activeUploads);
    const activeDownloadItems = Object.values(activeDownloads);
    const totalItems = queue.length + activeUploadItems.length + completedUploads.length + failedUploads.length + activeDownloadItems.length + completedDownloads.length;
    const hasItems = totalItems > 0;

    const handleClose = useCallback(() => {
        dispatch(setShowUploadPanel(false));
    }, [dispatch]);

    const handleAbort = useCallback(
        (itemId: string) => {
            dispatch(abortUpload(itemId));
        },
        [dispatch]
    );

    const handleRetry = useCallback(
        (itemId: string) => {
            dispatch(retryUpload(itemId));
        },
        [dispatch]
    );

    const handleClearCompleted = useCallback(() => {
        dispatch(clearCompleted());
    }, [dispatch]);

    const handleClearFailed = useCallback(() => {
        dispatch(clearFailed());
    }, [dispatch]);

    const handleClearCompletedDownloads = useCallback(() => {
        dispatch(clearCompletedDownloads());
    }, [dispatch]);

    if (!showPanel) return null;

    const hasActivity = isUploading || isDownloading;

    return (
        <div className="fixed bottom-4 right-4 w-96 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                    {isDownloading && !isUploading ? (
                        <CloudArrowDown size={20} weight="duotone" className="text-primary" />
                    ) : (
                        <CloudArrowUp size={20} weight="duotone" className="text-primary" />
                    )}
                    <span className="font-medium">
                        {isUploading && isDownloading ? 'Transfers' : isDownloading ? 'Downloads' : 'Uploads'}
                    </span>
                    {hasActivity && (
                        <span className="text-xs text-muted-foreground">
                            {isUploading && `${activeUploadItems.length + queue.length}↑`}
                            {isUploading && isDownloading && ' '}
                            {isDownloading && `${activeDownloadItems.length}↓`}
                        </span>
                    )}
                </div>
                <button
                    onClick={handleClose}
                    className="p-1 rounded hover:bg-muted transition-colors"
                >
                    <X size={18} className="text-muted-foreground" />
                </button>
            </div>

            {/* Content */}
            <div className="max-h-80 overflow-y-auto">
                {!hasItems ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <CloudArrowUp size={40} weight="duotone" className="mb-2 opacity-50" />
                        <p className="text-sm">No uploads</p>
                    </div>
                ) : (
                    <>
                        {/* Active downloads */}
                        {activeDownloadItems.length > 0 && (
                            <div>
                                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
                                    Downloading
                                </div>
                                {activeDownloadItems.map((item) => (
                                    <DownloadItemRow key={item.id} item={item} />
                                ))}
                            </div>
                        )}

                        {/* Active uploads */}
                        {activeUploadItems.length > 0 && (
                            <div>
                                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
                                    Uploading
                                </div>
                                {activeUploadItems.map((item) => (
                                    <UploadItemRow
                                        key={item.id}
                                        item={item}
                                        onAbort={() => handleAbort(item.id)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Queued */}
                        {queue.length > 0 && (
                            <div>
                                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
                                    Queued ({queue.length})
                                </div>
                                {queue.slice(0, 5).map((item) => (
                                    <UploadItemRow key={item.id} item={item} />
                                ))}
                                {queue.length > 5 && (
                                    <div className="px-3 py-2 text-xs text-muted-foreground">
                                        +{queue.length - 5} more in queue
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Failed */}
                        {failedUploads.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between px-3 py-1.5 bg-red-500/10">
                                    <span className="text-xs font-medium text-red-500 uppercase tracking-wider">
                                        Failed ({failedUploads.length})
                                    </span>
                                    <button
                                        onClick={handleClearFailed}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        Clear
                                    </button>
                                </div>
                                {failedUploads.map((item) => (
                                    <UploadItemRow
                                        key={item.id}
                                        item={item}
                                        onRetry={() => handleRetry(item.id)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Completed uploads */}
                        {completedUploads.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between px-3 py-1.5 bg-green-500/10">
                                    <span className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">
                                        Uploaded ({completedUploads.length})
                                    </span>
                                    <button
                                        onClick={handleClearCompleted}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        Clear
                                    </button>
                                </div>
                                {completedUploads.slice(0, 5).map((item) => (
                                    <UploadItemRow key={item.id} item={item} />
                                ))}
                                {completedUploads.length > 5 && (
                                    <div className="px-3 py-2 text-xs text-muted-foreground">
                                        +{completedUploads.length - 5} more uploaded
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Completed downloads */}
                        {completedDownloads.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between px-3 py-1.5 bg-green-500/10">
                                    <span className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">
                                        Downloaded ({completedDownloads.length})
                                    </span>
                                    <button
                                        onClick={handleClearCompletedDownloads}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        Clear
                                    </button>
                                </div>
                                {completedDownloads.slice(0, 5).map((item) => (
                                    <DownloadItemRow key={item.id} item={item} />
                                ))}
                                {completedDownloads.length > 5 && (
                                    <div className="px-3 py-2 text-xs text-muted-foreground">
                                        +{completedDownloads.length - 5} more downloaded
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
