/**
 * Navigation Utilities
 *
 * Provides navigation helpers that can be used outside of React components.
 * This is useful for programmatic navigation from non-React code like
 * ProseMirror plugins, event handlers, etc.
 */

/**
 * Navigate to a path using the browser's History API.
 * This works with React Router's BrowserRouter by pushing to history
 * and dispatching a popstate event.
 */
export function navigateTo(path: string): void {
  // Push the new path to history
  window.history.pushState({}, '', path);

  // Dispatch a popstate event to notify React Router of the change
  // React Router listens for this event to update its internal state
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

/**
 * Navigate to a path, replacing the current history entry.
 * Use this when you don't want the user to be able to go back.
 */
export function navigateReplace(path: string): void {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

/**
 * Open a path in a new tab
 */
export function openInNewTab(path: string): void {
  window.open(path, '_blank', 'noopener,noreferrer');
}
