/**
 * Hook for downloading files directly via ConnectRPC.
 *
 * Use this for images, PDFs, CSVs, and other files that don't need
 * Range-based seeking. For video/audio, use useMediaStream instead.
 *
 * Returns a blob URL that can be used directly in <img>, <iframe>, etc.
 * Uses an LRU cache to avoid re-downloading files when navigating.
 */

import { useState, useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import { filesApi } from '@/features/files/api/filesApi';
import { getCachedBlob, setCachedBlob } from '@/features/files/components/viewer/hooks/blobCache';

interface FileDownloadResult {
    /** Blob URL for the file (use in src attribute) */
    url: string | null;
    /** File content as Blob (for further processing) */
    blob: Blob | null;
    /** MIME type of the file */
    mimeType: string | null;
    /** Filename from server */
    filename: string | null;
    /** Total file size in bytes */
    size: number | null;
    /** Loading state */
    loading: boolean;
    /** Download progress (0-100) */
    progress: number;
    /** Error message if download failed */
    error: string | null;
    /** Retry the download */
    retry: () => void;
}

interface UseFileDownloadOptions {
    /** Skip download (useful for conditional fetching) */
    skip?: boolean;
    /** Specific version ID to download */
    versionId?: string;
}

/**
 * Hook to download a file via ConnectRPC and get a blob URL.
 *
 * @param fileId - The file ID to download
 * @param options - Optional settings
 * @returns Object with url, blob, loading, progress, and error states
 *
 * @example
 * ```tsx
 * const { url, loading, error } = useFileDownload(fileId);
 *
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error} />;
 * return <img src={url} />;
 * ```
 */
export function useFileDownload(
    fileId: string | null,
    options?: UseFileDownloadOptions
): FileDownloadResult {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    const [url, setUrl] = useState<string | null>(null);
    const [blob, setBlob] = useState<Blob | null>(null);
    const [mimeType, setMimeType] = useState<string | null>(null);
    const [filename, setFilename] = useState<string | null>(null);
    const [size, setSize] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    // Track the current URL for cleanup
    const urlRef = useRef<string | null>(null);

    const retry = () => {
        setRetryCount((c) => c + 1);
    };

    useEffect(() => {
        // Skip if no file ID, no org, or skip option is set
        if (!fileId || !organizationId || options?.skip) {
            return;
        }

        // Check cache first
        const cached = getCachedBlob(fileId, options?.versionId);
        if (cached) {
            // Use cached blob - no need to download
            setBlob(cached.blob);
            setUrl(cached.url);
            setMimeType(cached.mimeType);
            setFilename(cached.filename);
            setSize(cached.size);
            setProgress(100);
            setLoading(false);
            setError(null);
            // Store ref for cleanup tracking (but don't revoke - cache owns it)
            urlRef.current = cached.url;
            return;
        }

        let cancelled = false;

        const downloadFile = async () => {
            setLoading(true);
            setProgress(0);
            setError(null);

            try {
                const chunks: Uint8Array[] = [];
                let totalSize = 0;
                let receivedBytes = 0;
                let fileMimeType = 'application/octet-stream';
                let fileFilename = 'file';

                // Stream chunks from backend
                for await (const response of filesApi.downloadFile({
                    fileId,
                    organizationId,
                    versionId: options?.versionId,
                })) {
                    if (cancelled) break;

                    chunks.push(response.data);
                    receivedBytes += response.data.length;

                    // Extract metadata from first chunk
                    if (response.chunkNumber === 1) {
                        totalSize = Number(response.totalSize);
                        fileMimeType = response.mimeType || 'application/octet-stream';
                        fileFilename = response.filename || 'file';
                    }

                    // Update progress
                    if (totalSize > 0) {
                        setProgress(Math.round((receivedBytes / totalSize) * 100));
                    }
                }

                if (cancelled) return;

                // Combine chunks into single buffer
                const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }

                // Create blob and URL
                const fileBlob = new Blob([combined], { type: fileMimeType });
                const blobUrl = URL.createObjectURL(fileBlob);

                // Cache the blob for future use (cache manages URL lifecycle)
                setCachedBlob(fileId, fileBlob, blobUrl, fileMimeType, fileFilename, options?.versionId);

                // Store ref (but don't revoke on unmount - cache owns it now)
                urlRef.current = blobUrl;

                setBlob(fileBlob);
                setUrl(blobUrl);
                setMimeType(fileMimeType);
                setFilename(fileFilename);
                setSize(totalLength);
                setProgress(100);
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : 'Download failed';
                    setError(message);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        downloadFile();

        return () => {
            cancelled = true;
        };
    }, [fileId, organizationId, options?.skip, options?.versionId, retryCount]);

    // Note: We don't revoke URLs on unmount because the cache now owns them.
    // The cache handles URL lifecycle with LRU eviction.
    // This allows navigating back to previously viewed files without re-downloading.
    useEffect(() => {
        return () => {
            // Clear local ref but don't revoke (cache manages the URL)
            urlRef.current = null;
        };
    }, []);

    return {
        url,
        blob,
        mimeType,
        filename,
        size,
        loading,
        progress,
        error,
        retry,
    };
}

/**
 * Simplified hook that just returns the blob URL.
 * Returns null while loading or on error.
 */
export function useFileUrl(fileId: string | null, options?: UseFileDownloadOptions): string | null {
    const { url } = useFileDownload(fileId, options);
    return url;
}
