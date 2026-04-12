/**
 * Icon Picker - Public Exports
 *
 * A shared icon picker component for selecting Phosphor icons or emojis.
 */

// Main component
export { IconPicker } from '@/components/icon-picker/IconPicker';

export type { IconValue, NoteIcon } from '@/components/icon-picker/iconConstants';

export {
    ICON_COMPONENTS,
    CURATED_ICONS,
    COMMON_EMOJIS,
    getIconComponent,
    getIconCategories,
    getIconsByCategory,
    isValidIconName,
} from '@/components/icon-picker/iconConstants';

// Utilities
export {
    renderIcon,
    getIconByName,
    getIconSvgPaths,
    drawIconOnCanvas,
} from '@/components/icon-picker/iconUtils';
