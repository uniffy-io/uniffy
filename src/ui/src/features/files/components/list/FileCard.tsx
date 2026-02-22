/**
 * File Card Component
 *
 * Displays a file in grid or list view with actions.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BookmarkSimple,
    CheckSquare,
    Square,
    Hash,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useBookmarkToggle } from '@/features/bookmarks';
import { TagInput } from '@/components/tag-input';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import type { ICON_SIZE_CONFIG } from '@/features/files/components/list/constants';
import { renderFileIcon, formatFileSize, formatDate, supportsThumbnail } from '@/features/files/components/list/utils';
import { ItemContextMenu } from '@/features/files/components/list/ItemContextMenu';
import { RenameInput } from '@/features/files/components/list/RenameInput';
import { ThumbnailImage } from '@/features/files/components/list/ThumbnailImage';
import { getInitials } from '@/components/subject/utils';

export interface FileCardProps {
    file: SerializedFile;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onDownload: (id: string) => void;
    onShare: (id: string, filename: string) => void;
    onRename: (id: string, newName: string) => void;
    onUpdateTags: (id: string, tags: string[]) => void;
    onMove: (id: string) => void;
    viewMode: 'grid' | 'list';
    viewScope?: 'all' | 'personal' | 'shared' | 'organization';
    sizeConfig?: typeof ICON_SIZE_CONFIG[keyof typeof ICON_SIZE_CONFIG];
    isSelectMode: boolean;
    isChecked: boolean;
    onToggleCheck: (id: string, shiftKey: boolean) => void;
    canShare?: boolean;
}

export function FileCard({
    file,
    isSelected,
    onSelect,
    onOpen,
    onDelete,
    onDownload,
    onShare,
    onRename,
    onUpdateTags,
    onMove,
    viewMode,
    viewScope,
    sizeConfig,
    isSelectMode,
    isChecked,
    onToggleCheck,
    canShare = true,
}: FileCardProps) {
    const navigate = useNavigate();
    const showOwner = viewScope === 'shared' || viewScope === 'organization';
    const [isRenaming, setIsRenaming] = useState(false);
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const tagsPopoverRef = useRef<HTMLDivElement>(null);
    const hasThumbnail = supportsThumbnail(file.mimeType);
    const config = sizeConfig || { cardMinWidth: 140, iconSize: 48, gap: 16, showDetails: true };

    // Bookmark state
    const fileUrn = `urn:uniffy:content:FILE:${file.id}`;
    const { isBookmarked, toggling: bookmarkToggling, toggle: toggleBookmark } = useBookmarkToggle(fileUrn);

    // Close tags popover on outside click
    useEffect(() => {
        if (!isEditingTags) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (tagsPopoverRef.current && !tagsPopoverRef.current.contains(e.target as Node)) {
                setIsEditingTags(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isEditingTags]);

    // Close tags popover on escape
    useEffect(() => {
        if (!isEditingTags) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsEditingTags(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isEditingTags]);

    const handleTagsChange = (newTags: string[]) => {
        onUpdateTags(file.id, newTags);
    };

    const handleTagClick = (tag: string) => {
        navigate(`/files/tags?tag=${encodeURIComponent(tag)}`);
    };

    const handleEditTagsClick = () => {
        setIsEditingTags(true);
    };

    // Handle single click - select file (for details panel)
    const handleClick = (e: React.MouseEvent) => {
        // Don't trigger if renaming
        if (isRenaming) return;

        // Prevent text selection on shift+click
        if (e.shiftKey) {
            e.preventDefault();
        }
        if (isSelectMode) {
            onToggleCheck(file.id, e.shiftKey);
        } else {
            onSelect(file.id);
        }
    };

    // Handle double click - open file viewer
    const handleDoubleClick = (e: React.MouseEvent) => {
        // Don't trigger if renaming or in select mode
        if (isRenaming || isSelectMode) return;
        e.preventDefault();
        onOpen(file.id);
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
        onRename(file.id, newName);
        setIsRenaming(false);
    };

    const handleRenameCancel = () => {
        setIsRenaming(false);
    };

    if (viewMode === 'list') {
        return (
            <div
                className={cn(
                    "flex items-center gap-4 px-4 py-2.5 hover:bg-accent/50 transition-colors cursor-pointer border-b border-border group",
                    isSelected && !isSelectMode && "bg-accent",
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
                            onToggleCheck(file.id, e.shiftKey);
                        }}
                    >
                        {isChecked ? (
                            <CheckSquare size={20} weight="fill" className="text-primary" />
                        ) : (
                            <Square size={20} weight="regular" className="text-muted-foreground hover:text-primary" />
                        )}
                    </div>
                )}

                {/* Icon or Thumbnail */}
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center overflow-hidden rounded">
                    {hasThumbnail ? (
                        <ThumbnailImage
                            file={file}
                            fallback={renderFileIcon(file.mimeType, 24, "text-primary")}
                        />
                    ) : (
                        renderFileIcon(file.mimeType, 24, "text-primary")
                    )}
                </div>

                {/* Name or Rename Input */}
                {isRenaming ? (
                    <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <RenameInput
                            initialValue={file.filename}
                            onConfirm={handleRenameConfirm}
                            onCancel={handleRenameCancel}
                            variant="list"
                        />
                    </div>
                ) : (
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.filename}</p>
                        {file.description && (
                            <p className="text-xs text-muted-foreground truncate">{file.description}</p>
                        )}
                    </div>
                )}

                {/* Tags */}
                <div className="w-36 relative">
                    {isEditingTags ? (
                        <div
                            ref={tagsPopoverRef}
                            className="absolute z-50 top-0 right-0 p-3 bg-card border border-border rounded-lg shadow-lg min-w-[200px]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <TagInput
                                tags={file.tags || []}
                                onTagsChange={handleTagsChange}
                                onTagClick={handleTagClick}
                            />
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 overflow-hidden">
                            {file.tags && file.tags.length > 0 ? (
                                <>
                                    {file.tags.slice(0, 2).map((tag) => (
                                        <span
                                            key={tag}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleTagClick(tag);
                                            }}
                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-full bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer transition-colors truncate max-w-[60px]"
                                            title={tag}
                                        >
                                            <Hash size={10} weight="bold" />
                                            <span className="truncate">{tag}</span>
                                        </span>
                                    ))}
                                    {file.tags.length > 2 && (
                                        <span className="text-xs text-muted-foreground">
                                            +{file.tags.length - 2}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Owner (only in shared/organization views) */}
                {showOwner && (
                    <div className="w-28 flex items-center gap-2">
                        <div
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                            title={file.ownerInfo?.name || file.ownerInfo?.email || 'Unknown'}
                        >
                            {file.ownerInfo?.name
                                ? getInitials(file.ownerInfo.name)
                                : (file.ownerInfo?.email?.slice(0, 2).toUpperCase() || '??')}
                        </div>
                        <span className="text-sm text-muted-foreground truncate">
                            {file.ownerInfo?.name?.split(' ')[0] || file.ownerInfo?.email?.split('@')[0] || 'Unknown'}
                        </span>
                    </div>
                )}

                {/* Size */}
                <div className="w-24 text-right">
                    <span className="text-sm text-muted-foreground">
                        {formatFileSize(file.sizeBytes)}
                    </span>
                </div>

                {/* Items - files don't have items */}
                <div className="w-20 text-right">
                    <span className="text-sm text-muted-foreground">--</span>
                </div>

                {/* Date */}
                <div className="w-24 text-right">
                    <span className="text-sm text-muted-foreground">
                        {formatDate(file.updatedAt)}
                    </span>
                </div>

                {/* Context Menu */}
                {contextMenu && (
                    <ItemContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        onRename={handleRenameClick}
                        onDelete={() => onDelete(file.id)}
                        onDownload={() => onDownload(file.id)}
                        onShare={() => onShare(file.id, file.filename)}
                        onBookmark={toggleBookmark}
                        isBookmarked={isBookmarked}
                        bookmarkToggling={bookmarkToggling}
                        onEditTags={handleEditTagsClick}
                        onMove={() => onMove(file.id)}
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
                isSelected && !isSelectMode && "ring-2 ring-primary border-primary",
                isChecked && "ring-2 ring-primary border-primary bg-primary/5",
                isSelectMode && "select-none"
            )}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
        >
            {/* Preview area */}
            <div className="relative aspect-[4/3] bg-muted/30 flex items-center justify-center overflow-hidden">
                {hasThumbnail ? (
                    <ThumbnailImage
                        file={file}
                        fallback={
                            <div className="w-full h-full flex items-center justify-center">
                                {renderFileIcon(file.mimeType, config.iconSize, "text-primary")}
                            </div>
                        }
                    />
                ) : (
                    renderFileIcon(file.mimeType, config.iconSize, "text-primary")
                )}

                {/* Checkbox (only visible in select mode) */}
                {isSelectMode && (
                    <div
                        className="absolute top-2 left-2 z-20 transition-all"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey) e.preventDefault();
                            onToggleCheck(file.id, e.shiftKey);
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

            {/* File info */}
            <div className={cn("p-2", config.iconSize >= 48 && "p-3")}>
                {isRenaming ? (
                    <div onClick={(e) => e.stopPropagation()}>
                        <RenameInput
                            initialValue={file.filename}
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
                        title={file.filename}
                    >
                        {file.filename}
                    </p>
                )}
                {config.showDetails && !isRenaming && (
                    <>
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-muted-foreground">
                                {formatFileSize(file.sizeBytes)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {formatDate(file.updatedAt)}
                            </span>
                        </div>
                        {/* Tags display */}
                        {file.tags && file.tags.length > 0 && (
                            <div className="flex items-center gap-1 mt-2 flex-wrap">
                                {file.tags.slice(0, 3).map((tag) => (
                                    <span
                                        key={tag}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleTagClick(tag);
                                        }}
                                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer transition-colors"
                                        title={tag}
                                    >
                                        <Hash size={8} weight="bold" />
                                        <span className="truncate max-w-[50px]">{tag}</span>
                                    </span>
                                ))}
                                {file.tags.length > 3 && (
                                    <span className="text-[10px] text-muted-foreground">
                                        +{file.tags.length - 3}
                                    </span>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Tags Edit Popover (Grid view) */}
            {isEditingTags && (
                <div
                    ref={tagsPopoverRef}
                    className="absolute z-50 bottom-full left-0 mb-2 p-3 bg-card border border-border rounded-lg shadow-lg min-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <TagInput
                        tags={file.tags || []}
                        onTagsChange={handleTagsChange}
                        onTagClick={handleTagClick}
                    />
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <ItemContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    onRename={handleRenameClick}
                    onDelete={() => onDelete(file.id)}
                    onDownload={() => onDownload(file.id)}
                    onShare={() => onShare(file.id, file.filename)}
                    onBookmark={toggleBookmark}
                    isBookmarked={isBookmarked}
                    bookmarkToggling={bookmarkToggling}
                    onEditTags={handleEditTagsClick}
                    onMove={() => onMove(file.id)}
                    canShare={canShare}
                />
            )}
        </div>
    );
}
