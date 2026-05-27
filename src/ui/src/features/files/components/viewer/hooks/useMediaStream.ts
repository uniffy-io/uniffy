/** Returns URLs intercepted by the media service worker; supports Range for <video>/<audio> seeking. */

import { useMemo, useState, useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';
import { getAccessToken } from '@/config/api';
import { getMediaStreamUrl, updateWorkerAuthToken } from '@/workers/registerMediaWorker';

interface MediaStreamResult {
    url: string | null;
    loading: boolean;
    error: string | null;
}

function pushTokenToServiceWorker(): void {
    const token = getAccessToken();
    if (token) {
        updateWorkerAuthToken(token);
    }
}

/** Pushes the auth token as soon as the SW controls the page; covers cold start where the SW boots after the first render. */
async function waitForServiceWorker(timeoutMs = 5000): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        console.warn('[useMediaStream] Service Workers not supported');
        return false;
    }

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
            pushTokenToServiceWorker();
            resolve(true);
        }, { once: true });
    });
}

interface UseMediaStreamOptions {
    /** Request the full file without chunking (audio waveform analysis). */
    full?: boolean;
}

export function useMediaStream(fileId: string | null, options?: UseMediaStreamOptions): MediaStreamResult {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const [swReady, setSwReady] = useState<boolean | null>(null);

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
        if (!fileId || !organizationId || !swReady) return null;
        return getMediaStreamUrl(organizationId, fileId, { full: options?.full });
    }, [fileId, organizationId, swReady, options?.full]);

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

export function useMediaStreamUrl(fileId: string | null, options?: UseMediaStreamOptions): string | null {
    const { url } = useMediaStream(fileId, options);
    return url;
}

export function useMediaStreamAvailable(): boolean {
    return useMemo(() => {
        return 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
    }, []);
}
