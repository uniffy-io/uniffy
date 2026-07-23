/** For images/PDFs/etc. that don't need Range-based seeking; for video/audio use useMedia. */

import { useState, useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import { filesApi } from '@/features/files/api/filesApi';
import { getCachedBlob, setCachedBlob } from '@/features/files/components/viewer/hooks/blobCache';

interface FileDownloadResult {
    url: string | null;
    blob: Blob | null;
    mimeType: string | null;
    filename: string | null;
    size: number | null;
    loading: boolean;
    progress: number;
    error: string | null;
    retry: () => void;
}

interface UseFileDownloadOptions {
    skip?: boolean;
    versionId?: string;
}

export interface FetchedFileBlob {
    blob: Blob;
    url: string;
    mimeType: string;
    filename: string;
    size: number;
}

/**
 * Downloads a file into the blob LRU (which assumes ownership of the blob URL).
 * Returns null when cancelled mid-stream.
 */
export async function fetchFileBlob(
    fileId: string,
    organizationId: string,
    options?: {
        versionId?: string;
        onProgress?: (percent: number) => void;
        isCancelled?: () => boolean;
    }
): Promise<FetchedFileBlob | null> {
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    let receivedBytes = 0;
    let mimeType = 'application/octet-stream';
    let filename = 'file';

    for await (const response of filesApi.downloadFile({
        fileId,
        organizationId,
        versionId: options?.versionId,
    })) {
        if (options?.isCancelled?.()) return null;

        chunks.push(response.data);
        receivedBytes += response.data.length;

        if (response.chunkNumber === 1) {
            totalSize = Number(response.totalSize);
            mimeType = response.mimeType || 'application/octet-stream';
            filename = response.filename || 'file';
        }

        if (totalSize > 0) {
            options?.onProgress?.(Math.round((receivedBytes / totalSize) * 100));
        }
    }

    if (options?.isCancelled?.()) return null;

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    const blob = new Blob([combined], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setCachedBlob(fileId, blob, url, mimeType, filename, options?.versionId);

    return { blob, url, mimeType, filename, size: totalLength };
}

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

    const urlRef = useRef<string | null>(null);

    const retry = () => {
        setRetryCount((c) => c + 1);
    };

    useEffect(() => {
        if (!fileId || !organizationId || options?.skip) {
            return;
        }

        const cached = getCachedBlob(fileId, options?.versionId);
        if (cached) {
            setBlob(cached.blob);
            setUrl(cached.url);
            setMimeType(cached.mimeType);
            setFilename(cached.filename);
            setSize(cached.size);
            setProgress(100);
            setLoading(false);
            setError(null);
            // Cache owns the blob URL; do not revoke it here.
            urlRef.current = cached.url;
            return;
        }

        let cancelled = false;

        const downloadFile = async () => {
            setLoading(true);
            setProgress(0);
            setError(null);

            try {
                const result = await fetchFileBlob(fileId, organizationId, {
                    versionId: options?.versionId,
                    onProgress: (percent) => {
                        if (!cancelled) setProgress(percent);
                    },
                    isCancelled: () => cancelled,
                });

                if (cancelled || !result) return;

                // The cache owns the blob URL (lifecycle handled by LRU eviction).
                urlRef.current = result.url;

                setBlob(result.blob);
                setUrl(result.url);
                setMimeType(result.mimeType);
                setFilename(result.filename);
                setSize(result.size);
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

    useEffect(() => {
        return () => {
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

export function useFileUrl(fileId: string | null, options?: UseFileDownloadOptions): string | null {
    const { url } = useFileDownload(fileId, options);
    return url;
}
