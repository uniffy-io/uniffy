import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CaretRight, DotsThreeOutline } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { expandNode, setSelectedNode } from "@/features/notes/store/notesTreeSlice";
import { setSidebarOpen } from "@/features/notes/store/editorSlice";
import type { BreadcrumbItem } from "@/features/notes/utils/notesTreeUtils";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

interface NoteBreadcrumbsProps {
  items: BreadcrumbItem[];
  noteAccessMode?: number;
  noteOwnerId?: string;
}

export function NoteBreadcrumbs({ items, noteAccessMode, noteOwnerId }: NoteBreadcrumbsProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isSidebarOpen = useAppSelector((state) => state.editor.isSidebarOpen);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const handleItemClick = useCallback(
    (item: BreadcrumbItem, itemIndex: number) => {
      if (itemIndex === items.length - 1) return;

      if (!isSidebarOpen) {
        dispatch(setSidebarOpen(true));
      }

      const sectionId =
        noteAccessMode === AccessMode.OPEN_TO_ORG
          ? "organization"
          : noteOwnerId !== currentUserId
            ? "shared"
            : "personal";
      dispatch(expandNode(sectionId));

      for (let i = 0; i <= itemIndex; i++) {
        if (items[i].isFolder) {
          dispatch(expandNode(items[i].id));
        }
      }

      dispatch(setSelectedNode(item.id));

      // Folders open the folder screen, parent notes their editor; the route
      // effect in NotesPage fetches the target.
      navigate(`/notes/${item.id}`);

      setTimeout(() => {
        const folderElement = document.querySelector(`[data-node-id="${item.id}"]`);
        if (folderElement) {
          folderElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    },
    [dispatch, navigate, items, isSidebarOpen, noteAccessMode, noteOwnerId, currentUserId],
  );

  if (items.length <= 3) {
    return (
      <nav className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = !isLast;
          return (
            <span key={item.id} className="flex items-center gap-1 min-w-0">
              {index > 0 && <CaretRight size={12} weight="bold" className="shrink-0" />}
              <span
                onClick={() => isClickable && handleItemClick(item, index)}
                className={`truncate max-w-[150px] ${isLast ? "text-foreground font-medium" : "hover:text-foreground cursor-pointer hover:underline"}`}
                title={item.title}
              >
                {item.title}
              </span>
            </span>
          );
        })}
      </nav>
    );
  }

  // 4+ items: show first, collapsed middle, last 2.
  const firstItem = items[0];
  const collapsedItems = items.slice(1, -2);
  const lastTwoItems = items.slice(-2);
  const lastTwoStartIndex = items.length - 2;

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
      <span
        onClick={() => handleItemClick(firstItem, 0)}
        className="truncate max-w-[120px] hover:text-foreground cursor-pointer hover:underline"
        title={firstItem.title}
      >
        {firstItem.title}
      </span>

      <CaretRight size={12} weight="bold" className="shrink-0" />

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors"
          title={`${collapsedItems.length} more folder${collapsedItems.length > 1 ? "s" : ""}`}
        >
          <DotsThreeOutline size={14} weight="fill" />
        </button>

        {isDropdownOpen && (
          <div
            className={cn(
              popoverShellClass,
              "absolute top-full left-0 mt-1 py-1 min-w-[160px] max-w-[240px] z-50",
            )}
          >
            {collapsedItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => {
                  handleItemClick(item, index + 1);
                  setIsDropdownOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted truncate"
                title={item.title}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <CaretRight size={12} weight="bold" className="shrink-0" />

      {lastTwoItems.map((item, index) => {
        const actualIndex = lastTwoStartIndex + index;
        const isLast = actualIndex === items.length - 1;
        const isClickable = !isLast;
        return (
          <span key={item.id} className="flex items-center gap-1 min-w-0">
            {index > 0 && <CaretRight size={12} weight="bold" className="shrink-0" />}
            <span
              onClick={() => isClickable && handleItemClick(item, actualIndex)}
              className={`truncate max-w-[150px] ${isLast ? "text-foreground font-medium" : "hover:text-foreground cursor-pointer hover:underline"}`}
              title={item.title}
            >
              {item.title}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
