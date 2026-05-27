/** For images/PDFs/etc. that don't need Range-based seeking; for video/audio use useMediaStream. */

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
                const chunks: Uint8Array[] = [];
                let totalSize = 0;
                let receivedBytes = 0;
                let fileMimeType = 'application/octet-stream';
                let fileFilename = 'file';

                for await (const response of filesApi.downloadFile({
                    fileId,
                    organizationId,
                    versionId: options?.versionId,
                })) {
                    if (cancelled) break;

                    chunks.push(response.data);
                    receivedBytes += response.data.length;

                    if (response.chunkNumber === 1) {
                        totalSize = Number(response.totalSize);
                        fileMimeType = response.mimeType || 'application/octet-stream';
                        fileFilename = response.filename || 'file';
                    }

                    if (totalSize > 0) {
                        setProgress(Math.round((receivedBytes / totalSize) * 100));
                    }
                }

                if (cancelled) return;

                const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }

                const fileBlob = new Blob([combined], { type: fileMimeType });
                const blobUrl = URL.createObjectURL(fileBlob);

                // The cache assumes ownership of the blob URL (lifecycle handled by LRU eviction).
                setCachedBlob(fileId, fileBlob, blobUrl, fileMimeType, fileFilename, options?.versionId);

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
