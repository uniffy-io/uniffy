import { useEffect, useRef } from 'react';
import {
    PencilSimple,
    Trash,
    Download,
    ShareNetwork,
    BookmarkSimple,
    Tag,
    ArrowRight,
    ArrowUUpLeft,
} from '@phosphor-icons/react';

interface ItemContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onRename: () => void;
    onDelete: () => void;
    onDownload: () => void;
    onShare: () => void;
    onBookmark?: () => void;
    isBookmarked?: boolean;
    bookmarkToggling?: boolean;
    onEditTags?: () => void;
    onMove?: () => void;
    canShare?: boolean;
    /** In trash mode, only Restore + Delete Permanently are shown. */
    trashMode?: boolean;
    onRestore?: () => void;
    /** Whether the restore action should render (hidden for folders inside a trashed ancestor). */
    canRestore?: boolean;
    /** When set, the Download item renders disabled with the given tooltip
     * (used while a server-side WebM -> MP4 transcode is in flight). */
    downloadDisabled?: boolean;
    downloadTooltip?: string | null;
}

export function ItemContextMenu({
    x,
    y,
    onClose,
    onRename,
    onDelete,
    onDownload,
    onShare,
    onBookmark,
    isBookmarked,
    bookmarkToggling,
    onEditTags,
    onMove,
    canShare = true,
    trashMode = false,
    onRestore,
    canRestore = true,
    downloadDisabled = false,
    downloadTooltip = null,
}: ItemContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    // Close on escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleAction = (action: () => void, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        action();
        onClose();
    };

    if (trashMode) {
        return (
            <div
                ref={menuRef}
                className="fixed z-50 min-w-[200px] overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
                style={{ top: y, left: x }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="py-1">
                    {canRestore && onRestore && (
                        <button
                            onClick={(e) => handleAction(onRestore, e)}
                            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                        >
                            <ArrowUUpLeft size={16} weight="bold" className="text-primary" />
                            Restore
                        </button>
                    )}

                    <button
                        onClick={(e) => downloadDisabled ? e.stopPropagation() : handleAction(onDownload, e)}
                        disabled={downloadDisabled}
                        title={downloadDisabled ? (downloadTooltip ?? '') : undefined}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={16} className="text-primary" />
                        Download
                    </button>

                    <div className="my-1 h-px bg-border" />

                    <button
                        onClick={(e) => handleAction(onDelete, e)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-600/10 dark:hover:bg-red-400/10 transition-colors"
                    >
                        <Trash size={16} className="text-red-600 dark:text-red-400" />
                        Delete Permanently
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: y, left: x }}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="py-1">
                <button
                    onClick={(e) => handleAction(onRename, e)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                    <PencilSimple size={16} className="text-primary" />
                    Rename
                </button>

                {onBookmark && (
                    <button
                        onClick={(e) => handleAction(onBookmark, e)}
                        disabled={bookmarkToggling}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                        <BookmarkSimple
                            size={16}
                            weight={isBookmarked ? 'fill' : 'duotone'}
                            className="text-primary"
                        />
                        {isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
                    </button>
                )}

                {onEditTags && (
                    <button
                        onClick={(e) => handleAction(onEditTags, e)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                        <Tag size={16} className="text-primary" />
                        Edit Tags
                    </button>
                )}

                {onMove && (
                    <button
                        onClick={(e) => handleAction(onMove, e)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                        <ArrowRight size={16} className="text-primary" />
                        Move to...
                    </button>
                )}

                {canShare && (
                    <button
                        onClick={(e) => handleAction(onShare, e)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                        <ShareNetwork size={16} className="text-primary" />
                        Share
                    </button>
                )}

                <button
                    onClick={(e) => downloadDisabled ? e.stopPropagation() : handleAction(onDownload, e)}
                    disabled={downloadDisabled}
                    title={downloadDisabled ? (downloadTooltip ?? '') : undefined}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Download size={16} className="text-primary" />
                    Download
                </button>

                <div className="my-1 h-px bg-border" />

                <button
                    onClick={(e) => handleAction(onDelete, e)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-600/10 dark:hover:bg-red-400/10 transition-colors"
                >
                    <Trash size={16} className="text-red-600 dark:text-red-400" />
                    Delete
                </button>
            </div>
        </div>
    );
}
