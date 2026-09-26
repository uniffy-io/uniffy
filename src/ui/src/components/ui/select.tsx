import { useState, useRef, useEffect, useCallback } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";
import { controlShellClass } from "@/components/ui/input";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SelectProps<T extends string | number = string> {
  value: T | undefined;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  size?: "sm" | "md";
  /** Widens the dropdown past the trigger when labels are long. */
  menuMinWidth?: number;
  ariaLabel?: string;
  /** A filter box above the options, for long lists. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  openUpward: boolean;
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled = false,
  className,
  triggerClassName,
  size = "md",
  menuMinWidth = 120,
  ariaLabel,
  searchable = false,
  searchPlaceholder = "Search...",
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(options.length * 40 + 8, 240) + (searchable ? 44 : 0);
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    // A menu wider than its trigger can run past the right edge, so pull it back.
    const width = Math.max(rect.width, menuMinWidth);
    const maxLeft = window.innerWidth - width - 8;

    setPosition({
      top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, maxLeft)),
      width,
      openUpward,
    });
  }, [options.length, menuMinWidth, searchable]);

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

  const selectedOption = options.find((opt) => opt.value === value);

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
  };

  const handleToggle = () => {
    if (!disabled) {
      setQuery("");
      setIsOpen(!isOpen);
    }
  };

  const needle = query.trim().toLowerCase();
  const shownOptions = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;

  const handleSelect = (optionValue: T) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  // Portal lets the dropdown layer above modal overlays.
  const renderDropdown = () => {
    if (!isOpen || !position) return null;

    const dropdown = (
      <div
        ref={dropdownRef}
        data-select-portal=""
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          width: position.width,
        }}
        className={cn(
          popoverShellClass,
          "z-[200] overflow-hidden",
          "animate-in fade-in-0 duration-100",
          position.openUpward ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
        )}
      >
        {searchable && (
          <div className="p-1.5 border-b border-border/60">
            <div
              className={cn(
                controlShellClass,
                "focus-ring-within flex items-center gap-1.5 px-2 py-1",
              )}
            >
              <MagnifyingGlass size={12} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shownOptions.length > 0) {
                    e.preventDefault();
                    handleSelect(shownOptions[0].value);
                  }
                }}
                placeholder={searchPlaceholder}
                className="flex-1 min-w-0 bg-transparent outline-none text-xs text-foreground placeholder:text-subtle-foreground"
              />
            </div>
          </div>
        )}
        <div className="py-1 max-h-60 overflow-y-auto">
          {shownOptions.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
          )}
          {shownOptions.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left",
                  "transition-colors",
                  isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                  size === "sm" ? "text-xs" : "text-sm",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.icon}
                  <span className="truncate" title={option.label}>
                    {option.label}
                  </span>
                </span>
                {isSelected && <Check size={16} weight="bold" className="text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    );

    return createPortal(dropdown, document.body);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          controlShellClass,
          "focus-ring flex items-center justify-between gap-2 font-medium",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          isOpen && "border-border-strong",
          sizeClasses[size],
          "min-w-[100px]",
          triggerClassName,
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {selectedOption?.icon}
          {selectedOption?.label || placeholder}
        </span>
        <CaretDown
          size={16}
          weight="bold"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {renderDropdown()}
    </div>
  );
}
