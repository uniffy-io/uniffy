import { useEffect, useRef } from "react";
import { useAppSelector } from "@/app/hooks";
import { getCachedBlob } from "@/features/files/components/viewer/hooks/blobCache";
import { fetchFileBlob } from "@/features/files/components/viewer/hooks/useFileDownload";

const PREFETCH_MAX_BYTES = 20 * 1024 * 1024;

/** Only blob-viewer types; video/audio stream through the media route and are never prefetched. */
function isPrefetchableMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") || mimeType.startsWith("text/") || mimeType === "application/pdf"
  );
}

function saveDataEnabled(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

/** Warms the blob LRU with the next playlist file so arrow-key switching paints instantly. */
export function usePlaylistPrefetch() {
  const isOpen = useAppSelector((state) => state.fileViewer.isOpen);
  const loading = useAppSelector((state) => state.fileViewer.loading);
  const playlist = useAppSelector((state) => state.fileViewer.playlist);
  const playlistIndex = useAppSelector((state) => state.fileViewer.playlistIndex);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const nextFileId = playlist[playlistIndex + 1] ?? null;
  const nextFile = useAppSelector((state) =>
    nextFileId ? (state.files.files[nextFileId] ?? null) : null,
  );

  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isOpen || loading || !organizationId || !nextFile) return;
    if (inFlightRef.current) return;
    if (saveDataEnabled()) return;
    if (!isPrefetchableMime(nextFile.mimeType)) return;
    if (nextFile.sizeBytes > PREFETCH_MAX_BYTES) return;
    if (getCachedBlob(nextFile.id)) return;

    let cancelled = false;
    // Called through window so the native functions keep their receiver.
    const hasIdleCallback = "requestIdleCallback" in window;
    const schedule = (cb: () => void) =>
      hasIdleCallback ? window.requestIdleCallback(cb) : window.setTimeout(cb, 300);
    const cancelSchedule = (handle: number) => {
      if (hasIdleCallback) {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };

    const handle = schedule(() => {
      if (cancelled) return;
      inFlightRef.current = true;
      void fetchFileBlob(nextFile.id, organizationId, { isCancelled: () => cancelled })
        .catch(() => null)
        .finally(() => {
          inFlightRef.current = false;
        });
    });

    return () => {
      cancelled = true;
      cancelSchedule(handle);
    };
  }, [isOpen, loading, organizationId, nextFile]);
}
