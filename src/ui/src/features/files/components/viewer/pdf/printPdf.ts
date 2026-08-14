/**
 * Prints a PDF through an invisible same-origin iframe (the cookie-authenticated
 * media URL; blob: URLs are forbidden by the CSP frame-src fallback). afterprint
 * does not fire reliably for browser PDF plugins, so a safety timeout removes the
 * iframe either way.
 */
export function printPdf(url: string): void {
  const iframe = document.createElement("iframe");
  // display:none keeps Chrome's PDF plugin from initializing (print() no-ops);
  // an invisible zero-size frame renders but stays out of view.
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.style.visibility = "hidden";
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = url;

  const cleanup = () => {
    window.clearTimeout(timeout);
    iframe.remove();
  };
  const timeout = window.setTimeout(cleanup, 60_000);

  iframe.addEventListener("load", () => {
    // Frame-window access throws when the frame ended up cross-origin
    // (e.g. a CSP-blocked error page); the timeout still cleans up.
    try {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        cleanup();
        return;
      }
      frameWindow.addEventListener("afterprint", cleanup);
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
    }
  });

  document.body.appendChild(iframe);
}
