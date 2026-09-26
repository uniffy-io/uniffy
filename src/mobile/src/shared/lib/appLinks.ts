const APP_SCHEME = "uniffy:";

const PROJECT_PATH = /^\/projects\/([^/?#]+)\/?$/;

/**
 * The app route for a link to this deployment's web app, or null when the phone has no screen
 * for it. Takes `uniffy://` links and links on the signed-in server's own origin, so a view link
 * copied on the web opens the same view here.
 */
export function appPathForLink(link: string, serverOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(link, serverOrigin);
  } catch {
    return null;
  }

  let path: string;
  if (url.protocol === APP_SCHEME) {
    // `uniffy://projects/1` parses with `projects` as the host.
    path = `/${url.host}${url.pathname}`.replace(/\/+$/, "");
  } else if (url.origin === new URL(serverOrigin).origin) {
    path = url.pathname;
  } else {
    return null;
  }

  const project = PROJECT_PATH.exec(path);
  if (!project) return null;
  const viewId = url.searchParams.get("view");
  const base = `/projects/${project[1]}`;
  return viewId ? `${base}?view=${encodeURIComponent(viewId)}` : base;
}
