/**
 * Note icon constants - pure data definitions for note icons.
 * This file contains only constants and types, no React components or JSX.
 *
 * For rendering icons, import from noteIcons.tsx instead.
 */

import type { Icon } from '@phosphor-icons/react';
import {
    FileText,
    File,
    ChartBar,
    ClipboardText,
    Newspaper,
    BookOpen,
    BookmarkSimple,
    Star,
    Heart,
    Lightbulb,
    Flag,
    Fire,
    Lightning,
    Sparkle,
    Globe,
    Key,
    Lock,
    ChatCircle,
    Envelope,
    Phone,
    Megaphone,
    CodeBlock,
    MusicNote,
    PuzzlePiece,
    Wrench,
    Flask,
    Camera,
    PaintBrush,
    Sun,
    Moon,
    Cloud,
    User,
    Users,
    GraduationCap,
    UsersThree,
    CurrencyDollar,
    Money,
    CreditCard,
    CheckCircle,
    WarningCircle,
    Question,
    Info,
    XCircle,
    Folder,
    Tag,
    Archive,
    Tray,
    SquaresFour,
    Rocket,
    Trophy,
    Gift,
    Cake,
    ShoppingCart,
    Clock,
    Calendar,
    CalendarBlank,
    Link,
} from '@phosphor-icons/react';

/** Icon type - either a phosphor icon name or an emoji */
export interface NoteIcon {
    type: 'icon' | 'emoji';
    value: string;
}

/**
 * Map of all supported icon names to their React components.
 * Used for rendering icons in React components and hover cards.
 */
export const ICON_COMPONENTS: Record<string, Icon> = {
    // Documents
    FileText,
    File,
    ChartBar,
    ClipboardText,
    Newspaper,
    BookOpen,
    BookmarkSimple,
    // Objects
    Star,
    Heart,
    Lightbulb,
    Flag,
    Fire,
    Lightning,
    Sparkle,
    Globe,
    Key,
    Lock,
    // Communication
    ChatCircle,
    Envelope,
    Phone,
    Megaphone,
    // Activities
    CodeBlock,
    MusicNote,
    PuzzlePiece,
    Wrench,
    Flask,
    Camera,
    PaintBrush,
    // Nature
    Sun,
    Moon,
    Cloud,
    // People
    User,
    Users,
    GraduationCap,
    UsersThree,
    // Finance
    CurrencyDollar,
    Money,
    CreditCard,
    // Status
    CheckCircle,
    WarningCircle,
    Question,
    Info,
    XCircle,
    // Categories
    Folder,
    Tag,
    Archive,
    Tray,
    SquaresFour,
    // Actions
    Rocket,
    Trophy,
    Gift,
    Cake,
    ShoppingCart,
    // Time
    Clock,
    Calendar,
    CalendarBlank,
    // Misc
    Link,
};

/**
 * Get an icon React component by name.
 * Falls back to FileText if not found.
 */
export function getIconComponent(name: string): Icon {
    return ICON_COMPONENTS[name] || FileText;
}

/**
 * Curated list of icons suitable for notes.
 * Each icon includes a name and category for organization in the picker.
 */
export const CURATED_ICONS = [
    // Documents
    { name: 'FileText', category: 'Documents' },
    { name: 'File', category: 'Documents' },
    { name: 'ChartBar', category: 'Documents' },
    { name: 'ClipboardText', category: 'Documents' },
    { name: 'Newspaper', category: 'Documents' },
    { name: 'BookOpen', category: 'Documents' },
    { name: 'BookmarkSimple', category: 'Documents' },

    // Objects
    { name: 'Star', category: 'Objects' },
    { name: 'Heart', category: 'Objects' },
    { name: 'Lightbulb', category: 'Objects' },
    { name: 'Flag', category: 'Objects' },
    { name: 'Fire', category: 'Objects' },
    { name: 'Lightning', category: 'Objects' },
    { name: 'Sparkle', category: 'Objects' },
    { name: 'Globe', category: 'Objects' },
    { name: 'Key', category: 'Objects' },
    { name: 'Lock', category: 'Objects' },

    // Communication
    { name: 'ChatCircle', category: 'Communication' },
    { name: 'Envelope', category: 'Communication' },
    { name: 'Phone', category: 'Communication' },
    { name: 'Megaphone', category: 'Communication' },

    // Activities
    { name: 'CodeBlock', category: 'Activities' },
    { name: 'MusicNote', category: 'Activities' },
    { name: 'PuzzlePiece', category: 'Activities' },
    { name: 'Wrench', category: 'Activities' },
    { name: 'Flask', category: 'Activities' },
    { name: 'Camera', category: 'Activities' },
    { name: 'PaintBrush', category: 'Activities' },

    // Nature
    { name: 'Sun', category: 'Nature' },
    { name: 'Moon', category: 'Nature' },
    { name: 'Cloud', category: 'Nature' },

    // People
    { name: 'User', category: 'People' },
    { name: 'Users', category: 'People' },
    { name: 'GraduationCap', category: 'People' },
    { name: 'UsersThree', category: 'People' },

    // Finance
    { name: 'CurrencyDollar', category: 'Finance' },
    { name: 'Money', category: 'Finance' },
    { name: 'CreditCard', category: 'Finance' },

    // Status
    { name: 'CheckCircle', category: 'Status' },
    { name: 'WarningCircle', category: 'Status' },
    { name: 'Question', category: 'Status' },
    { name: 'Info', category: 'Status' },
    { name: 'XCircle', category: 'Status' },

    // Categories
    { name: 'Folder', category: 'Categories' },
    { name: 'Tag', category: 'Categories' },
    { name: 'Archive', category: 'Categories' },
    { name: 'Tray', category: 'Categories' },
    { name: 'SquaresFour', category: 'Categories' },

    // Actions
    { name: 'Rocket', category: 'Actions' },
    { name: 'Trophy', category: 'Actions' },
    { name: 'Gift', category: 'Actions' },
    { name: 'Cake', category: 'Actions' },
    { name: 'ShoppingCart', category: 'Actions' },

    // Time
    { name: 'Clock', category: 'Time' },
    { name: 'Calendar', category: 'Time' },
    { name: 'CalendarBlank', category: 'Time' },
] as const;

/** Common emojis for quick access in the picker */
export const COMMON_EMOJIS = [
    '📝', '📋', '📌', '💡', '🎯', '⭐', '❤️', '🔥',
    '🚀', '💼', '📚', '🎨', '🔬', '📊', '🗓️', '💻',
    '🎵', '🏆', '🎁', '✅', '⚡', '🌟', '💎', '🔑',
    '📁', '🏠', '✈️', '🎮', '🍕', '☕', '🌈', '🎉',
] as const;

/** Get all unique categories from curated icons */
export function getIconCategories(): string[] {
    const categories = new Set(CURATED_ICONS.map(icon => icon.category));
    return Array.from(categories);
}

/** Get icons by category */
export function getIconsByCategory(category: string): typeof CURATED_ICONS[number][] {
    return CURATED_ICONS.filter(icon => icon.category === category);
}

/**
 * Check if an icon name is valid (exists in the ICON_COMPONENTS map).
 */
export function isValidIconName(name: string): boolean {
    return name in ICON_COMPONENTS;
}
