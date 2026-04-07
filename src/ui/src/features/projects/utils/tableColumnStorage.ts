/**
 * Table Column Storage
 *
 * Persists per-project table column state (widths and hidden columns) to localStorage.
 * Keyed by project ID so each project has its own column layout.
 */

const WIDTHS_STORAGE_KEY = "uniffy-projects-column-widths";
const HIDDEN_STORAGE_KEY = "uniffy-projects-hidden-columns";

/**
 * Shape: { [projectId]: { [fieldId]: width } }
 */
export type ColumnWidthsByProject = Record<string, Record<string, number>>;

/**
 * Shape: { [projectId]: fieldId[] }
 */
export type HiddenColumnsByProject = Record<string, string[]>;

/**
 * Load all persisted column widths from localStorage.
 */
export function loadColumnWidths(): ColumnWidthsByProject {
  try {
    const stored = localStorage.getItem(WIDTHS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {
    // Ignore errors
  }
  return {};
}

/**
 * Save all column widths to localStorage.
 */
export function saveColumnWidths(widths: ColumnWidthsByProject): void {
  try {
    localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore errors
  }
}

/**
 * Load hidden columns from localStorage.
 */
export function loadHiddenColumns(): HiddenColumnsByProject {
  try {
    const stored = localStorage.getItem(HIDDEN_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {
    // Ignore errors
  }
  return {};
}

/**
 * Save hidden columns to localStorage.
 */
export function saveHiddenColumns(hidden: HiddenColumnsByProject): void {
  try {
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // Ignore errors
  }
}
