export function restoreComposeFocus(root: HTMLElement | null, editor: HTMLElement | null): void {
  if (!root?.isConnected || !editor?.isConnected || !root.contains(editor)) return;
  const { activeElement, body } = editor.ownerDocument;
  // Sending may blur an inert composer; preserve focus moved to another pane or dialog.
  if (activeElement === body || root.contains(activeElement)) {
    editor.focus({ preventScroll: true });
  }
}
