import { useState, useRef, useEffect, useCallback } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { CaretDown, Check, X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";
import type { SelectOption } from "@/components/ui/select";
import { controlShellClass } from "@/components/ui/input";

interface MultiSelectProps<T extends string | number = string> {
  value: T[];
  onChange: (value: T[]) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  openUpward: boolean;
}

export function MultiSelect<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled = false,
  className,
  size = "md",
  ariaLabel,
}: MultiSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(value);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(options.length * 40 + 8, 240);
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setPosition({
      top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      openUpward,
    });
  }, [options.length]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();

      const handleScrollOrResize = () => {
        updatePosition();
      };

      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);

      return () => {
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useOverlayEscape(() => setIsOpen(false), isOpen);

  const handleToggle = (optionValue: T) => {
    if (disabled) return;
    if (selectedSet.has(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const handleRemove = (optionValue: T, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optionValue));
  };

  const selectedOptions = options.filter((opt) => selectedSet.has(opt.value));

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
  };

  const renderDropdown = () => {
    if (!isOpen || !position) return null;

    const dropdown = (
      <div
        ref={dropdownRef}
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          width: position.width,
          minWidth: 120,
        }}
        className={cn(
          popoverShellClass,
          "z-[200] overflow-hidden",
          "animate-in fade-in-0 duration-100",
          position.openUpward ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
        )}
      >
        <div className="py-1 max-h-60 overflow-y-auto">
          {options.map((option) => {
            const isSelected = selectedSet.has(option.value);
            return (
              <button
                key={String(option.value)}
                type="button"
                disabled={disabled}
                onClick={() => handleToggle(option.value)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left",
                  "transition-colors",
                  isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                  size === "sm" ? "text-xs" : "text-sm",
                )}
              >
                <span className="flex items-center gap-2 truncate">
                  {option.icon}
                  {option.label}
                </span>
                {isSelected && <Check size={16} weight="bold" className="text-primary" />}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options available</div>
          )}
        </div>
      </div>
    );

    return createPortal(dropdown, document.body);
  };

  return (
    <div className={cn("relative", className)}>
      <div
        ref={buttonRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!disabled) setIsOpen(!isOpen);
          }
        }}
        className={cn(
          controlShellClass,
          "focus-ring flex items-center flex-wrap gap-1 font-medium min-h-[2.5rem]",
          disabled ? "opacity-50 cursor-not-allowed hover:border-border" : "cursor-pointer",
          isOpen && "border-border-strong",
          sizeClasses[size],
        )}
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
            <span
              key={String(opt.value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5",
                size === "sm" ? "text-xs" : "text-xs",
              )}
            >
              {opt.label}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${opt.label}`}
                  onClick={(e) => handleRemove(opt.value, e)}
                  className="hover:bg-primary/20 rounded-sm p-0.5 transition-colors"
                >
                  <X size={10} weight="bold" />
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground truncate">{placeholder}</span>
        )}
        <CaretDown
          size={16}
          weight="bold"
          className={cn(
            "ml-auto text-muted-foreground transition-transform duration-200 shrink-0",
            isOpen && "rotate-180",
          )}
        />
      </div>

      {renderDropdown()}
    </div>
  );
}
