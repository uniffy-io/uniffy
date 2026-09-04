import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, ClockAfternoon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Input, controlShellClass } from "@/components/ui/input";
import { popoverShellClass } from "@/components/ui/popover";

interface TimeSelectProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  /** Tighter trigger for narrow hosts like the event detail panel. */
  compact?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Decimal hours -> "9:15 AM". */
function formatTimeValue(value: number): string {
  const hours = Math.floor(value);
  const minutes = Math.round((value % 1) * 60);
  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/** Accepts "9:15 AM", "9:15am", "9:15", "21:15", "9 AM", "9". */
function parseTimeString(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, " ");

  const match = trimmed.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3] as "am" | "pm" | undefined;

  if (minutes < 0 || minutes > 59) return null;

  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  if (hours < 0 || hours > 23) return null;

  return hours + minutes / 60;
}

/** 48 half-hour presets covering a 24h day. */
const PRESET_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const timeValue = i * 0.5;
  return { value: timeValue, label: formatTimeValue(timeValue) };
});

/** ~1 second tolerance to compare decimal-hour values. */
function timeValuesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0003;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  openUpward: boolean;
}

export function TimeSelect({
  value,
  onChange,
  className,
  compact = false,
  disabled = false,
  ariaLabel,
}: TimeSelectProps) {
  const triggerSize = compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const displayValue = formatTimeValue(value);

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    // max-h-60 (240px) + padding.
    const dropdownHeight = 248;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setPosition({
      top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 160),
      openUpward,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setInputValue("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;

    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < PRESET_OPTIONS.length; i++) {
      const dist = Math.abs(PRESET_OPTIONS[i].value - value);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const itemHeight = 36;
    const scrollTop = Math.max(0, nearestIdx * itemHeight - 100);
    listRef.current.scrollTop = scrollTop;
  }, [isOpen, value]);

  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return PRESET_OPTIONS;
    const search = inputValue.trim().toLowerCase();
    return PRESET_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(search));
  }, [inputValue]);

  const parsedCustomTime = useMemo(() => {
    if (!inputValue.trim()) return null;
    const parsed = parseTimeString(inputValue);
    if (parsed === null) return null;
    // Suppress the custom option when it matches a visible preset row.
    const matchesPreset = filteredOptions.some((opt) => timeValuesEqual(opt.value, parsed));
    if (matchesPreset) return null;
    return { value: parsed, label: formatTimeValue(parsed) };
  }, [inputValue, filteredOptions]);

  const handleOpen = () => {
    setInputValue("");
    setIsOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelect = (timeValue: number) => {
    onChange(timeValue);
    setIsOpen(false);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputValue.trim()) {
        const parsed = parseTimeString(inputValue);
        if (parsed !== null) {
          handleSelect(parsed);
          return;
        }
      }
      if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0].value);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setInputValue("");
    }
  };

  const renderDropdown = () => {
    if (!isOpen || !position) return null;

    const hasResults = filteredOptions.length > 0 || parsedCustomTime;

    const dropdown = (
      <div
        ref={dropdownRef}
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          width: position.width,
          minWidth: 160,
        }}
        className={cn(
          popoverShellClass,
          "z-[200] overflow-hidden",
          "animate-in fade-in-0 duration-100",
          position.openUpward ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
        )}
      >
        <div ref={listRef} className="py-1 max-h-60 overflow-y-auto">
          {parsedCustomTime && (
            <button
              type="button"
              onClick={() => handleSelect(parsedCustomTime.value)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                "text-primary hover:bg-primary/10 transition-colors",
                "border-b border-border",
              )}
            >
              <ClockAfternoon size={14} weight="bold" />
              <span>{parsedCustomTime.label}</span>
            </button>
          )}

          {filteredOptions.map((option) => {
            const isSelected = timeValuesEqual(option.value, value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                  "transition-colors",
                  isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                )}
              >
                <span>{option.label}</span>
                {isSelected && <Check size={14} weight="bold" className="text-primary" />}
              </button>
            );
          })}

          {!hasResults && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Type a time like &quot;9:15 AM&quot;
            </div>
          )}
        </div>
      </div>
    );

    return createPortal(dropdown, document.body);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {isOpen ? (
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={displayValue}
          aria-label={ariaLabel}
          className={cn("h-auto font-medium", triggerSize, compact ? "min-w-0" : "min-w-[100px]")}
        />
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            controlShellClass,
            "focus-ring flex w-full items-center justify-between gap-2 font-medium",
            triggerSize,
            "disabled:opacity-50 disabled:cursor-not-allowed",
            compact ? "min-w-0" : "min-w-[100px]",
          )}
        >
          <span className="truncate">{displayValue}</span>
          <CaretDown
            size={compact ? 12 : 16}
            weight="bold"
            className="text-muted-foreground shrink-0"
          />
        </button>
      )}

      {renderDropdown()}
    </div>
  );
}
