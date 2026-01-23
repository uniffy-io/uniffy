/**
 * Note icon constants - pure data definitions for note icons.
 * This file contains only constants and types, no React components or JSX.
 *
 * For rendering icons, import from noteIcons.tsx instead.
 */

import {
    DocumentTextIcon,
    DocumentIcon,
    DocumentChartBarIcon,
    ClipboardDocumentIcon,
    NewspaperIcon,
    BookOpenIcon,
    BookmarkIcon,
    StarIcon,
    HeartIcon,
    LightBulbIcon,
    FlagIcon,
    FireIcon,
    BoltIcon,
    SparklesIcon,
    GlobeAltIcon,
    KeyIcon,
    LockClosedIcon,
    ChatBubbleLeftIcon,
    EnvelopeIcon,
    PhoneIcon,
    MegaphoneIcon,
    CodeBracketIcon,
    MusicalNoteIcon,
    PuzzlePieceIcon,
    WrenchIcon,
    BeakerIcon,
    CameraIcon,
    PaintBrushIcon,
    SunIcon,
    MoonIcon,
    CloudIcon,
    UserIcon,
    UsersIcon,
    AcademicCapIcon,
    UserGroupIcon,
    CurrencyDollarIcon,
    BanknotesIcon,
    CreditCardIcon,
    CheckCircleIcon,
    ExclamationCircleIcon,
    QuestionMarkCircleIcon,
    InformationCircleIcon,
    XCircleIcon,
    FolderIcon,
    TagIcon,
    ArchiveBoxIcon,
    InboxIcon,
    Squares2X2Icon,
    RocketLaunchIcon,
    TrophyIcon,
    GiftIcon,
    CakeIcon,
    ShoppingCartIcon,
    ClockIcon,
    CalendarIcon,
    CalendarDaysIcon,
    LinkIcon,
} from '@heroicons/react/24/outline';

/** Icon type - either a heroicon name or an emoji */
export interface NoteIcon {
    type: 'heroicon' | 'emoji';
    value: string;
}

/**
 * Map of all supported heroicon names to their React components.
 * Used for rendering icons in React components and hover cards.
 */
export const HEROICON_COMPONENTS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
    // Documents
    DocumentTextIcon,
    DocumentIcon,
    DocumentChartBarIcon,
    ClipboardDocumentIcon,
    NewspaperIcon,
    BookOpenIcon,
    BookmarkIcon,
    // Objects
    StarIcon,
    HeartIcon,
    LightBulbIcon,
    FlagIcon,
    FireIcon,
    BoltIcon,
    SparklesIcon,
    GlobeAltIcon,
    KeyIcon,
    LockClosedIcon,
    // Communication
    ChatBubbleLeftIcon,
    EnvelopeIcon,
    PhoneIcon,
    MegaphoneIcon,
    // Activities
    CodeBracketIcon,
    MusicalNoteIcon,
    PuzzlePieceIcon,
    WrenchIcon,
    BeakerIcon,
    CameraIcon,
    PaintBrushIcon,
    // Nature
    SunIcon,
    MoonIcon,
    CloudIcon,
    // People
    UserIcon,
    UsersIcon,
    AcademicCapIcon,
    UserGroupIcon,
    // Finance
    CurrencyDollarIcon,
    BanknotesIcon,
    CreditCardIcon,
    // Status
    CheckCircleIcon,
    ExclamationCircleIcon,
    QuestionMarkCircleIcon,
    InformationCircleIcon,
    XCircleIcon,
    // Categories
    FolderIcon,
    TagIcon,
    ArchiveBoxIcon,
    InboxIcon,
    Squares2X2Icon,
    // Actions
    RocketLaunchIcon,
    TrophyIcon,
    GiftIcon,
    CakeIcon,
    ShoppingCartIcon,
    // Time
    ClockIcon,
    CalendarIcon,
    CalendarDaysIcon,
    // Misc
    LinkIcon,
};

/**
 * Get a heroicon React component by name.
 * Falls back to DocumentTextIcon if not found.
 */
export function getHeroiconComponent(name: string): React.ComponentType<{ className?: string; style?: React.CSSProperties }> {
    return HEROICON_COMPONENTS[name] || DocumentTextIcon;
}

