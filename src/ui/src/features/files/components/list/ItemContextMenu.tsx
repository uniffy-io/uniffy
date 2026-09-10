import {
  PencilSimple,
  Trash,
  Download,
  ShareNetwork,
  BookmarkSimple,
  Tag,
  ArrowRight,
  ArrowUUpLeft,
} from "@phosphor-icons/react";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";

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
  canDelete?: boolean;
  canEdit?: boolean;
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
  canDelete = true,
  canEdit = true,
  trashMode = false,
  onRestore,
  canRestore = true,
  downloadDisabled = false,
  downloadTooltip = null,
}: ItemContextMenuProps) {
  const handleAction = (action: () => void, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    action();
    onClose();
  };

  if (trashMode) {
    return (
      <ActionMenu open position={{ x, y }} onClose={onClose} label="Trash actions">
        {canRestore && onRestore && (
          <ActionMenuItem onClick={(e) => handleAction(onRestore, e)}>
            <ArrowUUpLeft size={16} weight="bold" className="text-primary" />
            Restore
          </ActionMenuItem>
        )}

        <ActionMenuItem
          onClick={(e) => (downloadDisabled ? e.stopPropagation() : handleAction(onDownload, e))}
          disabled={downloadDisabled}
          title={downloadDisabled ? (downloadTooltip ?? "") : undefined}
        >
          <Download size={16} className="text-primary" />
          Download
        </ActionMenuItem>

        <ActionMenuSeparator />

        <ActionMenuItem onClick={(e) => handleAction(onDelete, e)} destructive>
          <Trash size={16} className="text-red-600 dark:text-red-400" />
          Delete Permanently
        </ActionMenuItem>
      </ActionMenu>
    );
  }

  return (
    <ActionMenu open position={{ x, y }} onClose={onClose} label="File actions">
      {canEdit && (
        <ActionMenuItem onClick={(e) => handleAction(onRename, e)}>
          <PencilSimple size={16} className="text-primary" />
          Rename
        </ActionMenuItem>
      )}

      {onBookmark && (
        <ActionMenuItem onClick={(e) => handleAction(onBookmark, e)} disabled={bookmarkToggling}>
          <BookmarkSimple
            size={16}
            weight={isBookmarked ? "fill" : "duotone"}
            className="text-primary"
          />
          {isBookmarked ? "Remove Bookmark" : "Add Bookmark"}
        </ActionMenuItem>
      )}

      {onEditTags && canEdit && (
        <ActionMenuItem onClick={(e) => handleAction(onEditTags, e)}>
          <Tag size={16} className="text-primary" />
          Edit Tags
        </ActionMenuItem>
      )}

      {onMove && canEdit && (
        <ActionMenuItem onClick={(e) => handleAction(onMove, e)}>
          <ArrowRight size={16} className="text-primary" />
          Move to...
        </ActionMenuItem>
      )}

      {canShare && (
        <ActionMenuItem onClick={(e) => handleAction(onShare, e)}>
          <ShareNetwork size={16} className="text-primary" />
          Share
        </ActionMenuItem>
      )}

      <ActionMenuItem
        onClick={(e) => (downloadDisabled ? e.stopPropagation() : handleAction(onDownload, e))}
        disabled={downloadDisabled}
        title={downloadDisabled ? (downloadTooltip ?? "") : undefined}
      >
        <Download size={16} className="text-primary" />
        Download
      </ActionMenuItem>

      {canDelete && (
        <>
          <ActionMenuSeparator />

          <ActionMenuItem onClick={(e) => handleAction(onDelete, e)} destructive>
            <Trash size={16} className="text-red-600 dark:text-red-400" />
            Delete
          </ActionMenuItem>
        </>
      )}
    </ActionMenu>
  );
}
