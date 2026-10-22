// Resolving against a placeholder origin applies the browser's own URL rules (tabs, backslashes,
// protocol-relative forms), so whatever would leave the origin shows up as a different one.
const BASE = "http://app.invalid";

/** The in-app path a sign-in returns to, read from router state that holds a path or a Location. */
export function returnPathFrom(state: unknown): string | null {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  let path: string | null = null;
  if (typeof from === "string") {
    path = from;
  } else if (from && typeof from === "object") {
    const { pathname, search, hash } = from as {
      pathname?: unknown;
      search?: unknown;
      hash?: unknown;
    };
    if (typeof pathname === "string") {
      path = pathname + (typeof search === "string" ? search : "");
      path += typeof hash === "string" ? hash : "";
    }
  }
  if (!path?.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(path, BASE);
  } catch {
    return null;
  }
  return url.origin === BASE ? url.pathname + url.search + url.hash : null;
}
