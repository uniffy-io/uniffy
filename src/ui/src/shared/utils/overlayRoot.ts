/**
 * Portal target for floating chrome. A fullscreen element hides everything outside it,
 * so overlays opened from a fullscreen call mount inside it; a fullscreen `<html>` still
 * shows `<body>`, and mounting under `<html>` would drop the body's text and font tokens.
 */
export function overlayRoot(doc: Document = document): HTMLElement {
  const fullscreen = doc.fullscreenElement;
  return fullscreen instanceof HTMLElement && fullscreen !== doc.documentElement
    ? fullscreen
    : doc.body;
}
