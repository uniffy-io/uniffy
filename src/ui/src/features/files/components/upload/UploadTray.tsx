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
    Minus,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setTrayView,
    clearCompletedDownloads,
    type DownloadItem,
} from '@/features/files/store/uploadSlice';
import { uploadService } from '@/features/files/upload';
import type { UploadRecord } from '@/features/files/upload/uploadTypes';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatFileSize } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';

function DownloadItemRow({ item }: { item: DownloadItem }) {
    const isActive = item.status === 'downloading' || item.status === 'archiving';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed';

    return (
        <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
            <div className="flex-shrink-0">
                {isCompleted && (
                    <div className="w-8 h-8 rounded-full status-success flex items-center justify-center">
                        <Check size={16} weight="bold" className="text-[var(--status-success)]" />
                    </div>
                )}
                {isFailed && (
                    <div className="w-8 h-8 rounded-full status-error flex items-center justify-center">
                        <Warning size={16} weight="bold" className="text-[var(--status-error)]" />
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
                        <span className="text-xs text-[var(--status-error)] truncate">{item.error}</span>
                    )}
                </div>

                {isActive && (
                    <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${item.progress}%` }}
                        />
                    </div>
                )}
            </div>

            <div className="flex-shrink-0">
                {isActive && (
                    <span className="text-sm font-medium tabular-nums">{item.progress}%</span>
                )}
            </div>
        </div>
    );
}

function UploadRecordRow({ record, onCancel, onRetry }: { record: UploadRecord; onCancel?: () => void; onRetry?: () => void }) {
    const isActive = record.status === 'uploading' || record.status === 'completing';
    const isCompleted = record.status === 'completed';
    const isFailed = record.status === 'failed' || record.status === 'cancelled';

    return (
        <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
            <div className="flex-shrink-0">
                {isCompleted && (
                    <div className="w-8 h-8 rounded-full status-success flex items-center justify-center">
                        <Check size={16} weight="bold" className="text-[var(--status-success)]" />
                    </div>
                )}
                {isFailed && (
                    <div className="w-8 h-8 rounded-full status-error flex items-center justify-center">
                        <Warning size={16} weight="bold" className="text-[var(--status-error)]" />
                    </div>
                )}
                {isActive && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <ArrowsClockwise size={16} weight="bold" className="text-primary animate-spin" />
                    </div>
                )}
                {record.status === 'queued' && (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <CloudArrowUp size={16} weight="duotone" className="text-muted-foreground" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{record.filename}</p>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {formatFileSize(record.uploadedBytes)} / {formatFileSize(record.totalSize)}
                    </span>
                    {isFailed && record.error && (
                        <span className="text-xs text-[var(--status-error)] truncate">{record.error}</span>
                    )}
                </div>

                {isActive && (
                    <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${record.progress}%` }}
                        />
                    </div>
                )}
            </div>

            <div className="flex-shrink-0 flex items-center gap-2">
                {isActive && (
                    <>
                        <span className="text-sm font-medium tabular-nums">{record.progress}%</span>
                        <button
                            onClick={onCancel}
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

export function UploadTray() {
    const dispatch = useAppDispatch();
    const { isMobile } = useBreakpoint();

    const trayView = useAppSelector((state) => state.upload.trayView);
    const records = useAppSelector((state) => state.upload.records);
    const activeDownloads = useAppSelector((state) => state.upload.activeDownloads);
    const completedDownloads = useAppSelector((state) => state.upload.completedDownloads);
    const isDownloading = useAppSelector((state) => state.upload.isDownloading);

    const handleExpand = useCallback(() => {
        dispatch(setTrayView('expanded'));
    }, [dispatch]);

    const handleMinimize = useCallback(() => {
        dispatch(setTrayView('minimized'));
    }, [dispatch]);

    const handleHide = useCallback(() => {
        dispatch(setTrayView('hidden'));
    }, [dispatch]);

    const handleClearCompletedDownloads = useCallback(() => {
        dispatch(clearCompletedDownloads());
    }, [dispatch]);

    const activeUploads = records.filter((r) => r.status === 'uploading' || r.status === 'completing');
    const queuedUploads = records.filter((r) => r.status === 'queued');
    const failedUploads = records.filter((r) => r.status === 'failed' || r.status === 'cancelled');
    const completedUploads = records.filter((r) => r.status === 'completed');

    const activeDownloadItems = Object.values(activeDownloads);

    const hasUploads = records.length > 0;
    const hasDownloads = activeDownloadItems.length > 0 || completedDownloads.length > 0;
    const hasContent = hasUploads || hasDownloads;

    const isUploading = activeUploads.length > 0 || queuedUploads.length > 0;

    if (trayView === 'hidden' || !hasContent) return null;

    if (trayView === 'minimized') {
        const inFlightCount = activeUploads.length + queuedUploads.length;
        const downloadingCount = activeDownloadItems.length;
        const combinedProgress =
            activeUploads.length > 0
                ? Math.round(activeUploads.reduce((sum, r) => sum + r.progress, 0) / activeUploads.length)
                : null;

        return (
            <button
                onClick={handleExpand}
                className={cn(
                    'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-card border border-border shadow-lg px-4 py-2 hover:bg-muted/50 transition-colors animate-in slide-in-from-bottom-4 duration-200',
                    isMobile && 'right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))]',
                )}
                title="Show transfers"
            >
                {downloadingCount > 0 && inFlightCount === 0 ? (
                    <CloudArrowDown size={18} weight="duotone" className="text-primary animate-pulse" />
                ) : (
                    <CloudArrowUp size={18} weight="duotone" className="text-primary" />
                )}
                <span className="text-sm font-medium tabular-nums">
                    {inFlightCount > 0
                        ? `${inFlightCount} uploading${combinedProgress !== null ? ` · ${combinedProgress}%` : ''}`
                        : downloadingCount > 0
                            ? `${downloadingCount} downloading`
                            : 'Transfers'}
                </span>
            </button>
        );
    }

    const title = isUploading && isDownloading ? 'Transfers' : isDownloading && !isUploading ? 'Downloads' : 'Uploads';

    return (
        <div
            className={cn(
                'fixed bg-card border border-border shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-4 duration-200',
                isMobile
                    ? 'inset-x-0 bottom-0 w-full rounded-t-xl'
                    : 'bottom-4 right-4 w-96 rounded-xl',
            )}
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                    {isDownloading && !isUploading ? (
                        <CloudArrowDown size={20} weight="duotone" className="text-primary" />
                    ) : (
                        <CloudArrowUp size={20} weight="duotone" className="text-primary" />
                    )}
                    <span className="font-medium">{title}</span>
                    {(isUploading || isDownloading) && (
                        <span className="text-xs text-muted-foreground">
                            {isUploading && `${activeUploads.length + queuedUploads.length}↑`}
                            {isUploading && isDownloading && ' '}
                            {isDownloading && `${activeDownloadItems.length}↓`}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleMinimize}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title="Minimize"
                    >
                        <Minus size={18} className="text-muted-foreground" />
                    </button>
                    <button
                        onClick={handleHide}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title="Close"
                    >
                        <X size={18} className="text-muted-foreground" />
                    </button>
                </div>
            </div>

            <div className={cn('overflow-y-auto', isMobile ? 'max-h-[60vh]' : 'max-h-80')}>
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

                {activeUploads.length > 0 && (
                    <div>
                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
                            Uploading
                        </div>
                        {activeUploads.map((record) => (
                            <UploadRecordRow
                                key={record.id}
                                record={record}
                                onCancel={() => uploadService.cancel(record.id)}
                            />
                        ))}
                    </div>
                )}

                {queuedUploads.length > 0 && (
                    <div>
                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
                            Queued ({queuedUploads.length})
                        </div>
                        {queuedUploads.slice(0, 5).map((record) => (
                            <UploadRecordRow
                                key={record.id}
                                record={record}
                                onCancel={() => uploadService.cancel(record.id)}
                            />
                        ))}
                        {queuedUploads.length > 5 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                                +{queuedUploads.length - 5} more in queue
                            </div>
                        )}
                    </div>
                )}

                {failedUploads.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between px-3 py-1.5 status-error">
                            <span className="text-xs font-medium text-[var(--status-error)] uppercase tracking-wider">
                                Failed ({failedUploads.length})
                            </span>
                        </div>
                        {failedUploads.map((record) => (
                            <UploadRecordRow
                                key={record.id}
                                record={record}
                                onRetry={() => uploadService.retry(record.id)}
                            />
                        ))}
                    </div>
                )}

                {completedUploads.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between px-3 py-1.5 status-success">
                            <span className="text-xs font-medium text-[var(--status-success)] uppercase tracking-wider">
                                Uploaded ({completedUploads.length})
                            </span>
                        </div>
                        {completedUploads.slice(0, 5).map((record) => (
                            <UploadRecordRow key={record.id} record={record} />
                        ))}
                        {completedUploads.length > 5 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                                +{completedUploads.length - 5} more uploaded
                            </div>
                        )}
                    </div>
                )}

                {completedDownloads.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between px-3 py-1.5 status-success">
                            <span className="text-xs font-medium text-[var(--status-success)] uppercase tracking-wider">
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
            </div>
        </div>
    );
}
