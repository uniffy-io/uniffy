import { useState, useRef, useEffect, useCallback } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";
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
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(options.length * 40 + 8, 240);
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
  }, [options.length, menuMinWidth]);

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
      setIsOpen(!isOpen);
    }
  };

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
        <div className="py-1 max-h-60 overflow-y-auto">
          {options.map((option) => {
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
