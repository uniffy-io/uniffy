import { useState, useRef, useCallback } from "react";
import { Plus, FileText, SelectionAll, Folder, ArrowsClockwise } from "@phosphor-icons/react";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handleAction = useCallback((action: () => void) => {
    setIsOpen(false);
    action();
  }, []);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (disabled || creating) return;

      setIsOpen((prev) => !prev);
    },
    [disabled, creating],
  );

  const renderMenu = () => {
    if (!isOpen) return null;

    return (
      <ActionMenu
        open
        triggerRef={triggerRef}
        onClose={() => setIsOpen(false)}
        label="Create new"
        align="left"
      >
        <>
          <ActionMenuItem onClick={() => handleAction(onCreateNote)}>
            <FileText size={16} weight="duotone" className="text-muted-foreground" />
            Note
          </ActionMenuItem>

          <ActionMenuItem onClick={() => handleAction(onCreateCanvas)}>
            <SelectionAll size={16} weight="duotone" className="text-muted-foreground" />
            Canvas
          </ActionMenuItem>

          <ActionMenuItem onClick={() => handleAction(onCreateFolder)}>
            <Folder size={16} weight="duotone" className="text-muted-foreground" />
            Folder
          </ActionMenuItem>
        </>
      </ActionMenu>
    );
  };

  if (compact) {
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled || creating}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={handleToggle}
          className="focus-ring grid h-11 w-11 lg:h-6 lg:w-6 place-items-center rounded hover:bg-muted disabled:opacity-50"
          title="Create new..."
        >
          <Plus size={14} weight="bold" className="text-muted-foreground" />
        </button>
        {renderMenu()}
      </>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleToggle}
        disabled={disabled || creating}
        className="focus-ring group relative flex min-h-11 lg:min-h-0 items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-300 ease-out overflow-hidden hover:px-2.5 disabled:opacity-50"
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
