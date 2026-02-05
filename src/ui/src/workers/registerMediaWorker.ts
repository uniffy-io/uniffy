/**
 * Media Stream Service Worker Registration
 *
 * Handles registration of the media stream service worker and provides
 * utilities for syncing auth tokens with the worker.
 *
 * Token Sync Strategy (deterministic request/response):
 * - Worker REQUESTS token via BroadcastChannel when needed (TOKEN_REQUEST)
 * - Main thread RESPONDS with token (TOKEN_RESPONSE)
 * - Main thread also proactively pushes on login/refresh (TOKEN_UPDATE)
 * - Memory only: Tokens never persisted to storage (security best practice)
 */

import { getAccessToken } from '@/config/api';

// BroadcastChannel for real-time token sync with Service Worker
const TOKEN_CHANNEL_NAME = 'uniffy-auth-token';
let tokenChannel: BroadcastChannel | null = null;

let registration: ServiceWorkerRegistration | null = null;

/**
 * Initialize the BroadcastChannel for token sync.
 * Also sets up listener for token requests from the worker.
 */
function initTokenChannel(): BroadcastChannel {
    if (!tokenChannel) {
        tokenChannel = new BroadcastChannel(TOKEN_CHANNEL_NAME);

        // Listen for token requests from the worker
        tokenChannel.onmessage = (event) => {
            if (event.data?.type === 'TOKEN_REQUEST') {
                console.log('[MediaStreamWorker] Worker requested token');
                const token = getAccessToken();
                if (token) {
                    tokenChannel?.postMessage({ type: 'TOKEN_RESPONSE', token });
                    console.log('[MediaStreamWorker] Token sent to worker');
                } else {
                    console.log('[MediaStreamWorker] No token available to send');
                    // Send null response so worker doesn't wait forever
                    tokenChannel?.postMessage({ type: 'TOKEN_RESPONSE', token: null });
                }
            }
        };
    }
    return tokenChannel;
}

// Initialize immediately so we can receive requests from workers
initTokenChannel();

/**
 * Register the media stream service worker.
 *
 * Should be called once on app initialization.
 * Works in both development and production modes.
 */
export async function registerMediaStreamWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        console.warn('[MediaStreamWorker] Service Workers not supported in this browser');
        return;
    }

    try {
        // Worker is built to public/ (served at root by Vite)
        const workerUrl = '/media-stream-worker.js';

        registration = await navigator.serviceWorker.register(workerUrl, {
            scope: '/',
        });

        console.log('[MediaStreamWorker] Registered with scope:', registration.scope);

        // Send token immediately if we have one and worker is ready
        if (navigator.serviceWorker.controller) {
            const token = getAccessToken();
            if (token) {
                updateWorkerAuthToken(token);
            }
        }

        // Handle worker becoming ready (new registration or page reload)
        navigator.serviceWorker.ready.then(() => {
            const token = getAccessToken();
            if (token) {
                console.log('[MediaStreamWorker] Worker ready, sending token');
                updateWorkerAuthToken(token);
            }
        });

        // Handle updates
        registration.addEventListener('updatefound', () => {
            const newWorker = registration?.installing;
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[MediaStreamWorker] New version available');
                    }
                    // Send token when new worker activates
                    if (newWorker.state === 'activated') {
                        const token = getAccessToken();
                        if (token) {
                            console.log('[MediaStreamWorker] New worker activated, sending token');
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

/**
 * Unregister the media stream service worker.
 */
export async function unregisterMediaStreamWorker(): Promise<void> {
    if (registration) {
        await registration.unregister();
        registration = null;
        console.log('[MediaStreamWorker] Unregistered');
    }
}

/**
 * Update the auth token in the Service Worker.
 *
 * Call this after login and token refresh to keep the worker authenticated.
 * Uses BroadcastChannel for real-time sync (memory only - no persistent storage).
 */
export function updateWorkerAuthToken(token: string): void {
    // Check if service workers are supported
    if (!('serviceWorker' in navigator)) {
        return;
    }

    // Send via BroadcastChannel for instant delivery to active workers
    try {
        const channel = initTokenChannel();
        channel.postMessage({ type: 'TOKEN_UPDATE', token });
    } catch (error) {
        console.error('[MediaStreamWorker] BroadcastChannel token update failed:', error);
    }
}

/**
 * Clear the auth token from the Service Worker.
 *
 * Call this on logout to revoke worker access and clear media cache.
 */
export function clearWorkerAuthToken(): void {
    // Check if service workers are supported
    if (!('serviceWorker' in navigator)) {
        return;
    }

    // Send via BroadcastChannel for instant delivery
    try {
        const channel = initTokenChannel();
        channel.postMessage({ type: 'TOKEN_CLEAR' });
    } catch (error) {
        console.error('[MediaStreamWorker] BroadcastChannel token clear failed:', error);
    }
}

/**
 * Build a media stream URL for a file.
 *
 * This URL will be intercepted by the Service Worker.
 *
 * @param organizationId - Organization ID
 * @param fileId - File ID
 * @param options - Optional settings
 * @param options.full - If true, request the full file (no chunking). Use for audio.
 */
export function getMediaStreamUrl(
    organizationId: string,
    fileId: string,
    options?: { full?: boolean }
): string {
    const base = `/media-stream/${organizationId}/${fileId}`;
    if (options?.full) {
        return `${base}?full=true`;
    }
    return base;
}

/**
 * Check if the Service Worker is ready and controlling the page.
 */
export async function waitForWorkerReady(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        return false;
    }

    // If already controlling, we're good
    if (navigator.serviceWorker.controller) {
        return true;
    }

    // Wait for the worker to become active
    return new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            resolve(true);
        });

        // Timeout after 5 seconds
        setTimeout(() => resolve(false), 5000);
    });
}
