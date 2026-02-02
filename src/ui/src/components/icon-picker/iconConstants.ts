/**
 * Icon Picker Constants
 *
 * Pure data definitions for the icon picker component.
 * Contains icon mappings, categories, and emoji presets.
 */

import type { Icon } from '@phosphor-icons/react';
import {
    // Documents
    FileText,
    File,
    ChartBar,
    ClipboardText,
    Newspaper,
    BookOpen,
    BookmarkSimple,
    Article,
    Notebook,
    Note,
    // File Types
    FileImage,
    FileVideo,
    FileAudio,
    FilePdf,
    FileDoc,
    FileZip,
    FileCode,
    FileCss,
    FileHtml,
    FileJs,
    FileTs,
    FileSql,
    FileCsv,
    FileXls,
    FilePpt,
    // Filters & Search
    Funnel,
    FunnelSimple,
    MagnifyingGlass,
    Sliders,
    SlidersHorizontal,
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
    LockOpen,
    Shield,
    ShieldCheck,
    Bell,
    Alarm,
    // Communication
    ChatCircle,
    Envelope,
    Phone,
    Megaphone,
    At,
    ChatDots,
    // Development
    CodeBlock,
    Code,
    Terminal,
    Bug,
    GitBranch,
    Database,
    Cloud,
    CloudArrowUp,
    CloudArrowDown,
    // Creative
    MusicNote,
    PuzzlePiece,
    Wrench,
    Flask,
    Camera,
    PaintBrush,
    Palette,
    PencilSimple,
    Pen,
    Eraser,
    // Nature
    Sun,
    Moon,
    CloudSun,
    Drop,
    Leaf,
    Tree,
    Flower,
    // People
    User,
    Users,
    GraduationCap,
    UsersThree,
    UserCircle,
    AddressBook,
    // Finance
    CurrencyDollar,
    Money,
    CreditCard,
    Bank,
    Wallet,
    Receipt,
    // Status
    CheckCircle,
    WarningCircle,
    Question,
    Info,
    XCircle,
    Prohibit,
    Check,
    X,
    // Organization
    Folder,
    FolderOpen,
    FolderPlus,
    Tag,
    Archive,
    Tray,
    SquaresFour,
    List,
    ListBullets,
    ListNumbers,
    // Actions
    Rocket,
    Trophy,
    Gift,
    Cake,
    ShoppingCart,
    Download,
    Upload,
    Share,
    Export,
    // Time
    Clock,
    Calendar,
    CalendarBlank,
    CalendarCheck,
    Timer,
    Hourglass,
    // Navigation
    House,
    MapPin,
    Compass,
    CaretRight,
    ArrowRight,
    // Misc
    Link,
    LinkBreak,
    Hash,
    Percent,
    Power,
    Gear,
    Trash,
    Eye,
    EyeSlash,
    Copy,
    Clipboard,
    QrCode,
    Fingerprint,
    Cpu,
    HardDrive,
    Desktop,
    DeviceMobile,
    Airplane,
    Car,
    Bicycle,
    Train,
    GameController,
    Headphones,
    Microphone,
    VideoCamera,
    Image,
    Images,
    Play,
    Pause,
    Stop,
    SkipForward,
    SkipBack,
} from '@phosphor-icons/react';

/** Icon value type - either a phosphor icon name or an emoji */
export interface IconValue {
    type: 'icon' | 'emoji';
    value: string;
}

/** Legacy alias for backwards compatibility */
export type NoteIcon = IconValue;

