import { useEffect, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { popoverShellClass } from "@/components/ui/popover";
import type { Sprint } from "@/features/projects/types";
import { cn } from "@/shared/utils/cn";

interface SprintSelectorProps {
  sprints: Sprint[];
  currentSprintId: string | null;
  onSelect: (sprintId: string | null) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

export function SprintSelector({
  sprints,
  currentSprintId,
  onSelect,
  disabled,
  triggerClassName,
}: SprintSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentSprint = sprints.find((s) => s.id === currentSprintId);
  const activeSprints = sprints.filter((s) => s.status !== "closed");

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const statusColors: Record<string, string> = {
    active: "text-green-600",
    planned: "text-muted-foreground",
    closed: "text-subtle-foreground",
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded text-sm border transition-colors disabled:cursor-not-allowed",
          currentSprint
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
          triggerClassName,
        )}
      >
        {currentSprint ? currentSprint.name : "Backlog"}
      </button>

      {isOpen && (
        <div
          className={cn(
            popoverShellClass,
            "absolute top-full left-0 z-50 mt-1 w-56 py-1 animate-in fade-in-0 zoom-in-95",
          )}
        >
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Move to
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setIsOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
              !currentSprintId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
            )}
          >
            <span>Backlog</span>
            {!currentSprintId && <Check size={14} weight="bold" />}
          </button>
          {activeSprints.map((sprint) => {
            const isActive = sprint.id === currentSprintId;
            return (
              <button
                key={sprint.id}
                type="button"
                onClick={() => {
                  onSelect(sprint.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                )}
              >
                <div className="flex items-center gap-2">
                  <span>{sprint.name}</span>
                  <span className={cn("text-xs", statusColors[sprint.status])}>
                    {sprint.status}
                  </span>
                </div>
                {isActive && <Check size={14} weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
