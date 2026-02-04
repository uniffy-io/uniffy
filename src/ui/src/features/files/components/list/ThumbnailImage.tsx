/**
 * ThumbnailImage Component
 *
 * Displays a thumbnail for files using the backend thumbnail proxy.
 * The Service Worker intercepts requests and adds auth headers.
 * Backend serves thumbnails with HTTP cache headers for browser caching.
 */

import { useState } from 'react';
import { useThumbnailUrl } from '@/features/files/hooks/useThumbnail';
import type { SerializedFile } from '@/features/files/store/filesThunks';

interface ThumbnailImageProps {
    file: SerializedFile;
    fallback: React.ReactNode;
}

export function ThumbnailImage({ file, fallback }: ThumbnailImageProps) {
    const [error, setError] = useState(false);
    const { url, loading } = useThumbnailUrl(file.id);

    // Always try to load thumbnail for images
    // If backend returns 404 (no thumbnail), onError will show fallback
    // This handles both new files with extractionStatus and legacy files

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

    return (
        <img
            src={url}
            alt={file.filename}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setError(true)}
        />
    );
}
