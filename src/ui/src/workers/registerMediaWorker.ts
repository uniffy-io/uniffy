/**
 * Media Stream Service Worker Registration
 *
 * Handles registration of the media stream service worker and provides
 * utilities for syncing auth tokens with the worker.
 *
 * Token Sync Strategy:
 * - BroadcastChannel: Real-time token updates to active workers
 * - Memory only: Tokens never persisted to storage (security best practice)
 * - On cold start (SW restart): SW returns 401, main thread resends token and retries
 */

// BroadcastChannel for real-time token sync with Service Worker
const TOKEN_CHANNEL_NAME = 'uniffy-auth-token';
let tokenChannel: BroadcastChannel | null = null;

let registration: ServiceWorkerRegistration | null = null;

/**
 * Initialize the BroadcastChannel for token sync.
 */
function initTokenChannel(): BroadcastChannel {
    if (!tokenChannel) {
        tokenChannel = new BroadcastChannel(TOKEN_CHANNEL_NAME);
    }
    return tokenChannel;
}

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

        // Handle updates
        registration.addEventListener('updatefound', () => {
            const newWorker = registration?.installing;
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[MediaStreamWorker] New version available');
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