/**
 * Curated list of heroicons suitable for notes.
 * Each icon includes a name and category for organization in the picker.
 */
export const CURATED_HEROICONS = [
    // Documents
    { name: 'DocumentTextIcon', category: 'Documents' },
    { name: 'DocumentIcon', category: 'Documents' },
    { name: 'DocumentChartBarIcon', category: 'Documents' },
    { name: 'ClipboardDocumentIcon', category: 'Documents' },
    { name: 'NewspaperIcon', category: 'Documents' },
    { name: 'BookOpenIcon', category: 'Documents' },
    { name: 'BookmarkIcon', category: 'Documents' },

    // Objects
    { name: 'StarIcon', category: 'Objects' },
    { name: 'HeartIcon', category: 'Objects' },
    { name: 'LightBulbIcon', category: 'Objects' },
    { name: 'FlagIcon', category: 'Objects' },
    { name: 'FireIcon', category: 'Objects' },
    { name: 'BoltIcon', category: 'Objects' },
    { name: 'SparklesIcon', category: 'Objects' },
    { name: 'GlobeAltIcon', category: 'Objects' },
    { name: 'KeyIcon', category: 'Objects' },
    { name: 'LockClosedIcon', category: 'Objects' },

    // Communication
    { name: 'ChatBubbleLeftIcon', category: 'Communication' },
    { name: 'EnvelopeIcon', category: 'Communication' },
    { name: 'PhoneIcon', category: 'Communication' },
    { name: 'MegaphoneIcon', category: 'Communication' },

    // Activities
    { name: 'CodeBracketIcon', category: 'Activities' },
    { name: 'MusicalNoteIcon', category: 'Activities' },
    { name: 'PuzzlePieceIcon', category: 'Activities' },
    { name: 'WrenchIcon', category: 'Activities' },
    { name: 'BeakerIcon', category: 'Activities' },
    { name: 'CameraIcon', category: 'Activities' },
    { name: 'PaintBrushIcon', category: 'Activities' },

    // Nature
    { name: 'SunIcon', category: 'Nature' },
    { name: 'MoonIcon', category: 'Nature' },
    { name: 'CloudIcon', category: 'Nature' },

    // People
    { name: 'UserIcon', category: 'People' },
    { name: 'UsersIcon', category: 'People' },
    { name: 'AcademicCapIcon', category: 'People' },
    { name: 'UserGroupIcon', category: 'People' },

    // Finance
    { name: 'CurrencyDollarIcon', category: 'Finance' },
    { name: 'BanknotesIcon', category: 'Finance' },
    { name: 'CreditCardIcon', category: 'Finance' },

    // Status
    { name: 'CheckCircleIcon', category: 'Status' },
    { name: 'ExclamationCircleIcon', category: 'Status' },
    { name: 'QuestionMarkCircleIcon', category: 'Status' },
    { name: 'InformationCircleIcon', category: 'Status' },
    { name: 'XCircleIcon', category: 'Status' },

    // Categories
    { name: 'FolderIcon', category: 'Categories' },
    { name: 'TagIcon', category: 'Categories' },
    { name: 'ArchiveBoxIcon', category: 'Categories' },
    { name: 'InboxIcon', category: 'Categories' },
    { name: 'Squares2X2Icon', category: 'Categories' },

    // Actions
    { name: 'RocketLaunchIcon', category: 'Actions' },
    { name: 'TrophyIcon', category: 'Actions' },
    { name: 'GiftIcon', category: 'Actions' },
    { name: 'CakeIcon', category: 'Actions' },
    { name: 'ShoppingCartIcon', category: 'Actions' },

    // Time
    { name: 'ClockIcon', category: 'Time' },
    { name: 'CalendarIcon', category: 'Time' },
    { name: 'CalendarDaysIcon', category: 'Time' },
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
    const categories = new Set(CURATED_HEROICONS.map(icon => icon.category));
    return Array.from(categories);
}

/** Get icons by category */
export function getIconsByCategory(category: string): typeof CURATED_HEROICONS[number][] {
    return CURATED_HEROICONS.filter(icon => icon.category === category);
}

/**
 * Check if a heroicon name is valid (exists in the HEROICON_COMPONENTS map).
 */
export function isValidHeroiconName(name: string): boolean {
    return name in HEROICON_COMPONENTS;
}
