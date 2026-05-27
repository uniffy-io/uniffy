import { getAccessToken } from '@/config/api';
import { buildMediaStreamUrl } from '@/shared/utils/fileUrls';

const TOKEN_CHANNEL_NAME = 'uniffy-auth-token';
let tokenChannel: BroadcastChannel | null = null;

let registration: ServiceWorkerRegistration | null = null;

function initTokenChannel(): BroadcastChannel {
    if (!tokenChannel) {
        tokenChannel = new BroadcastChannel(TOKEN_CHANNEL_NAME);

        tokenChannel.onmessage = (event) => {
            if (event.data?.type === 'TOKEN_REQUEST') {
                const token = getAccessToken();
                if (token) {
                    tokenChannel?.postMessage({ type: 'TOKEN_RESPONSE', token });
                } else {
                    // Reply with null so the worker doesn't wait out its timeout.
                    tokenChannel?.postMessage({ type: 'TOKEN_RESPONSE', token: null });
                }
            }
        };
    }
    return tokenChannel;
}

initTokenChannel();

export async function registerMediaStreamWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        console.warn('[MediaStreamWorker] Service Workers not supported in this browser');
        return;
    }

    try {
        const workerUrl = '/media-stream-worker.js';

        registration = await navigator.serviceWorker.register(workerUrl, {
            scope: '/',
        });

        if (navigator.serviceWorker.controller) {
            const token = getAccessToken();
            if (token) {
                updateWorkerAuthToken(token);
            }
        }

        navigator.serviceWorker.ready.then(() => {
            const token = getAccessToken();
            if (token) {
                updateWorkerAuthToken(token);
            }
        });

        registration.addEventListener('updatefound', () => {
            const newWorker = registration?.installing;
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'activated') {
                        const token = getAccessToken();
                        if (token) {
                            updateWorkerAuthToken(token);
                        }
                    }
                });
            }
        });
    } catch (error) {
        console.error('[MediaStreamWorker] Registration failed:', error);
    }
}

export async function unregisterMediaStreamWorker(): Promise<void> {
    if (registration) {
        await registration.unregister();
        registration = null;
    }
}

export function updateWorkerAuthToken(token: string): void {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        const channel = initTokenChannel();
        channel.postMessage({ type: 'TOKEN_UPDATE', token });
    } catch (error) {
        console.error('[MediaStreamWorker] BroadcastChannel token update failed:', error);
    }
}

export function clearWorkerAuthToken(): void {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        const channel = initTokenChannel();
        channel.postMessage({ type: 'TOKEN_CLEAR' });
    } catch (error) {
        console.error('[MediaStreamWorker] BroadcastChannel token clear failed:', error);
    }
}

/** `options.full=true` skips chunking; use for audio that needs full waveform analysis. */
export function getMediaStreamUrl(
    organizationId: string,
    fileId: string,
    options?: { full?: boolean }
): string {
    const base = buildMediaStreamUrl(organizationId, fileId);
    if (options?.full) {
        return `${base}?full=true`;
    }
    return base;
}

export async function waitForWorkerReady(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        return false;
    }

    if (navigator.serviceWorker.controller) {
        return true;
    }

    return new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            resolve(true);
        });

        setTimeout(() => resolve(false), 5000);
    });
}
