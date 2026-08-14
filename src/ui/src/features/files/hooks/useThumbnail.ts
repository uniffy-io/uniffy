import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { buildThumbnailUrl } from "@/shared/utils/fileUrls";

interface UseThumbnailUrlResult {
  url: string | null;
  loading: boolean;
}

/** The asset cookie authenticates the `<img>` request, so the URL is available immediately. */
export function useThumbnailUrl(fileId: string | null): UseThumbnailUrlResult {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const url = useMemo(() => {
    if (!fileId || !organizationId) return null;
    return buildThumbnailUrl(organizationId, fileId);
  }, [fileId, organizationId]);

  return { url, loading: false };
}
