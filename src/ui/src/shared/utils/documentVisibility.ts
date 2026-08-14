/**
 * True when this tab is the one on screen (not hidden/minimized/backgrounded).
 * Prefer this over document.hasFocus() for "is the user looking at this": focus
 * drops the moment another window/tab takes it (e.g. sending from a second
 * window), while a side-by-side or foreground tab stays visible.
 */
export function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
