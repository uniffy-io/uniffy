import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import type { SelectOption } from "@/components/ui/select";

interface MultiSelectProps<T extends string | number = string> {
  value: T[];
  onChange: (value: T[]) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  const handleToggle = (optionValue: T) => {
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
          "z-[200] overflow-hidden rounded-md",
          "border border-border bg-card shadow-xl",
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
          "flex items-center flex-wrap gap-1 rounded-md border border-border bg-background",
          "font-medium transition-colors min-h-[2.5rem]",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/50",
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
