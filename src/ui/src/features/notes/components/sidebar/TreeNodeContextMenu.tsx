import { PencilSimple, Trash, CopySimple, ArrowRight, BookmarkSimple } from "@phosphor-icons/react";
import type { ActiveMenuState } from "@/features/notes/components/sidebar/types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
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
  const handleAction = (action: () => void, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    action();
    onClose();
  };

  return (
    <ActionMenu open position={menu.position} onClose={onClose} label="Note actions">
      <ActionMenuItem onClick={(e) => handleAction(() => onRename(menu.nodeId), e)}>
        <PencilSimple size={16} className="text-primary" />
        Rename
      </ActionMenuItem>

      <ActionMenuItem onClick={(e) => handleAction(() => onCopy(menu.nodeId), e)}>
        <CopySimple size={16} className="text-primary" />
        Copy
      </ActionMenuItem>

      <ActionMenuItem onClick={(e) => handleAction(() => onMove(menu.nodeId), e)}>
        <ArrowRight size={16} className="text-primary" />
        Move to...
      </ActionMenuItem>

      {isBookmarkable && (
        <ActionMenuItem
          onClick={(e) => handleAction(toggleBookmark, e)}
          disabled={bookmarkToggling}
        >
          <BookmarkSimple
            size={16}
            weight={isBookmarked ? "fill" : "bold"}
            className="text-primary"
          />
          {isBookmarked ? "Remove bookmark" : "Bookmark"}
        </ActionMenuItem>
      )}

      <ActionMenuSeparator />

      <ActionMenuItem onClick={(e) => handleAction(() => onDelete(menu.nodeId), e)} destructive>
        <Trash size={16} className="text-destructive" />
        Delete
      </ActionMenuItem>
    </ActionMenu>
  );
}
