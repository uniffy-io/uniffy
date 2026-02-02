/**
 * IconPicker Component
 *
 * A popover component for selecting icons (Phosphor icons or emojis).
 * Can be used app-wide for notes, filters, bookmarks, etc.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/utils/cn';
import {
    COMMON_EMOJIS,
    getIconCategories,
    getIconsByCategory,
    type IconValue,
} from './iconConstants';
import { getIconByName } from './iconUtils';

interface IconPickerProps {
    /** Currently selected icon */
    currentIcon?: IconValue | null;
    /** Callback when an icon is selected */
    onSelect: (icon: IconValue | null) => void;
    /** Callback to close the picker */
    onClose: () => void;
    /** Optional title for the picker header */
    title?: string;
    /** Whether to show the remove icon button */
    showRemove?: boolean;
    /** Optional className for the container */
    className?: string;
    /** Which categories to show (defaults to all) */
    categories?: string[];
}

type TabType = 'icons' | 'emojis';

export function IconPicker({
    currentIcon,
    onSelect,
    onClose,
    title = 'Choose Icon',
    showRemove = true,
    className,
    categories: allowedCategories,
}: IconPickerProps) {
    const [activeTab, setActiveTab] = useState<TabType>(
        currentIcon?.type === 'emoji' ? 'emojis' : 'icons'
    );
    const [customEmoji, setCustomEmoji] = useState('');
    const pickerRef = useRef<HTMLDivElement>(null);

    // Close picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleIconSelect = useCallback((iconName: string) => {
        onSelect({ type: 'icon', value: iconName });
    }, [onSelect]);

    const handleEmojiSelect = useCallback((emoji: string) => {
        onSelect({ type: 'emoji', value: emoji });
    }, [onSelect]);

    const handleCustomEmojiSubmit = useCallback(() => {
        if (customEmoji.trim()) {
            const emoji = [...customEmoji.trim()][0];
            if (emoji) {
                onSelect({ type: 'emoji', value: emoji });
            }
        }
    }, [customEmoji, onSelect]);

    const handleRemoveIcon = useCallback(() => {
        onSelect(null);
    }, [onSelect]);

    // Get categories (filtered if specified)
    const allCategories = getIconCategories();
    const categories = allowedCategories
        ? allCategories.filter(c => allowedCategories.includes(c))
        : allCategories;

    return (
        <div
            ref={pickerRef}
            className={cn(
                "absolute z-50 mt-2 w-80 bg-card border border-border rounded-lg shadow-xl overflow-hidden",
                className
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                <span className="text-sm font-medium text-foreground">{title}</span>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                    <X size={16} weight="bold" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                <button
                    onClick={() => setActiveTab('icons')}
                    className={cn(
                        "flex-1 px-4 py-2 text-sm font-medium transition-colors",
                        activeTab === 'icons'
                            ? 'text-primary border-b-2 border-primary bg-primary/5'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                >
                    Icons
                </button>
                <button
                    onClick={() => setActiveTab('emojis')}
                    className={cn(
                        "flex-1 px-4 py-2 text-sm font-medium transition-colors",
                        activeTab === 'emojis'
                            ? 'text-primary border-b-2 border-primary bg-primary/5'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                >
                    Emojis
                </button>
            </div>

            {/* Content */}
            <div className="max-h-72 overflow-y-auto p-3">
                {activeTab === 'icons' ? (
                    <div className="space-y-4">
                        {categories.map((category) => (
                            <div key={category}>
                                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                    {category}
                                </h4>
                                <div className="grid grid-cols-8 gap-1">
                                    {getIconsByCategory(category).map(({ name }) => {
                                        const IconComponent = getIconByName(name);
                                        const isSelected =
                                            currentIcon?.type === 'icon' &&
                                            currentIcon.value === name;

                                        return IconComponent ? (
                                            <button
                                                key={name}
                                                onClick={() => handleIconSelect(name)}
                                                className={cn(
                                                    "p-2 rounded hover:bg-muted transition-colors",
                                                    isSelected && "bg-primary/10 ring-1 ring-primary"
                                                )}
                                                title={name}
                                            >
                                                <IconComponent size={16} className="text-foreground" />
                                            </button>
                                        ) : null;
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Common emojis grid */}
                        <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                Common
                            </h4>
                            <div className="grid grid-cols-8 gap-1">
                                {COMMON_EMOJIS.map((emoji) => {
                                    const isSelected =
                                        currentIcon?.type === 'emoji' &&
                                        currentIcon.value === emoji;

                                    return (
                                        <button
                                            key={emoji}
                                            onClick={() => handleEmojiSelect(emoji)}
                                            className={cn(
                                                "p-2 rounded hover:bg-muted transition-colors text-lg",
                                                isSelected && "bg-primary/10 ring-1 ring-primary"
                                            )}
                                        >
                                            {emoji}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Custom emoji input */}
                        <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                Custom
                            </h4>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={customEmoji}
                                    onChange={(e) => setCustomEmoji(e.target.value)}
                                    placeholder="Paste any emoji..."
                                    className="flex-1 px-3 py-2 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleCustomEmojiSubmit();
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleCustomEmojiSubmit}
                                    disabled={!customEmoji.trim()}
                                    className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer - Remove icon option */}
            {showRemove && currentIcon && (
                <div className="px-3 py-2 border-t border-border bg-muted/30">
                    <button
                        onClick={handleRemoveIcon}
                        className="w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                    >
                        Remove icon
                    </button>
                </div>
            )}
        </div>
    );
}
