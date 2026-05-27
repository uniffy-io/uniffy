import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { CalendarBlank, CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  parse,
  isValid,
} from "date-fns";
import { cn } from "@/shared/utils/cn";

interface DatePickerProps {
  /** ISO date string `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  openUpward: boolean;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedDate = useMemo(() => {
    if (!value) return null;
    const parsed = parse(value, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : null;
  }, [value]);

  const [displayMonth, setDisplayMonth] = useState<Date>(
    () => selectedDate || new Date()
  );

  useEffect(() => {
    if (selectedDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting display month when selectedDate changes
      setDisplayMonth(selectedDate);
    }
  }, [selectedDate]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(displayMonth);
    const monthEnd = endOfMonth(displayMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [displayMonth]);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();

    setPosition({
      top: rect.bottom + 4,
      left: rect.left,
      openUpward: false,
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handler = () => updatePosition();
      window.addEventListener("scroll", handler, true);
      window.addEventListener("resize", handler);
      return () => {
        window.removeEventListener("scroll", handler, true);
        window.removeEventListener("resize", handler);
      };
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleDayClick = (day: Date) => {
    onChange(format(day, "yyyy-MM-dd"));
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
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
          width: 280,
        }}
        className={cn(
          "z-[200] rounded-lg",
          "border border-border bg-card shadow-xl",
          "animate-in fade-in-0 duration-100",
          position.openUpward
            ? "slide-in-from-bottom-2"
            : "slide-in-from-top-2"
        )}
      >
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <button
            type="button"
            onClick={() => setDisplayMonth((m) => subMonths(m, 1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
          <span className="text-sm font-medium text-foreground">
            {format(displayMonth, "MMMM yyyy")}
          </span>
          <button
            type="button"
            onClick={() => setDisplayMonth((m) => addMonths(m, 1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <CaretRight size={16} weight="bold" />
          </button>
        </div>

        <div className="grid grid-cols-7 px-2 pt-2">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="text-center text-xs font-medium text-muted-foreground py-1"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 px-2 pb-2">
          {calendarDays.map((day) => {
            const isCurrentMonth = isSameMonth(day, displayMonth);
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const isCurrentDay = isToday(day);

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => handleDayClick(day)}
                className={cn(
                  "h-8 w-full rounded-md text-sm transition-colors",
                  "focus:outline-none focus:ring-1 focus:ring-primary",
                  !isCurrentMonth && "text-muted-foreground/40",
                  isCurrentMonth &&
                    !isSelected &&
                    "text-foreground hover:bg-muted",
                  isCurrentDay &&
                    !isSelected &&
                    "font-semibold text-primary",
                  isSelected &&
                    "bg-primary text-primary-foreground font-medium"
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-border">
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              onChange(format(today, "yyyy-MM-dd"));
              setDisplayMonth(today);
              setIsOpen(false);
            }}
            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Today
          </button>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setIsOpen(false);
              }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
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
        className={cn(
          "flex items-center gap-2 w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm",
          "transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "hover:bg-muted/50",
          value ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <CalendarBlank size={16} className="text-muted-foreground shrink-0" />
        <span className="flex-1 text-left truncate">
          {selectedDate ? format(selectedDate, "MMM d, yyyy") : placeholder}
        </span>
        {value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={handleClear}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} />
          </span>
        )}
      </button>

      {renderDropdown()}
    </div>
  );
}
