/**
 * Hook for getting thumbnail URLs.
 *
 * Returns URLs that are intercepted by the Service Worker which adds
 * the Authorization header. The backend streams thumbnails with proper
 * HTTP cache headers for efficient browser caching.
 */

import { useMemo, useState, useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';
import { getAccessToken } from '@/config/api';
import { buildThumbnailUrl } from '@/shared/utils/fileUrls';
import { updateWorkerAuthToken } from '@/workers/registerMediaWorker';

/**
 * Build a thumbnail URL for a file.
 *
 * This URL is intercepted by the Service Worker which adds authentication.
 * The backend serves thumbnails with Cache-Control headers for browser caching.
 */
export function getThumbnailUrl(organizationId: string, fileId: string): string {
    return buildThumbnailUrl(organizationId, fileId);
}

/**
 * Push the current auth token to the Service Worker.
 * Ensures the SW has the token for thumbnail requests.
 */
function pushTokenToServiceWorker(): void {
    const token = getAccessToken();
    if (token) {
        updateWorkerAuthToken(token);
    }
}

/**
 * Wait for the Service Worker to be controlling the page.
 */
async function waitForServiceWorker(timeoutMs = 3000): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        return false;
    }

    // Already controlling - push token and return
    if (navigator.serviceWorker.controller) {
        pushTokenToServiceWorker();
        return true;
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
        }, timeoutMs);

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(timeout);
            pushTokenToServiceWorker();
            resolve(true);
        }, { once: true });
    });
}

interface UseThumbnailUrlResult {
    url: string | null;
    loading: boolean;
}

/**
 * Hook to get a thumbnail URL for a file.
 *
 * Returns a URL that the Service Worker intercepts and adds auth headers.
 * Waits for Service Worker to be ready before returning the URL.
 *
 * @param fileId - The file ID to get thumbnail for
 * @returns Object with url and loading state
 */
export function useThumbnailUrl(fileId: string | null): UseThumbnailUrlResult {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const [swReady, setSwReady] = useState<boolean | null>(null);

    // Wait for service worker on mount
    useEffect(() => {
        let cancelled = false;

        waitForServiceWorker().then((ready) => {
            if (!cancelled) {
                setSwReady(ready);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const url = useMemo(() => {
        // Don't return URL until SW is ready
        if (!fileId || !organizationId || !swReady) return null;
        return getThumbnailUrl(organizationId, fileId);
    }, [fileId, organizationId, swReady]);

    return {
        url,
        loading: swReady === null,
    };
}
