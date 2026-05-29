import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from '@phosphor-icons/react';
import { SafeEmojiPicker } from '@/components/emoji/SafeEmojiPicker';
import { cn } from '@/shared/utils/cn';
import { useTheme } from '@/config/theme/ThemeProvider';
import {
    getIconCategories,
    getIconsByCategory,
    type IconValue,
} from '@/components/icon-picker/iconConstants';
import { getIconByName } from '@/components/icon-picker/iconUtils';

interface IconPickerProps {
    currentIcon?: IconValue | null;
    onSelect: (icon: IconValue | null) => void;
    onClose: () => void;
    title?: string;
    showRemove?: boolean;
    className?: string;
    /** Defaults to all categories. */
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
    const pickerRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();

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

    const handleEmojiSelect = useCallback((emoji: { native: string }) => {
        onSelect({ type: 'emoji', value: emoji.native });
    }, [onSelect]);

    const handleRemoveIcon = useCallback(() => {
        onSelect(null);
    }, [onSelect]);

    // Get categories (filtered if specified)
    const allCategories = getIconCategories();
    const categories = allowedCategories
        ? allCategories.filter(c => allowedCategories.includes(c))
        : allCategories;

    const isEmojiTab = activeTab === 'emojis';

    return (
        <div
            ref={pickerRef}
            className={cn(
                "absolute z-50 mt-2 bg-card border border-border rounded-lg shadow-xl overflow-hidden",
                isEmojiTab ? "w-[22rem]" : "w-80",
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
            {isEmojiTab ? (
                <SafeEmojiPicker
                    onEmojiSelect={handleEmojiSelect}
                    theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                    previewPosition="none"
                    skinTonePosition="search"
                    perLine={8}
                    maxFrequentRows={2}
                    navPosition="bottom"
                />
            ) : (
                <div className="max-h-72 overflow-y-auto p-3">
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
                </div>
            )}

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
