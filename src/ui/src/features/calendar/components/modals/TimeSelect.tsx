/**
 * TimeSelect - Combo-box time picker
 *
 * Looks like a standard Select when collapsed. On click, the trigger becomes
 * an editable text input with a dropdown of 30-minute quick-pick presets.
 * Users can type any time (e.g. "9:15 am") and press Enter to set a custom value.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Check, ClockAfternoon } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface TimeSelectProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

/**
 * Format a decimal-hour value to display string.
 * Supports arbitrary minutes (e.g. 9.25 -> "9:15 AM").
 */
function formatTimeValue(value: number): string {
  const hours = Math.floor(value);
  const minutes = Math.round((value % 1) * 60);
  const period = hours < 12 ? 'AM' : 'PM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Parse a time string into decimal hours.
 * Handles: "9:15 AM", "9:15am", "9:15", "21:15", "9 AM", "9"
 */
function parseTimeString(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, ' ');

  // Match: optional hour(s), optional :minutes, optional am/pm
  const match = trimmed.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3] as 'am' | 'pm' | undefined;

  if (minutes < 0 || minutes > 59) return null;

  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  if (hours < 0 || hours > 23) return null;

  return hours + minutes / 60;
}

/** 30-minute interval presets (48 options for 24 hours) */
const PRESET_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const timeValue = i * 0.5;
  return { value: timeValue, label: formatTimeValue(timeValue) };
});

/** Check if two decimal-hour values represent the same time (within ~1 second) */
function timeValuesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0003;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  openUpward: boolean;
}

export function TimeSelect({ value, onChange, className }: TimeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const displayValue = formatTimeValue(value);

  // Position the dropdown relative to the trigger
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 248; // max-h-60 = 240px + padding
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

  // Update position while open
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [isOpen, updatePosition]);

  // Close on outside click
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
        setInputValue('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Scroll to nearest preset on open
  useEffect(() => {
    if (!isOpen || !listRef.current) return;

    // Find the nearest preset index to current value
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < PRESET_OPTIONS.length; i++) {
      const dist = Math.abs(PRESET_OPTIONS[i].value - value);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    // Scroll so the nearest option is roughly centered
    const itemHeight = 36;
    const scrollTop = Math.max(0, nearestIdx * itemHeight - 100);
    listRef.current.scrollTop = scrollTop;
  }, [isOpen, value]);

  // Filter presets based on typed input
  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return PRESET_OPTIONS;
    const search = inputValue.trim().toLowerCase();
    return PRESET_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(search));
  }, [inputValue]);

  // Parse typed input as a custom (non-preset) time
  const parsedCustomTime = useMemo(() => {
    if (!inputValue.trim()) return null;
    const parsed = parseTimeString(inputValue);
    if (parsed === null) return null;
    // Only show custom option if it doesn't match any visible preset
    const matchesPreset = filteredOptions.some((opt) => timeValuesEqual(opt.value, parsed));
    if (matchesPreset) return null;
    return { value: parsed, label: formatTimeValue(parsed) };
  }, [inputValue, filteredOptions]);

  const handleOpen = () => {
    setInputValue('');
    setIsOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelect = (timeValue: number) => {
    onChange(timeValue);
    setIsOpen(false);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        const parsed = parseTimeString(inputValue);
        if (parsed !== null) {
          handleSelect(parsed);
          return;
        }
      }
      // If nothing typed or unparseable, pick first filtered option
      if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0].value);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setInputValue('');
    }
  };

  const renderDropdown = () => {
    if (!isOpen || !position) return null;

    const hasResults = filteredOptions.length > 0 || parsedCustomTime;

    const dropdown = (
      <div
        ref={dropdownRef}
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          width: position.width,
          minWidth: 160,
        }}
        className={cn(
          'z-[200] overflow-hidden rounded-md',
          'border border-border bg-card shadow-xl',
          'animate-in fade-in-0 duration-100',
          position.openUpward ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2'
        )}
      >
        <div ref={listRef} className="py-1 max-h-60 overflow-y-auto">
          {/* Custom time option (shown when typed value doesn't match a preset) */}
          {parsedCustomTime && (
            <button
              type="button"
              onClick={() => handleSelect(parsedCustomTime.value)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                'text-primary hover:bg-primary/10 transition-colors',
                'border-b border-border'
              )}
            >
              <ClockAfternoon size={14} weight="bold" />
              <span>{parsedCustomTime.label}</span>
            </button>
          )}

          {/* Preset 30-min options */}
          {filteredOptions.map((option) => {
            const isSelected = timeValuesEqual(option.value, value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                  'transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                )}
              >
                <span>{option.label}</span>
                {isSelected && <Check size={14} weight="bold" className="text-primary" />}
              </button>
            );
          })}

          {/* Empty state */}
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
    <div ref={containerRef} className={cn('relative', className)}>
      {isOpen ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={displayValue}
          className={cn(
            'flex w-full items-center rounded-md border border-primary bg-background',
            'px-3 py-2 text-sm font-medium',
            'outline-none ring-2 ring-primary/50 ring-offset-1 ring-offset-background',
            'placeholder:text-muted-foreground',
            'min-w-[100px]'
          )}
        />
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background',
            'px-3 py-2 text-sm font-medium transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background',
            'hover:bg-muted/50',
            'min-w-[100px]'
          )}
        >
          <span className="truncate">{displayValue}</span>
          <CaretDown size={16} weight="bold" className="text-muted-foreground" />
        </button>
      )}

      {renderDropdown()}
    </div>
  );
}
