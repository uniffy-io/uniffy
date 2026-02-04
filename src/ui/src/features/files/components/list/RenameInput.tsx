/**
 * Inline Rename Input Component
 *
 * Provides an inline text input for renaming files and folders.
 */

import { useState, useRef, useEffect } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface RenameInputProps {
    /** Initial name value */
    initialValue: string;
    /** Called when rename is confirmed */
    onConfirm: (newName: string) => void;
    /** Called when rename is cancelled */
    onCancel: () => void;
    /** Optional className for styling */
    className?: string;
    /** Whether to show as inline in grid or list view */
    variant?: 'grid' | 'list';
}

export function RenameInput({ initialValue, onConfirm, onCancel, className, variant = 'grid' }: RenameInputProps) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus and select text on mount
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    const handleConfirm = () => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== initialValue) {
            onConfirm(trimmed);
        } else {
            onCancel();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    if (variant === 'list') {
        return (
            <div className={cn("flex items-center gap-2 flex-1", className)}>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleConfirm}
                    className="flex-1 px-2 py-1 text-sm bg-background border border-primary rounded focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleConfirm();
                    }}
                    className="p-1 rounded hover:bg-muted"
                    title="Confirm"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur
                >
                    <Check size={16} className="text-green-500" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onCancel();
                    }}
                    className="p-1 rounded hover:bg-muted"
                    title="Cancel"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur
                >
                    <X size={16} className="text-destructive" />
                </button>
            </div>
        );
    }

    // Grid variant - simpler inline input
    return (
        <div className={cn("flex items-center gap-1 px-2 py-1", className)}>
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleConfirm}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 px-1 py-0.5 text-sm bg-background border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
        </div>
    );
}
