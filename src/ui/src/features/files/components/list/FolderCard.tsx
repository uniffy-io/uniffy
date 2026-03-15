/**
 * Folder Card Component
 *
 * Displays a folder in grid or list view with actions.
 */

import { useState } from 'react';
import {
    Folder,
    BookmarkSimple,
    CheckSquare,
    Square,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useBookmarkToggle } from '@/features/bookmarks';
import type { SerializedTreeNode } from '@/features/files/store/filesTreeThunks';
import type { ICON_SIZE_CONFIG } from '@/features/files/components/list/constants';
import { RenameInput } from '@/features/files/components/list/RenameInput';
import { ItemContextMenu } from '@/features/files/components/list/ItemContextMenu';
import { formatFileSize } from '@/features/files/components/list/utils';

export interface FolderCardProps {
    folder: SerializedTreeNode;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onDownload: (id: string) => void;
    onShare: (id: string, name: string) => void;
    onRename: (id: string, newName: string) => void;
    onMove: (id: string) => void;
    viewMode: 'grid' | 'list';
    viewScope?: 'all' | 'personal' | 'shared' | 'organization';
    sizeConfig?: typeof ICON_SIZE_CONFIG[keyof typeof ICON_SIZE_CONFIG];
    isSelectMode: boolean;
    isChecked: boolean;
    onToggleCheck: (id: string, shiftKey: boolean) => void;
    canShare?: boolean;
}

