/**
 * Note icon rendering utilities - re-exports from the shared icon picker component.
 *
 * This file maintains backwards compatibility for the notes domain.
 * For new code, import directly from '@/components/icon-picker'.
 */

// Re-export from shared icon picker
export {
    renderIcon as renderNoteIcon,
    getIconByName,
    getIconSvgPaths,
    drawIconOnCanvas,
} from '@/components/icon-picker';

// Also export the type for convenience
export type { NoteIcon, IconValue } from '@/components/icon-picker';
