// History API navigation for non-React callers (ProseMirror plugins, event handlers).
// The popstate dispatch is what triggers React Router to re-render.

export function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

export function navigateReplace(path: string): void {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

export function openInNewTab(path: string): void {
  window.open(path, '_blank', 'noopener,noreferrer');
}
