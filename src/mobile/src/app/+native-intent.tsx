import { getServerUrl } from "@core/config/serverUrl";
import { appPathForLink } from "@shared/lib/appLinks";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return appPathForLink(path, getServerUrl()) ?? "/";
}
