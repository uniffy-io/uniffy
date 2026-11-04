import { useEffect, useRef, useState } from "react";
import { popoverShellClass } from "@/components/ui/popover";
import type { SelectOption } from "@/features/projects/types";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import { cn } from "@/shared/utils/cn";

interface OptionDropdownProps {
  options: SelectOption[];
  currentId: string;
  onSelect: (optionId: string) => void;
  onClose: () => void;
  /** Overrides the stored option colour for the swatch (statuses derive theirs from order). */
  swatch?: (option: SelectOption) => string;
}

function OptionDropdown({ options, currentId, onSelect, onClose, swatch }: OptionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className={cn(
        popoverShellClass,
        "absolute top-full left-0 z-50 mt-1 min-w-40 py-1 max-h-60 overflow-y-auto",
      )}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => {
            onSelect(option.id);
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
            option.id === currentId
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted",
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: swatch ? swatch(option) : option.color }}
          />
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface StatusPickerProps {
  currentOption: SelectOption;
  options: SelectOption[];
  onSelect: (optionId: string) => void;
  disabled?: boolean;
  triggerClassName?: string;
  appearance?: "badge" | "plain";
}

export function StatusPicker({
  currentOption,
  options,
  onSelect,
  disabled,
  triggerClassName,
  appearance = "badge",
}: StatusPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const paint = statusPaint(options, currentOption.id);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60",
          appearance === "plain" && "border-0 bg-transparent text-foreground hover:opacity-100",
          triggerClassName,
        )}
        style={
          appearance === "badge"
            ? {
                backgroundColor: paint.translucent,
                border: `1px solid ${paint.translucent}`,
              }
            : undefined
        }
      >
        <div className="w-2 h-2 rounded-full" style={{ background: paint.gradient }} />
        <span style={appearance === "badge" ? { color: paint.solid } : undefined}>
          {currentOption.label}
        </span>
      </button>
      {isOpen && (
        <OptionDropdown
          options={options}
          swatch={(o) => statusPaint(options, o.id).gradient}
          currentId={currentOption.id}
          onSelect={onSelect}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

interface PriorityPickerProps {
  currentOption: SelectOption;
  options: SelectOption[];
  onSelect: (optionId: string) => void;
  disabled?: boolean;
  triggerClassName?: string;
  appearance?: "badge" | "plain";
}

export function PriorityPicker({
  currentOption,
  options,
  onSelect,
  disabled,
  triggerClassName,
  appearance = "badge",
}: PriorityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60",
          appearance === "plain" && "border-0 bg-transparent text-foreground hover:opacity-100",
          triggerClassName,
        )}
        style={
          appearance === "badge"
            ? {
                backgroundColor: `${currentOption.color}15`,
                borderColor: `${currentOption.color}30`,
                color: currentOption.color,
              }
            : undefined
        }
      >
        {appearance === "plain" && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: currentOption.color }}
          />
        )}
        {currentOption.label}
      </button>
      {isOpen && (
        <OptionDropdown
          options={options}
          currentId={currentOption.id}
          onSelect={onSelect}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
