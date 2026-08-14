/** Builds `/api/media` URLs for <video>/<audio>; the asset cookie authenticates the Range requests. */

import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { getMediaUrl } from "@/shared/utils/fileUrls";

interface MediaResult {
  url: string | null;
  loading: boolean;
  error: string | null;
}

interface UseMediaOptions {
  /** Request the full file without chunking (audio waveform analysis). */
  full?: boolean;
}

export function useMedia(fileId: string | null, options?: UseMediaOptions): MediaResult {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const url = useMemo(() => {
    if (!fileId || !organizationId) return null;
    return getMediaUrl(organizationId, fileId, { full: options?.full });
  }, [fileId, organizationId, options?.full]);

  if (!fileId) {
    return { url: null, loading: false, error: "No file ID" };
  }
  if (!organizationId) {
    return { url: null, loading: false, error: "No organization selected" };
  }
  return { url, loading: false, error: null };
}

export function useMediaUrl(fileId: string | null, options?: UseMediaOptions): string | null {
  const { url } = useMedia(fileId, options);
  return url;
}
