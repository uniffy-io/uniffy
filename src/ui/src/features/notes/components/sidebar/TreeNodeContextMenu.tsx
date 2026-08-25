/**
 * Tree Node Context Menu Component
 *
 * Dropdown menu for tree node actions (rename, copy, move, delete).
 * Follows the same pattern as ItemContextMenu in the files feature.
 */

import { useEffect, useRef } from "react";
import { PencilSimple, Trash, CopySimple, ArrowRight, BookmarkSimple } from "@phosphor-icons/react";
import type { ActiveMenuState } from "@/features/notes/components/sidebar/types";
import { useBookmarkToggle } from "@/features/bookmarks";

interface TreeNodeContextMenuProps {
  menu: ActiveMenuState;
  onClose: () => void;
  onRename: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onCopy: (nodeId: string) => void;
  onMove: (nodeId: string) => void;
}

export function TreeNodeContextMenu({
  menu,
  onClose,
  onRename,
  onDelete,
  onCopy,
  onMove,
}: TreeNodeContextMenuProps) {
  const isBookmarkable = menu.nodeType === "note" || menu.nodeType === "canvas";
  const nodeUrn = isBookmarkable ? `urn:uniffy:content:NOTE:${menu.nodeId}` : "";
  const {
    isBookmarked,
    toggling: bookmarkToggling,
    toggle: toggleBookmark,
  } = useBookmarkToggle(nodeUrn);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
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
      className="fixed z-50 min-w-45 overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ top: menu.position.y, left: menu.position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="py-1">
        <button
          onClick={(e) => handleAction(() => onRename(menu.nodeId), e)}
          className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <PencilSimple size={16} className="text-primary" />
          Rename
        </button>

        <button
          onClick={(e) => handleAction(() => onCopy(menu.nodeId), e)}
          className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <CopySimple size={16} className="text-primary" />
          Copy
        </button>

        <button
          onClick={(e) => handleAction(() => onMove(menu.nodeId), e)}
          className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <ArrowRight size={16} className="text-primary" />
          Move to...
        </button>

        {isBookmarkable && (
          <button
            onClick={(e) => handleAction(toggleBookmark, e)}
            disabled={bookmarkToggling}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <BookmarkSimple
              size={16}
              weight={isBookmarked ? "fill" : "bold"}
              className="text-primary"
            />
            {isBookmarked ? "Remove bookmark" : "Bookmark"}
          </button>
        )}

        <div className="my-1 h-px bg-border" />

        <button
          onClick={(e) => handleAction(() => onDelete(menu.nodeId), e)}
          className="flex w-full items-center gap-3 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash size={16} className="text-destructive" />
          Delete
        </button>
      </div>
    </div>
  );
}
