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
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">Commands</span>
        <span>Type to filter</span>
      </div>
      <div
        id={id}
        role="listbox"
        aria-label="Chat commands"
        className="max-h-64 overflow-y-auto p-1"
      >
        {options.map((option, index) => {
          const Icon = option.icon;
          return (
            <button
              key={`${option.kind}:${option.id}`}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHighlight(index)}
              onClick={() => onSelect(option)}
              className={cn(
                "flex min-h-14 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                index === activeIndex ? "bg-primary/10" : "hover:bg-muted",
              )}
              data-testid="composer-command-option"
            >
              <Icon size={20} className="mt-0.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-sm font-medium">/{option.name}</span>
                  <span className="text-xs text-muted-foreground">{option.label}</span>
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {option.description || "Add this skill to your message."}
                </span>
              </span>
              {option.kind === "skill" && (
                <span className="shrink-0 text-[10px] text-muted-foreground">Skill</span>
              )}
            </button>
          );
        })}
      </div>
      {options.length === 0 && (
        <p role="status" className="px-4 pb-3 pt-2 text-sm text-muted-foreground">
          No matching commands. Keep typing to write a message.
        </p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span>Arrow keys to browse</span>
        <span>Enter or Tab to select</span>
        <span>Esc to dismiss</span>
      </div>
    </div>
  );
}
