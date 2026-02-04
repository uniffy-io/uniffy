/**
 * Item Context Menu Component
 *
 * Right-click context menu for files and folders.
 */

import { useEffect, useRef } from 'react';
import {
    PencilSimple,
    Trash,
    Download,
    ShareNetwork,
    BookmarkSimple,
    Tag,
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
    canShare?: boolean;
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
    canShare = true,
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
                    <PencilSimple size={16} className="text-muted-foreground" />
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
                    onClick={(e) => handleAction(onDownload, e)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                    <Download size={16} className="text-muted-foreground" />
                    Download
                </button>

                <div className="my-1 h-px bg-border" />

                <button
                    onClick={(e) => handleAction(onDelete, e)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                    <Trash size={16} className="text-destructive" />
                    Delete
                </button>
            </div>
        </div>
    );
}
