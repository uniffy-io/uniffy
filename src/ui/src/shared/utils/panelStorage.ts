/**
 * Panel Layout Storage
 *
 * Shared utility for persisting resizable panel layouts to localStorage.
 * Used by NotesLayout, CalendarLayout, and other panel-based layouts.
 */

const STORAGE_KEY_PREFIX = 'uniffy-panel-layout';

/**
 * Load a saved panel layout from localStorage.
 * @param layoutId Unique identifier for the layout (e.g., 'notes', 'calendar')
 * @returns The saved layout or undefined if not found
 */
export function loadPanelLayout(layoutId: string): Record<string, number> | undefined {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${layoutId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Save a panel layout to localStorage.
 * @param layoutId Unique identifier for the layout (e.g., 'notes', 'calendar')
 * @param layout The layout to save (map of panel id to size)
 */
export function savePanelLayout(layoutId: string, layout: Record<string, number>): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${layoutId}`;
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // Ignore errors
  }
}

/**
 * Clear a saved panel layout from localStorage.
 * @param layoutId Unique identifier for the layout
 */
export function clearPanelLayout(layoutId: string): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${layoutId}`;
    localStorage.removeItem(key);
  } catch {
    // Ignore errors
  }
}
