const WIDTHS_STORAGE_KEY = "uniffy-projects-column-widths";
const HIDDEN_STORAGE_KEY = "uniffy-projects-hidden-columns";

export type ColumnWidthsByProject = Record<string, Record<string, number>>;

export type HiddenColumnsByProject = Record<string, string[]>;

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

export function saveColumnWidths(widths: ColumnWidthsByProject): void {
  try {
    localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore errors
  }
}

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

export function saveHiddenColumns(hidden: HiddenColumnsByProject): void {
  try {
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // Ignore errors
  }
}
