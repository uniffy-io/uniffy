const STORAGE_KEY_PREFIX = 'uniffy-panel-layout';

export function loadPanelLayout(layoutId: string): Record<string, number> | undefined {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${layoutId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore quota/parse errors.
  }
  return undefined;
}

export function savePanelLayout(layoutId: string, layout: Record<string, number>): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${layoutId}`;
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // Ignore quota errors.
  }
}

export function clearPanelLayout(layoutId: string): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}:${layoutId}`;
    localStorage.removeItem(key);
  } catch {
    // Ignore quota errors.
  }
}
