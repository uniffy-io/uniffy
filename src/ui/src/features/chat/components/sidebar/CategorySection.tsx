import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { CaretDown, Plus, PencilSimple, Trash, Check, X } from "@phosphor-icons/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch } from "@/app/hooks";
import { updateCategoryThunk, deleteCategoryThunk } from "@/features/chat/store/chatThunks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface CategorySectionProps {
  id?: string | null;
  name: string;
  defaultCollapsed?: boolean;
  unreadCount?: number;
  sortable?: boolean;
  canManage?: boolean;
  onAddChannel?: () => void;
  children: ReactNode;
}

export function CategorySection({
  id,
  name,
  defaultCollapsed = false,
  unreadCount = 0,
  sortable = false,
  canManage = false,
  onAddChannel,
  children,
}: CategorySectionProps) {
  const dispatch = useAppDispatch();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | "auto">("auto");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: id ?? "uncategorized",
    disabled: !sortable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (!collapsed) {
      setContentHeight(el.scrollHeight);
      const timer = setTimeout(() => setContentHeight("auto"), 200);
      return () => clearTimeout(timer);
    } else {
      setContentHeight(el.scrollHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setContentHeight(0);
        });
      });
    }
  }, [collapsed]);

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const handleStartEdit = useCallback(() => {
    setEditName(name);
    setIsEditing(true);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, [name]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name && id) {
      dispatch(updateCategoryThunk({ categoryId: id, name: trimmed }));
    }
    setIsEditing(false);
  }, [editName, name, id, dispatch]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName(name);
  }, [name]);

  const handleDelete = useCallback(() => {
    if (id) {
      dispatch(deleteCategoryThunk(id));
    }
    setShowDeleteConfirm(false);
  }, [id, dispatch]);

  const testidId = id ?? "uncategorized";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("mt-1", isDragging && "opacity-50 z-50")}
      data-testid={`chat-sidebar-category-${testidId}`}
      data-state={collapsed ? "collapsed" : "expanded"}
    >
      <div
        className={cn(
          "flex items-center w-full px-3 py-1.5 group",
          sortable && "cursor-grab active:cursor-grabbing",
        )}
        {...(sortable ? { ...attributes, ...listeners } : {})}
      >
        {isEditing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              ref={editInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit();
                if (e.key === "Escape") handleCancelEdit();
              }}
              className="flex-1 min-w-0 text-xs uppercase font-medium tracking-wider bg-input border border-border rounded px-1.5 py-0.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
              data-testid={`chat-sidebar-category-edit-input-${testidId}`}
            />
            <Check
              size={12}
              className="text-green-500 hover:text-green-400 cursor-pointer shrink-0"
              onClick={handleSaveEdit}
              data-testid={`chat-sidebar-category-edit-save-${testidId}`}
            />
            <X
              size={12}
              className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
              onClick={handleCancelEdit}
              data-testid={`chat-sidebar-category-edit-cancel-${testidId}`}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={handleToggle}
            className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground flex-1 min-w-0"
            data-testid={`chat-sidebar-category-toggle-${testidId}`}
          >
            <CaretDown
              size={10}
              className={cn(
                "transition-transform duration-200 ease-out shrink-0",
                collapsed && "-rotate-90",
              )}
            />
            <span className="truncate">{name}</span>
          </button>
        )}

        <span className="flex items-center gap-1 shrink-0">
          <span
            className={cn(
              "min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center",
              "transition-all duration-200",
              collapsed && unreadCount > 0
                ? "opacity-100 scale-100"
                : "opacity-0 scale-75 w-0 min-w-0 overflow-hidden",
            )}
            data-testid={`chat-sidebar-category-unread-badge-${testidId}`}
          >
            {unreadCount}
          </span>

          {canManage && id && !isEditing && (
            <>
              <PencilSimple
                size={12}
                className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150 hover:text-foreground cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit();
                }}
                data-testid={`chat-sidebar-category-edit-${id}`}
              />
              <Trash
                size={12}
                className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150 hover:text-red-400 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                data-testid={`chat-sidebar-category-delete-${id}`}
              />
            </>
          )}

          {onAddChannel && (
            <Plus
              size={14}
              className={cn(
                "text-muted-foreground transition-opacity duration-150 hover:text-foreground cursor-pointer",
                collapsed
                  ? "opacity-0 w-0 overflow-hidden"
                  : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onAddChannel();
              }}
              data-testid={`chat-sidebar-category-add-channel-${testidId}`}
            />
          )}
        </span>
      </div>

      <div
        ref={contentRef}
        className="overflow-hidden transition-[height,opacity] duration-200 ease-out"
        style={{
          height: collapsed ? 0 : contentHeight === "auto" ? "auto" : contentHeight,
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div className="space-y-px">{children}</div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Category"
        message={`Are you sure you want to delete "${name}"? Channels in this category will become uncategorized.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