/**
 * Map of all supported icon names to their React components.
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
    Article,
    Notebook,
    Note,
    // File Types
    FileImage,
    FileVideo,
    FileAudio,
    FilePdf,
    FileDoc,
    FileZip,
    FileCode,
    FileCss,
    FileHtml,
    FileJs,
    FileTs,
    FileSql,
    FileCsv,
    FileXls,
    FilePpt,
    // Filters & Search
    Funnel,
    FunnelSimple,
    MagnifyingGlass,
    Sliders,
    SlidersHorizontal,
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
    LockOpen,
    Shield,
    ShieldCheck,
    Bell,
    Alarm,
    // Communication
    ChatCircle,
    Envelope,
    Phone,
    Megaphone,
    At,
    ChatDots,
    // Development
    CodeBlock,
    Code,
    Terminal,
    Bug,
    GitBranch,
    Database,
    Cloud,
    CloudArrowUp,
    CloudArrowDown,
    // Creative
    MusicNote,
    PuzzlePiece,
    Wrench,
    Flask,
    Camera,
    PaintBrush,
    Palette,
    PencilSimple,
    Pen,
    Eraser,
    // Nature
    Sun,
    Moon,
    CloudSun,
    Drop,
    Leaf,
    Tree,
    Flower,
    // People
    User,
    Users,
    GraduationCap,
    UsersThree,
    UserCircle,
    AddressBook,
    // Finance
    CurrencyDollar,
    Money,
    CreditCard,
    Bank,
    Wallet,
    Receipt,
    // Status
    CheckCircle,
    WarningCircle,
    Question,
    Info,
    XCircle,
    Prohibit,
    Check,
    X,
    // Organization
    Folder,
    FolderOpen,
    FolderPlus,
    Tag,
    Archive,
    Tray,
    SquaresFour,
    List,
    ListBullets,
    ListNumbers,
    // Actions
    Rocket,
    Trophy,
    Gift,
    Cake,
    ShoppingCart,
    Download,
    Upload,
    Share,
    Export,
    // Time
    Clock,
    Calendar,
    CalendarBlank,
    CalendarCheck,
    Timer,
    Hourglass,
    // Navigation
    House,
    MapPin,
    Compass,
    CaretRight,
    ArrowRight,
    // Misc
    Link,
    LinkBreak,
    Hash,
    Percent,
    Power,
    Gear,
    Trash,
    Eye,
    EyeSlash,
    Copy,
    Clipboard,
    QrCode,
    Fingerprint,
    Cpu,
    HardDrive,
    Desktop,
    DeviceMobile,
    Airplane,
    Car,
    Bicycle,
    Train,
    GameController,
    Headphones,
    Microphone,
    VideoCamera,
    Image,
    Images,
    Play,
    Pause,
    Stop,
    SkipForward,
    SkipBack,
};

/**
 * Get an icon React component by name.
 * Falls back to FileText if not found.
 */
export function getIconComponent(name: string): Icon {
    return ICON_COMPONENTS[name] || FileText;
}

/**
 * Curated list of icons organized by category.
 */
