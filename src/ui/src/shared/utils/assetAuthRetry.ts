import { refreshAccessToken } from "@/config/api";

// Same-origin asset reads authenticated by the HttpOnly asset cookie. If the cookie lapsed (idle past
// its TTL), the <img>/<video> 401s; refreshing the access token re-sets the cookie, then a cache-busted
// reload of the element succeeds.
const AUTHED_ASSET_RE = /^\/api\/(files|thumbnails|media|avatars|agents\/avatars)\//;

const retried = new WeakSet<Element>();
let refreshInFlight: Promise<unknown> | null = null;

function retryAuthedAsset(el: HTMLImageElement | HTMLMediaElement): void {
  if (retried.has(el)) return; // one retry per element - a persistent failure is not an auth lapse
  const src = el.getAttribute("src");
  if (!src) return;
  let pathname: string;
  try {
    pathname = new URL(src, window.location.origin).pathname;
  } catch {
    return;
  }
  if (!AUTHED_ASSET_RE.test(pathname)) return;

  retried.add(el);
  // Coalesce concurrent failures behind a single refresh so a gallery of broken images refreshes once.
  refreshInFlight =
    refreshInFlight ??
    refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  refreshInFlight
    .then(() => {
      const sep = src.includes("?") ? "&" : "?";
      el.setAttribute("src", `${src}${sep}_r=${Date.now()}`);
    })
    .catch(() => undefined);
}

/** Install once at boot: a capture-phase listener that retries authed assets after a cookie refresh. */
export function installAssetAuthErrorHandler(): void {
  // `error` events do not bubble, so the listener must run in the capture phase.
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement || target instanceof HTMLMediaElement) {
        retryAuthedAsset(target);
      }
    },
    true,
  );
}
