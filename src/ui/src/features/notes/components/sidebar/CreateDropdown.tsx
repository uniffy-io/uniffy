import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, FileText, SelectionAll, Folder, ArrowsClockwise } from "@phosphor-icons/react";

interface CreateDropdownProps {
  onCreateNote: () => void;
  onCreateCanvas: () => void;
  onCreateFolder: () => void;
  disabled?: boolean;
  creating?: boolean;
  compact?: boolean;
}

export function CreateDropdown({
  onCreateNote,
  onCreateCanvas,
  onCreateFolder,
  disabled = false,
  creating = false,
  compact = false,
}: CreateDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement | HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleAction = useCallback((action: () => void) => {
    setIsOpen(false);
    action();
  }, []);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (disabled || creating) return;

      if (!isOpen) {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
          const menuWidth = 160;
          const menuHeight = 130;
          const x = rect.right + menuWidth > window.innerWidth ? rect.left - menuWidth : rect.left;
          const y =
            rect.bottom + menuHeight > window.innerHeight ? rect.top - menuHeight : rect.bottom + 4;
          setMenuPos({ x, y });
        }
      }
      setIsOpen((prev) => !prev);
    },
    [disabled, creating, isOpen],
  );

  const renderMenu = () => {
    if (!isOpen) return null;

    return (
      <div
        ref={menuRef}
        className="fixed z-50 min-w-40 overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
        style={{ top: menuPos.y, left: menuPos.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-1">
          <button
            onClick={() => handleAction(onCreateNote)}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <FileText size={16} weight="duotone" className="text-muted-foreground" />
            Note
          </button>

          <button
            onClick={() => handleAction(onCreateCanvas)}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <SelectionAll size={16} weight="duotone" className="text-muted-foreground" />
            Canvas
          </button>

          <button
            onClick={() => handleAction(onCreateFolder)}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <Folder size={16} weight="duotone" className="text-muted-foreground" />
            Folder
          </button>
        </div>
      </div>
    );
  };

  if (compact) {
    return (
      <>
        <span
          ref={triggerRef as React.RefObject<HTMLSpanElement>}
          onClick={handleToggle}
          className="p-0.5 rounded hover:bg-muted cursor-pointer"
          title="Create new..."
        >
          <Plus size={14} weight="bold" className="text-muted-foreground" />
        </span>
        {renderMenu()}
      </>
    );
  }

  return (
    <>
      <button
        ref={triggerRef as React.RefObject<HTMLButtonElement>}
        onClick={handleToggle}
        disabled={disabled || creating}
        className="group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-300 ease-out overflow-hidden hover:px-2.5 disabled:opacity-50"
        title="Create new..."
      >
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
        <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out text-muted-foreground group-hover:text-primary">
          {creating ? (
            <ArrowsClockwise size={18} weight="bold" className="animate-spin" />
          ) : (
            <Plus size={18} weight="bold" />
          )}
        </span>
        <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
          New
        </span>
      </button>
      {renderMenu()}
    </>
  );
}
