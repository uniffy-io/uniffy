/**
 * Note icon constants - re-exports from the shared icon picker component.
 *
 * This file maintains backwards compatibility for the notes domain.
 * For new code, import directly from '@/components/icon-picker'.
 */

// Re-export everything from the shared icon picker
export {
    type IconValue,
    type NoteIcon,
    ICON_COMPONENTS,
    CURATED_ICONS,
    COMMON_EMOJIS,
    getIconComponent,
    getIconCategories,
    getIconsByCategory,
    isValidIconName,
} from '@/components/icon-picker';
