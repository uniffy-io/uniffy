import { useMemo, useState, useEffect } from 'react';
import { useAppSelector } from '@/app/hooks';
import { getAccessToken } from '@/config/api';
import { buildThumbnailUrl } from '@/shared/utils/fileUrls';
import { updateWorkerAuthToken } from '@/workers/registerMediaWorker';

/** Returned URL is intercepted by the media service worker which injects Authorization. */
export function getThumbnailUrl(organizationId: string, fileId: string): string {
    return buildThumbnailUrl(organizationId, fileId);
}

function pushTokenToServiceWorker(): void {
    const token = getAccessToken();
    if (token) {
        updateWorkerAuthToken(token);
    }
}

async function waitForServiceWorker(timeoutMs = 3000): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        return false;
    }

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

/** URL is only returned once the service worker is controlling the page; otherwise <img> would 401. */
export function useThumbnailUrl(fileId: string | null): UseThumbnailUrlResult {
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
        return getThumbnailUrl(organizationId, fileId);
    }, [fileId, organizationId, swReady]);

    return {
        url,
        loading: swReady === null,
    };
}
