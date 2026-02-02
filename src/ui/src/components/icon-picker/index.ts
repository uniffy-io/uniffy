/**
 * Icon Picker - Public Exports
 *
 * A shared icon picker component for selecting Phosphor icons or emojis.
 */

// Main component
export { IconPicker } from './IconPicker';

// Types
export type { IconValue, NoteIcon } from './iconConstants';

// Constants
export {
    ICON_COMPONENTS,
    CURATED_ICONS,
    COMMON_EMOJIS,
    getIconComponent,
    getIconCategories,
    getIconsByCategory,
    isValidIconName,
} from './iconConstants';

// Utilities
export {
    renderIcon,
    getIconByName,
    getIconSvgPaths,
    drawIconOnCanvas,
} from './iconUtils';
