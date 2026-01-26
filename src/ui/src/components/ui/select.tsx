/**
 * Custom Select Component
 *
 * A styled dropdown select that matches the app's theme.
 * Uses viewport-relative positioning for proper rendering in modals.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Check } from '@phosphor-icons/react';
import { cn } from '@/utils/cn';

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
    size?: 'sm' | 'md';
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
    placeholder = 'Select...',
    disabled = false,
    className,
    size = 'md',
}: SelectProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState<DropdownPosition | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Calculate dropdown position
    const updatePosition = useCallback(() => {
        if (!buttonRef.current) return;

        const rect = buttonRef.current.getBoundingClientRect();
        const dropdownHeight = Math.min(options.length * 40 + 8, 240); // Approximate height
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;

        // Open upward if not enough space below and more space above
        const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

        setPosition({
            top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            openUpward,
        });
    }, [options.length]);

    // Update position on open and on scroll/resize
    useEffect(() => {
        if (isOpen) {
            updatePosition();

            const handleScrollOrResize = () => {
                updatePosition();
            };

            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);

            return () => {
                window.removeEventListener('scroll', handleScrollOrResize, true);
                window.removeEventListener('resize', handleScrollOrResize);
            };
        }
    }, [isOpen, updatePosition]);

    // Close on outside click
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
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Close on escape
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [isOpen]);

    const selectedOption = options.find((opt) => opt.value === value);

    const sizeClasses = {
        sm: 'px-2 py-1 text-xs',
        md: 'px-3 py-2 text-sm',
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

    // Render dropdown in portal for proper z-index handling in modals
    const renderDropdown = () => {
        if (!isOpen || !position) return null;

        const dropdown = (
            <div
                ref={dropdownRef}
                style={{
                    position: 'fixed',
                    top: position.top,
                    left: position.left,
                    width: position.width,
                    minWidth: 120,
                }}
                className={cn(
                    'z-[200] overflow-hidden rounded-md',
                    'border border-border bg-card shadow-xl',
                    'animate-in fade-in-0 duration-100',
                    position.openUpward ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2'
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
                                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left',
                                    'transition-colors',
                                    isSelected
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-foreground hover:bg-muted',
                                    size === 'sm' ? 'text-xs' : 'text-sm'
                                )}
                            >
                                <span className="flex items-center gap-2">
                                    {option.icon}
                                    {option.label}
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
        <div className={cn('relative', className)}>
            <button
                ref={buttonRef}
                type="button"
                onClick={handleToggle}
                disabled={disabled}
                className={cn(
                    'flex items-center justify-between gap-2 rounded-md border border-border bg-background',
                    'font-medium transition-colors',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'hover:bg-muted/50',
                    sizeClasses[size],
                    'min-w-[100px]'
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
                        'text-muted-foreground transition-transform duration-200',
                        isOpen && 'rotate-180'
                    )}
                />
            </button>

            {renderDropdown()}
        </div>
    );
}

export default Select;