export const CURATED_ICONS = [
    // Documents
    { name: 'FileText', category: 'Documents' },
    { name: 'File', category: 'Documents' },
    { name: 'Article', category: 'Documents' },
    { name: 'Notebook', category: 'Documents' },
    { name: 'Note', category: 'Documents' },
    { name: 'ChartBar', category: 'Documents' },
    { name: 'ClipboardText', category: 'Documents' },
    { name: 'Newspaper', category: 'Documents' },
    { name: 'BookOpen', category: 'Documents' },
    { name: 'BookmarkSimple', category: 'Documents' },

    // File Types
    { name: 'FileImage', category: 'File Types' },
    { name: 'FileVideo', category: 'File Types' },
    { name: 'FileAudio', category: 'File Types' },
    { name: 'FilePdf', category: 'File Types' },
    { name: 'FileDoc', category: 'File Types' },
    { name: 'FileZip', category: 'File Types' },
    { name: 'FileCode', category: 'File Types' },
    { name: 'FileCss', category: 'File Types' },
    { name: 'FileHtml', category: 'File Types' },
    { name: 'FileJs', category: 'File Types' },
    { name: 'FileTs', category: 'File Types' },
    { name: 'FileSql', category: 'File Types' },
    { name: 'FileCsv', category: 'File Types' },
    { name: 'FileXls', category: 'File Types' },
    { name: 'FilePpt', category: 'File Types' },

    // Filters & Search
    { name: 'Funnel', category: 'Filters' },
    { name: 'FunnelSimple', category: 'Filters' },
    { name: 'MagnifyingGlass', category: 'Filters' },
    { name: 'Sliders', category: 'Filters' },
    { name: 'SlidersHorizontal', category: 'Filters' },

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
    { name: 'LockOpen', category: 'Objects' },
    { name: 'Shield', category: 'Objects' },
    { name: 'ShieldCheck', category: 'Objects' },
    { name: 'Bell', category: 'Objects' },

    // Communication
    { name: 'ChatCircle', category: 'Communication' },
    { name: 'ChatDots', category: 'Communication' },
    { name: 'Envelope', category: 'Communication' },
    { name: 'Phone', category: 'Communication' },
    { name: 'Megaphone', category: 'Communication' },
    { name: 'At', category: 'Communication' },

    // Development
    { name: 'CodeBlock', category: 'Development' },
    { name: 'Code', category: 'Development' },
    { name: 'Terminal', category: 'Development' },
    { name: 'Bug', category: 'Development' },
    { name: 'GitBranch', category: 'Development' },
    { name: 'Database', category: 'Development' },
    { name: 'Cloud', category: 'Development' },
    { name: 'Cpu', category: 'Development' },
    { name: 'HardDrive', category: 'Development' },

    // Creative
    { name: 'MusicNote', category: 'Creative' },
    { name: 'PuzzlePiece', category: 'Creative' },
    { name: 'Flask', category: 'Creative' },
    { name: 'Camera', category: 'Creative' },
    { name: 'PaintBrush', category: 'Creative' },
    { name: 'Palette', category: 'Creative' },
    { name: 'PencilSimple', category: 'Creative' },
    { name: 'Image', category: 'Creative' },
    { name: 'VideoCamera', category: 'Creative' },
    { name: 'Microphone', category: 'Creative' },

    // Nature
    { name: 'Sun', category: 'Nature' },
    { name: 'Moon', category: 'Nature' },
    { name: 'CloudSun', category: 'Nature' },
    { name: 'Drop', category: 'Nature' },
    { name: 'Leaf', category: 'Nature' },
    { name: 'Tree', category: 'Nature' },
    { name: 'Flower', category: 'Nature' },

    // People
    { name: 'User', category: 'People' },
    { name: 'Users', category: 'People' },
    { name: 'UsersThree', category: 'People' },
    { name: 'UserCircle', category: 'People' },
    { name: 'GraduationCap', category: 'People' },
    { name: 'AddressBook', category: 'People' },

    // Finance
    { name: 'CurrencyDollar', category: 'Finance' },
    { name: 'Money', category: 'Finance' },
    { name: 'CreditCard', category: 'Finance' },
    { name: 'Bank', category: 'Finance' },
    { name: 'Wallet', category: 'Finance' },
    { name: 'Receipt', category: 'Finance' },

    // Status
    { name: 'CheckCircle', category: 'Status' },
    { name: 'Check', category: 'Status' },
    { name: 'WarningCircle', category: 'Status' },
    { name: 'Question', category: 'Status' },
    { name: 'Info', category: 'Status' },
    { name: 'XCircle', category: 'Status' },
    { name: 'Prohibit', category: 'Status' },

    // Organization
    { name: 'Folder', category: 'Organization' },
    { name: 'FolderOpen', category: 'Organization' },
    { name: 'FolderPlus', category: 'Organization' },
    { name: 'Tag', category: 'Organization' },
    { name: 'Archive', category: 'Organization' },
    { name: 'Tray', category: 'Organization' },
    { name: 'SquaresFour', category: 'Organization' },
    { name: 'List', category: 'Organization' },
    { name: 'ListBullets', category: 'Organization' },

    // Actions
    { name: 'Rocket', category: 'Actions' },
    { name: 'Trophy', category: 'Actions' },
    { name: 'Gift', category: 'Actions' },
    { name: 'Cake', category: 'Actions' },
    { name: 'ShoppingCart', category: 'Actions' },
    { name: 'Download', category: 'Actions' },
    { name: 'Upload', category: 'Actions' },
    { name: 'Share', category: 'Actions' },
    { name: 'Wrench', category: 'Actions' },
    { name: 'Gear', category: 'Actions' },

    // Time
    { name: 'Clock', category: 'Time' },
    { name: 'Calendar', category: 'Time' },
    { name: 'CalendarBlank', category: 'Time' },
    { name: 'CalendarCheck', category: 'Time' },
    { name: 'Timer', category: 'Time' },
    { name: 'Hourglass', category: 'Time' },

    // Navigation
    { name: 'House', category: 'Navigation' },
    { name: 'MapPin', category: 'Navigation' },
    { name: 'Compass', category: 'Navigation' },
    { name: 'Link', category: 'Navigation' },

    // Media
    { name: 'Play', category: 'Media' },
    { name: 'Pause', category: 'Media' },
    { name: 'Stop', category: 'Media' },
    { name: 'Headphones', category: 'Media' },
    { name: 'GameController', category: 'Media' },

    // Devices
    { name: 'Desktop', category: 'Devices' },
    { name: 'DeviceMobile', category: 'Devices' },
    { name: 'Airplane', category: 'Devices' },
    { name: 'Car', category: 'Devices' },
] as const;

/** Common emojis for quick access */
export const COMMON_EMOJIS = [
    // Work & Productivity
    '📝', '📋', '📌', '💡', '🎯', '✅', '📊', '💼',
    // Status & Reactions
    '⭐', '❤️', '🔥', '⚡', '🌟', '💎', '✨', '👍',
    // Categories
    '📁', '🏷️', '🔖', '📚', '🗂️', '📂', '🔑', '🔒',
    // Creative
    '🎨', '🎵', '📷', '🎬', '🎮', '🎧', '🖼️', '🎭',
    // Nature & Objects
    '🌈', '☀️', '🌙', '⭐', '🌸', '🍀', '🌊', '🔮',
    // People & Activities
    '🚀', '🏆', '🎁', '🎉', '🎊', '💪', '🙌', '👏',
    // Food & Drink
    '☕', '🍕', '🍔', '🍎', '🍰', '🍩', '🥤', '🍿',
    // Travel
    '✈️', '🚗', '🏠', '🌍', '🗺️', '🏝️', '🏔️', '🌆',
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
