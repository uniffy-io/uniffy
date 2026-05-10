/**
 * Hook for getting media stream URLs.
 *
 * Returns URLs that are intercepted by the Service Worker.
 * The SW handles ConnectRPC streaming with Range support for seeking.
 *
 * Token Sync: When the SW becomes ready, we proactively push the auth token
 * to ensure it's available for media requests (handles cold start scenarios).
 */

import { useMemo, useState, useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';
import { getAccessToken } from '@/config/api';
import { getMediaStreamUrl, updateWorkerAuthToken } from '@/workers/registerMediaWorker';

interface MediaStreamResult {
    url: string | null;
    loading: boolean;
    error: string | null;
}

/**
 * Push the current auth token to the Service Worker.
 * This ensures the SW has the token for media requests (handles cold start).
 */
function pushTokenToServiceWorker(): void {
    const token = getAccessToken();
    if (token) {
        updateWorkerAuthToken(token);
    }
}

/**
 * Wait for the Service Worker to be controlling the page.
 * When ready, proactively pushes the auth token to handle cold starts.
 * Returns true if SW is ready, false if timeout or not supported.
 */
async function waitForServiceWorker(timeoutMs = 5000): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        console.warn('[useMediaStream] Service Workers not supported');
        return false;
    }

    // Already controlling - push token and return
    if (navigator.serviceWorker.controller) {
        pushTokenToServiceWorker();
        return true;
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn('[useMediaStream] SW wait timeout');
            resolve(false);
        }, timeoutMs);

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(timeout);
            // Push token when SW becomes ready
            pushTokenToServiceWorker();
            resolve(true);
        }, { once: true });
    });
}

interface UseMediaStreamOptions {
    /** Request full file without chunking (use for audio waveform analysis) */
    full?: boolean;
}

/**
 * Hook to get a streamable URL for a file.
 *
 * Returns a URL that the Service Worker intercepts and streams via ConnectRPC.
 * Supports Range requests for video/audio seeking.
 * Waits for Service Worker to be ready before returning the URL.
 *
 * @param fileId - The file ID to stream
 * @param options - Optional settings (e.g., full: true for audio)
 * @returns Object with url, loading, and error states
 */
export function useMediaStream(fileId: string | null, options?: UseMediaStreamOptions): MediaStreamResult {
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
        return getMediaStreamUrl(organizationId, fileId, { full: options?.full });
    }, [fileId, organizationId, swReady, options?.full]);

    // Determine state
    if (swReady === null) {
        return { url: null, loading: true, error: null };
    }
    if (!swReady) {
        return { url: null, loading: false, error: 'Media streaming unavailable. Please refresh the page.' };
    }
    if (!fileId) {
        return { url: null, loading: false, error: 'No file ID' };
    }
    if (!organizationId) {
        return { url: null, loading: false, error: 'No organization selected' };
    }

    return { url, loading: false, error: null };
}

/**
 * Simplified hook that just returns the URL.
 * Returns null while waiting for Service Worker.
 */
export function useMediaStreamUrl(fileId: string | null, options?: UseMediaStreamOptions): string | null {
    const { url } = useMediaStream(fileId, options);
    return url;
}

/**
 * Hook to check if media streaming with seeking is available.
 *
 * Returns true when Service Worker is active.
 */
export function useMediaStreamAvailable(): boolean {
    return useMemo(() => {
        return 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
    }, []);
}
