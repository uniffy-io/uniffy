import { getServerUrl, hydrateServerUrl } from "@core/config/serverUrl";
import { appPathForLink } from "@shared/lib/appLinks";

export async function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (initial) await hydrateServerUrl();
  return appPathForLink(path, getServerUrl()) ?? "/";
}
