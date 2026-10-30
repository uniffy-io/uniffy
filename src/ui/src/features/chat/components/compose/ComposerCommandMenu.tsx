import { useEffect, useRef } from "react";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import type { ComposerOption } from "@/features/chat/utils/composerCommands";

interface ComposerCommandMenuProps {
  id: string;
  options: ComposerOption[];
  activeIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (option: ComposerOption) => void;
  onClose: () => void;
}

export function ComposerCommandMenu({
  id,
  options,
  activeIndex,
  onHighlight,
  onSelect,
  onClose,
}: ComposerCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useOverlayEscape(onClose);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, options]);

  return (
    <div
      ref={menuRef}
      className={cn(
        popoverShellClass,
        "absolute bottom-full inset-x-0 z-50 mb-2 overflow-hidden rounded-xl sm:right-auto sm:w-[28rem] sm:max-w-full",
      )}
      data-testid="composer-command-menu"
    >
      <div
        id={id}
        role="listbox"
        aria-label="Chat commands"
        className="max-h-64 overflow-y-auto p-1"
      >
        {options.map((option, index) => {
          const Icon = option.icon;
          const groupStart = index === 0 || options[index - 1].kind !== option.kind;
          return (
            <div key={`${option.kind}:${option.id}`}>
              {groupStart && (
                <p
                  aria-hidden="true"
                  className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground"
                >
                  {option.kind === "skill" ? "Skills" : "Actions"}
                </p>
              )}
              <button
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(option)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  index === activeIndex ? "bg-primary/10" : "hover:bg-muted",
                )}
                data-testid="composer-command-option"
              >
                <Icon size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-sm text-foreground">
                      /{option.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{option.label}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground/80">
                    {option.description || "Add this skill to your message."}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {options.length === 0 && (
        <p role="status" className="px-4 pb-3 pt-2 text-sm text-muted-foreground">
          No matching commands. Keep typing to write a message.
        </p>
      )}
      <div className="hidden items-center justify-end gap-3 border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground/70 sm:flex">
        <span className="flex items-center gap-1">
          <kbd className="rounded bg-muted/50 px-1 py-0.5 font-mono">↑↓</kbd>
          <span>navigate</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded bg-muted/50 px-1 py-0.5 font-mono">↵</kbd>
          <span>select</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded bg-muted/50 px-1 py-0.5 font-mono">esc</kbd>
          <span>close</span>
        </span>
      </div>
    </div>
  );
}
