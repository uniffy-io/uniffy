/**
 * ThumbnailImage Component
 *
 * Displays a thumbnail for files using the backend thumbnail proxy.
 * The Service Worker intercepts requests and adds auth headers.
 * Backend serves thumbnails with HTTP cache headers for browser caching.
 */

import { useEffect, useState } from 'react';
import { ExtractionStatus } from '@uniffy/proto/files/v1/files_pb';
import { useThumbnailUrl } from '@/features/files/hooks/useThumbnail';
import type { SerializedFile } from '@/features/files/store/filesThunks';

interface ThumbnailImageProps {
    file: SerializedFile;
    fallback: React.ReactNode;
}

export function ThumbnailImage({ file, fallback }: ThumbnailImageProps) {
    const [error, setError] = useState(false);
    const { url, loading } = useThumbnailUrl(file.id);

    // Reset error when extraction status changes (file was re-processed)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when extractionStatus changes is valid
        setError(false);
    }, [file.extractionStatus]);

    // Don't attempt loading until worker has finished processing
    if (file.extractionStatus !== ExtractionStatus.COMPLETED) {
        return <>{fallback}</>;
    }

    // Still waiting for service worker
    if (loading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-muted/30">
                <div className="animate-pulse w-8 h-8 rounded-full bg-muted" />
            </div>
        );
    }

    // No URL available (SW not ready or missing org)
    if (!url) {
        return <>{fallback}</>;
    }

    // Error loading image
    if (error) {
        return <>{fallback}</>;
    }

    // Cache-bust with extractionStatus so browser doesn't serve a cached 404
    const cacheBustedUrl = `${url}?v=${file.extractionStatus}`;

    return (
        <img
            src={cacheBustedUrl}
            alt={file.filename}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setError(true)}
        />
    );
}
