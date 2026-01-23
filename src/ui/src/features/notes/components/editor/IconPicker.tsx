/**
 * IconPicker Component
 *
 * A popover component for selecting note icons (Heroicons or emojis).
 */

import { useState, useRef, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
    COMMON_EMOJIS,
    getIconCategories,
    getIconsByCategory,
    type NoteIcon,
} from '../../utils/noteIconConstants';
import { getHeroiconByName } from '../../utils/noteIcons';

interface IconPickerProps {
    currentIcon?: NoteIcon;
    onSelect: (icon: NoteIcon | null) => void;
    onClose: () => void;
}

type TabType = 'heroicons' | 'emojis';

export function IconPicker({ currentIcon, onSelect, onClose }: IconPickerProps) {
    const [activeTab, setActiveTab] = useState<TabType>(
        currentIcon?.type === 'emoji' ? 'emojis' : 'heroicons'
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

    const handleHeroiconSelect = (iconName: string) => {
        onSelect({ type: 'heroicon', value: iconName });
        // Note: Parent handles closing via onSelect callback
    };

    const handleEmojiSelect = (emoji: string) => {
        onSelect({ type: 'emoji', value: emoji });
        // Note: Parent handles closing via onSelect callback
    };

    const handleCustomEmojiSubmit = () => {
        if (customEmoji.trim()) {
            // Take first emoji character(s)
            const emoji = [...customEmoji.trim()][0];
            if (emoji) {
                onSelect({ type: 'emoji', value: emoji });
                // Note: Parent handles closing via onSelect callback
            }
        }
    };

    const handleRemoveIcon = () => {
        onSelect(null);
        // Note: Parent handles closing via onSelect callback
    };

    const categories = getIconCategories();

    return (
        <div
            ref={pickerRef}
            className="absolute z-50 mt-2 w-80 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                <span className="text-sm font-medium text-foreground">Choose Icon</span>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                    <XMarkIcon className="h-4 w-4" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                <button
                    onClick={() => setActiveTab('heroicons')}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'heroicons'
                            ? 'text-primary border-b-2 border-primary bg-primary/5'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                >
                    Icons
                </button>
                <button
                    onClick={() => setActiveTab('emojis')}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'emojis'
                            ? 'text-primary border-b-2 border-primary bg-primary/5'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                >
                    Emojis
                </button>
            </div>

            {/* Content */}
            <div className="max-h-72 overflow-y-auto p-3">
                {activeTab === 'heroicons' ? (
                    <div className="space-y-4">
                        {categories.map((category) => (
                            <div key={category}>
                                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                    {category}
                                </h4>
                                <div className="grid grid-cols-8 gap-1">
                                    {getIconsByCategory(category).map(({ name }) => {
                                        const IconComponent = getHeroiconByName(name);
                                        const isSelected =
                                            currentIcon?.type === 'heroicon' &&
                                            currentIcon.value === name;

                                        return IconComponent ? (
                                            <button
                                                key={name}
                                                onClick={() => handleHeroiconSelect(name)}
                                                className={`p-2 rounded hover:bg-muted transition-colors ${
                                                    isSelected
                                                        ? 'bg-primary/10 ring-1 ring-primary'
                                                        : ''
                                                }`}
                                                title={name.replace('Icon', '')}
                                            >
                                                <IconComponent className="h-4 w-4 text-foreground" />
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
                                            className={`p-2 rounded hover:bg-muted transition-colors text-lg ${
                                                isSelected
                                                    ? 'bg-primary/10 ring-1 ring-primary'
                                                    : ''
                                            }`}
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
            {currentIcon && (
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

export default IconPicker;