export function FolderCard({
    folder,
    onOpen,
    onDelete,
    onDownload,
    onShare,
    onRename,
    onMove,
    viewMode,
    viewScope,
    sizeConfig,
    isSelectMode,
    isChecked,
    onToggleCheck,
    canShare = true,
}: FolderCardProps) {
    const showOwner = viewScope === 'shared' || viewScope === 'organization';
    const [isRenaming, setIsRenaming] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const config = sizeConfig || { cardMinWidth: 140, iconSize: 48, gap: 16, showDetails: true };

    // Bookmark state for folder
    const folderUrn = `urn:uniffy:content:FOLDER:${folder.id}`;
    const { isBookmarked, toggling: bookmarkToggling, toggle: toggleBookmark } = useBookmarkToggle(folderUrn);

    // Handle click based on select mode
    const handleClick = (e: React.MouseEvent) => {
        // Don't trigger if renaming
        if (isRenaming) return;

        // Prevent text selection on shift+click
        if (e.shiftKey) {
            e.preventDefault();
        }
        if (isSelectMode) {
            onToggleCheck(folder.id, e.shiftKey);
        } else {
            onOpen(folder.id);
        }
    };

    // Double-click always opens the folder
    const handleDoubleClick = () => {
        if (isRenaming) return;
        onOpen(folder.id);
    };

    // Right-click context menu
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleRenameClick = () => {
        setIsRenaming(true);
    };

    const handleRenameConfirm = (newName: string) => {
        onRename(folder.id, newName);
        setIsRenaming(false);
    };

    const handleRenameCancel = () => {
        setIsRenaming(false);
    };

    if (viewMode === 'list') {
        return (
            <div
                className={cn(
                    "flex items-center gap-3 md:gap-4 px-3 md:px-4 py-2.5 hover:bg-accent/50 transition-colors cursor-pointer border-b border-border group",
                    isChecked && "bg-primary/10",
                    isSelectMode && "select-none"
                )}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
            >
                {/* Checkbox (only visible in select mode) */}
                {isSelectMode && (
                    <div
                        className="flex-shrink-0 w-5 transition-all"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey) e.preventDefault();
                            onToggleCheck(folder.id, e.shiftKey);
                        }}
                    >
                        {isChecked ? (
                            <CheckSquare size={20} weight="fill" className="text-primary" />
                        ) : (
                            <Square size={20} weight="regular" className="text-muted-foreground hover:text-primary" />
                        )}
                    </div>
                )}

                {/* Icon */}
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                    <Folder size={24} weight="duotone" className="text-primary" />
                </div>

                {/* Name or Rename Input */}
                {isRenaming ? (
                    <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <RenameInput
                            initialValue={folder.name}
                            onConfirm={handleRenameConfirm}
                            onCancel={handleRenameCancel}
                            variant="list"
                        />
                    </div>
                ) : (
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{folder.name}</p>
                    </div>
                )}

                {/* Tags column placeholder (folders don't have tags, hidden on mobile/tablet) */}
                <div className="hidden lg:block w-36">
                    <span className="text-xs text-muted-foreground">--</span>
                </div>

                {/* Owner column placeholder (only in shared/organization views, hidden on mobile) */}
                {showOwner && (
                    <div className="hidden md:block w-28">
                        <span className="text-sm text-muted-foreground">--</span>
                    </div>
                )}

                {/* Size - show folder size */}
                <div className="w-24 text-right">
                    <span className="text-sm text-muted-foreground">
                        {folder.sizeBytes && folder.sizeBytes > 0
                            ? formatFileSize(folder.sizeBytes)
                            : '--'}
                    </span>
                </div>

                {/* Item count - hidden on mobile/tablet */}
                <div className="hidden lg:block w-20 text-right">
                    <span className="text-sm text-muted-foreground">
                        {folder.childCount > 0 ? folder.childCount : '--'}
                    </span>
                </div>

                {/* Modified - hidden on mobile */}
                <div className="hidden sm:block w-24 text-right">
                    <span className="text-sm text-muted-foreground">--</span>
                </div>

                {/* Context Menu */}
                {contextMenu && (
                    <ItemContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        onRename={handleRenameClick}
                        onDelete={() => onDelete(folder.id)}
                        onDownload={() => onDownload(folder.id)}
                        onShare={() => onShare(folder.id, folder.name)}
                        onBookmark={toggleBookmark}
                        isBookmarked={isBookmarked}
                        bookmarkToggling={bookmarkToggling}
                        onMove={() => onMove(folder.id)}
                        canShare={canShare}
                    />
                )}
            </div>
        );
    }

    // Grid view
    return (
        <div
            className={cn(
                "group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/30 hover:shadow-md transition-all cursor-pointer",
                isChecked && "ring-2 ring-primary border-primary bg-primary/5",
                isSelectMode && "select-none"
            )}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
        >
            {/* Preview area */}
            <div className="relative aspect-[4/3] bg-primary/5 flex items-center justify-center overflow-hidden">
                <Folder size={config.iconSize} weight="duotone" className="text-primary" />

                {/* Checkbox (only visible in select mode) */}
                {isSelectMode && (
                    <div
                        className="absolute top-2 left-2 z-20 transition-all"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey) e.preventDefault();
                            onToggleCheck(folder.id, e.shiftKey);
                        }}
                    >
                        {isChecked ? (
                            <div className="p-0.5 rounded bg-primary">
                                <CheckSquare size={18} weight="fill" className="text-primary-foreground" />
                            </div>
                        ) : (
                            <div className="p-0.5 rounded bg-black/40 hover:bg-black/60">
                                <Square size={18} weight="regular" className="text-white" />
                            </div>
                        )}
                    </div>
                )}

                {/* Bookmark indicator (always visible when bookmarked) */}
                {isBookmarked && !isChecked && (
                    <div className="absolute top-2 right-2 z-10">
                        <BookmarkSimple size={18} weight="fill" className="text-primary drop-shadow-md" />
                    </div>
                )}
            </div>

            {/* Folder info */}
            <div className={cn("p-2", config.iconSize >= 48 && "p-3")}>
                {isRenaming ? (
                    <div onClick={(e) => e.stopPropagation()}>
                        <RenameInput
                            initialValue={folder.name}
                            onConfirm={handleRenameConfirm}
                            onCancel={handleRenameCancel}
                            variant="grid"
                        />
                    </div>
                ) : (
                    <p
                        className={cn(
                            "font-medium truncate",
                            config.iconSize <= 32 ? "text-xs" : "text-sm"
                        )}
                        title={folder.name}
                    >
                        {folder.name}
                    </p>
                )}
                {config.showDetails && !isRenaming && (
                    <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                            {folder.childCount > 0 ? `${folder.childCount} items` : 'Empty'}
                            {folder.sizeBytes && folder.sizeBytes > 0 && ` - ${formatFileSize(folder.sizeBytes)}`}
                        </span>
                    </div>
                )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <ItemContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    onRename={handleRenameClick}
                    onDelete={() => onDelete(folder.id)}
                    onDownload={() => onDownload(folder.id)}
                    onShare={() => onShare(folder.id, folder.name)}
                    onBookmark={toggleBookmark}
                    isBookmarked={isBookmarked}
                    bookmarkToggling={bookmarkToggling}
                    onMove={() => onMove(folder.id)}
                    canShare={canShare}
                />
            )}
        </div>
    );
}
