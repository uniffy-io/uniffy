/**
 * Media Stream Service Worker
 *
 * Intercepts requests to /media-stream/{orgId}/{fileId} URLs and uses
 * ConnectRPC streaming to fetch file content with Range header support.
 * This enables video/audio seeking while keeping all traffic via ConnectRPC.
 *
 * Also intercepts /api/thumbnails and /api/files requests to add auth headers.
 *
 * Token Sync Strategy (deterministic request/response):
 * - Worker REQUESTS token via BroadcastChannel when needed (TOKEN_REQUEST)
 * - Main thread RESPONDS with token (TOKEN_RESPONSE)
 * - Main thread also proactively pushes on login/refresh (TOKEN_UPDATE)
 * - Memory only: Token never persisted to storage (security best practice)
 * - No polling or timeouts for initial sync - explicit request/response
 */

/// <reference lib="webworker" />

import { createConnectTransport } from '@connectrpc/connect-web';
import { createClient } from '@connectrpc/connect';
import { FilesService } from '@/gen/files/v1/files_connect';

// Service Worker type declarations
declare const self: ServiceWorkerGlobalScope & typeof globalThis;

import {
    MEDIA_STREAM_URL_PATTERN,
    FILE_URL_PATTERN,
    THUMBNAIL_URL_PATTERN,
    AVATAR_URL_PATTERN,
} from '@/shared/utils/fileUrls';

// Alias patterns for local readability
const MEDIA_STREAM_PATTERN = MEDIA_STREAM_URL_PATTERN;
const THUMBNAIL_PATTERN = THUMBNAIL_URL_PATTERN;
const FILES_PATTERN = FILE_URL_PATTERN;
const AVATARS_PATTERN = AVATAR_URL_PATTERN;

// BroadcastChannel for real-time token sync
const TOKEN_CHANNEL_NAME = 'uniffy-auth-token';

// Timeouts
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes for full file requests
const TOKEN_REQUEST_TIMEOUT_MS = 5000; // 5 seconds to get token from main thread

// In-memory token storage (updated via BroadcastChannel)
let memoryToken: string | null = null;

// BroadcastChannel instance for sending requests
let tokenChannel: BroadcastChannel | null = null;

// Pending token request promise (to avoid duplicate requests)
let pendingTokenRequest: Promise<string | null> | null = null;

// Callbacks waiting for token response
const tokenResponseCallbacks: Array<(token: string | null) => void> = [];

/**
 * Wrap a promise with a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms)
        ),
    ]);
}

/**
 * Request token from main thread via BroadcastChannel.
 * Returns a promise that resolves when the main thread responds.
 */
function requestTokenFromMainThread(): Promise<string | null> {
    // If already have token, return immediately
    if (memoryToken) {
        return Promise.resolve(memoryToken);
    }

    // If already requesting, return the existing promise
    if (pendingTokenRequest) {
        return pendingTokenRequest;
    }

    pendingTokenRequest = new Promise<string | null>((resolve) => {
        // Add callback to be called when token arrives
        tokenResponseCallbacks.push(resolve);

        // Request token from main thread
        if (tokenChannel) {
            console.log('[MediaStreamWorker] Requesting token from main thread');
            tokenChannel.postMessage({ type: 'TOKEN_REQUEST' });
        }

        // Timeout after TOKEN_REQUEST_TIMEOUT_MS
        setTimeout(() => {
            // Remove this callback if still pending
            const index = tokenResponseCallbacks.indexOf(resolve);
            if (index !== -1) {
                tokenResponseCallbacks.splice(index, 1);
                console.log('[MediaStreamWorker] Token request timeout');
                resolve(null);
            }
        }, TOKEN_REQUEST_TIMEOUT_MS);
    }).finally(() => {
        pendingTokenRequest = null;
    });

    return pendingTokenRequest;
}

/**
 * Get auth token, requesting from main thread if not available.
 * This is the primary method for getting tokens - deterministic, not polling.
 */
async function getAuthToken(): Promise<string | null> {
    if (memoryToken) {
        return memoryToken;
    }
    return requestTokenFromMainThread();
}

/**
 * Resolve all pending token callbacks.
 */
function resolveTokenCallbacks(token: string | null): void {
    while (tokenResponseCallbacks.length > 0) {
        const callback = tokenResponseCallbacks.shift();
        if (callback) {
            callback(token);
        }
    }
}

/**
 * Initialize BroadcastChannel for real-time token updates.
 */
function initTokenChannel(): void {
    tokenChannel = new BroadcastChannel(TOKEN_CHANNEL_NAME);

    tokenChannel.onmessage = (event) => {
        if (event.data?.type === 'TOKEN_UPDATE') {
            memoryToken = event.data.token;
            console.log('[MediaStreamWorker] Token updated via BroadcastChannel');
            // Resolve any pending token requests
            resolveTokenCallbacks(event.data.token);
        } else if (event.data?.type === 'TOKEN_RESPONSE') {
            // Explicit response to our request
            memoryToken = event.data.token;
            console.log('[MediaStreamWorker] Token received via response');
            resolveTokenCallbacks(event.data.token);
        } else if (event.data?.type === 'TOKEN_CLEAR') {
            memoryToken = null;
            console.log('[MediaStreamWorker] Token cleared via BroadcastChannel');
            resolveTokenCallbacks(null);
        }
    };

    console.log('[MediaStreamWorker] BroadcastChannel initialized');

    // Request token immediately on init (handles page reload scenario)
    requestTokenFromMainThread();
}

// Initialize BroadcastChannel on worker load
initTokenChannel();

/**
 * Create an auth interceptor for ConnectRPC transport.
 */
function createAuthInterceptor(token: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (next: any) => async (request: any) => {
        request.header.set('Authorization', `Bearer ${token}`);
        return next(request);
    };
}

import {
    buildContentDisposition,
    parseRangeRequest as parseRangeRequestUtil,
} from '@/workers/mediaStreamUtils';

/**
 * Wrapper that extracts the Range header from a Request object and delegates
 * to the pure utility function.
 */
function parseRangeRequest(
    request: Request,
    requestFullFile: boolean
): { startByte: number; endByte: number | undefined; hasRangeHeader: boolean } {
    return parseRangeRequestUtil(request.headers.get('Range'), requestFullFile);
}

/**
 * Handle a media stream request using ReadableStream for memory efficiency.
 *
 * Streams chunks directly to the response without buffering in memory.
 * This is ideal for large video/audio files.
 */
async function handleMediaRequest(
    request: Request,
    orgId: string,
    fileId: string,
    requestFullFile: boolean
): Promise<Response> {
    // Parse range from request
    const { startByte, endByte, hasRangeHeader } = parseRangeRequest(request, requestFullFile);

    // Get auth token (requests from main thread if not available)
    const token = await getAuthToken();
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // Create ConnectRPC transport with auth
        const transport = createConnectTransport({
            baseUrl: `${self.location.origin}/api`,
            interceptors: [createAuthInterceptor(token)],
        });

        const client = createClient(FilesService, transport);

        // Start the streaming request
        const streamIterator = client.streamFileRange({
            fileId,
            organizationId: orgId,
            startByte: BigInt(startByte),
            ...(endByte !== undefined && { endByte: BigInt(endByte) }),
        });

        // Get the first chunk to extract metadata for headers
        const firstResult = await streamIterator[Symbol.asyncIterator]().next();

        if (firstResult.done || !firstResult.value) {
            return new Response('No content', { status: 204 });
        }

        const firstChunk = firstResult.value;
        const totalSize = Number(firstChunk.totalSize);
        const rangeStart = Number(firstChunk.rangeStart);
        const rangeEnd = Number(firstChunk.rangeEnd);
        const mimeType = firstChunk.mimeType || 'application/octet-stream';
        const filename = firstChunk.filename || 'file';

        // Determine if this is a partial (206) or full (200) response.
        // Return 206 only when the browser explicitly sent a Range header.
        // Returning an unsolicited 206 breaks <audio>/<video> initial loads
        // where the browser expects a normal 200 response.
        const isPartial = hasRangeHeader && rangeEnd < totalSize - 1;

        // Build response headers
        const headers: HeadersInit = {
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': isPartial ? String(rangeEnd - rangeStart + 1) : String(totalSize),
            'Content-Disposition': buildContentDisposition(filename),
        };

        if (isPartial) {
            headers['Content-Range'] = `bytes ${rangeStart}-${rangeEnd}/${totalSize}`;
        }

        // Stream chunks directly for memory efficiency
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                try {
                    // Enqueue the first chunk we already have
                    if (cancelled) return;
                    controller.enqueue(firstChunk.data);

                    // Stream remaining chunks directly
                    for await (const response of streamIterator) {
                        if (cancelled) return;
                        controller.enqueue(response.data);
                    }

                    if (!cancelled) {
                        controller.close();
                    }
                } catch (error) {
                    // If stream was cancelled by client, silently stop
                    if (cancelled) return;

                    if (error instanceof Error && error.name === 'AbortError') {
                        console.log('[MediaStreamWorker] Stream aborted');
                    } else {
                        console.error('[MediaStreamWorker] Stream error:', error);
                    }
                    try {
                        controller.error(error);
                    } catch {
                        // Controller already closed/errored, ignore
                    }
                }
            },
            cancel() {
                cancelled = true;
                console.log('[MediaStreamWorker] Stream cancelled by client');
            },
        });

        return new Response(stream, { status: isPartial ? 206 : 200, headers });
    } catch (error) {
        // Check if request was aborted (user navigated away, component unmounted, etc.)
        if (error instanceof Error && error.name === 'AbortError') {
            console.log('[MediaStreamWorker] Request aborted (client disconnected)');
            return new Response('Request Aborted', { status: 499 }); // 499 = Client Closed Request
        }
        console.error('[MediaStreamWorker] Error streaming file:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Global error handlers to prevent worker from crashing
self.addEventListener('error', (event: ErrorEvent) => {
    console.error('[MediaStreamWorker] Uncaught error:', event.error);
    // Prevent the error from propagating and potentially crashing the worker
    event.preventDefault();
});

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    console.error('[MediaStreamWorker] Unhandled rejection:', event.reason);
    // Prevent the rejection from propagating
    event.preventDefault();
});

// Worker version for debugging
const WORKER_VERSION = Date.now().toString(36);
console.log(`[MediaStreamWorker] Script loaded, version: ${WORKER_VERSION}`);

// Install event - activate immediately
self.addEventListener('install', (event: ExtendableEvent) => {
    console.log(`[MediaStreamWorker] Installing... (v${WORKER_VERSION})`);
    event.waitUntil(self.skipWaiting());
});

// Activate event - claim all clients immediately
self.addEventListener('activate', (event: ExtendableEvent) => {
    console.log(`[MediaStreamWorker] Activating... (v${WORKER_VERSION})`);
    event.waitUntil(self.clients.claim());
});

/**
 * Handle a thumbnail request by proxying with auth header.
 *
 * Unlike media streaming, thumbnails use a standard HTTP endpoint
 * and benefit from browser caching with proper cache headers.
 */
async function handleThumbnailRequest(request: Request): Promise<Response> {
    // Get auth token (requests from main thread if not available)
    const token = await getAuthToken();
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // Create a new request with the auth header
        const authRequest = new Request(request.url, {
            method: request.method,
            headers: {
                ...Object.fromEntries(request.headers),
                Authorization: `Bearer ${token}`,
            },
            credentials: 'omit', // Don't send cookies, we use Bearer token
        });

        // Fetch from the backend
        const response = await fetch(authRequest);

        // Return the response as-is (preserves cache headers from backend)
        return response;
    } catch (error) {
        console.error('[MediaStreamWorker] Thumbnail fetch error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

/**
 * Handle a file request by proxying with auth header.
 *
 * Similar to thumbnails, files use a standard HTTP endpoint and benefit
 * from browser caching. Used for images embedded in notes.
 */
async function handleFileRequest(request: Request): Promise<Response> {
    // Get auth token (requests from main thread if not available)
    const token = await getAuthToken();
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // Create a new request with the auth header
        const authRequest = new Request(request.url, {
            method: request.method,
            headers: {
                ...Object.fromEntries(request.headers),
                Authorization: `Bearer ${token}`,
            },
            credentials: 'omit', // Don't send cookies, we use Bearer token
        });

        // Fetch from the backend
        const response = await fetch(authRequest);

        // Return the response as-is (preserves cache headers from backend)
        return response;
    } catch (error) {
        console.error('[MediaStreamWorker] File fetch error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Fetch event - intercept media stream, thumbnail, and file requests
self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);

    // Check for thumbnail requests first (simpler handler)
    const thumbnailMatch = url.pathname.match(THUMBNAIL_PATTERN);
    if (thumbnailMatch) {
        console.log(`[MediaStreamWorker] Intercepting thumbnail request: ${url.pathname}`);
        event.respondWith(handleThumbnailRequest(event.request));
        return;
    }

    // Check for file requests (images embedded in notes, etc.)
    const filesMatch = url.pathname.match(FILES_PATTERN);
    if (filesMatch) {
        console.log(`[MediaStreamWorker] Intercepting file request: ${url.pathname}`);
        event.respondWith(handleFileRequest(event.request));
        return;
    }

    // Check for avatar requests
    const avatarsMatch = url.pathname.match(AVATARS_PATTERN);
    if (avatarsMatch) {
        event.respondWith(handleFileRequest(event.request));
        return;
    }

    // Check for media stream requests
    const mediaMatch = url.pathname.match(MEDIA_STREAM_PATTERN);
    if (!mediaMatch) {
        // Not a handled request, let it pass through
        return;
    }

    const [, orgId, fileId] = mediaMatch;
    // Check if full file was requested (for audio that needs waveform analysis)
    const requestFullFile = url.searchParams.get('full') === 'true';

    console.log(`[MediaStreamWorker] Intercepting request for file ${fileId}`, { requestFullFile });

    // Wrap in a safe handler with timeout that always returns a response
    const safeHandler = async (): Promise<Response> => {
        try {
            const timeoutMs = requestFullFile ? REQUEST_TIMEOUT_MS : 30000;
            return await withTimeout(
                handleMediaRequest(event.request, orgId, fileId, requestFullFile),
                timeoutMs,
                `media request for ${fileId}`
            );
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('Timeout:')) {
                console.error('[MediaStreamWorker] Request timeout:', error.message);
                return new Response('Request Timeout', { status: 504 });
            }
            console.error('[MediaStreamWorker] Fatal error in request handler:', error);
            return new Response('Service Worker Error', { status: 500 });
        }
    };

    event.respondWith(safeHandler());
});

// Push event - show OS-level notification when a push message arrives
self.addEventListener('push', (event: PushEvent) => {
    if (!event.data) return;

    let payload: { title?: string; body?: string; url?: string; notification_type?: string };
    try {
        payload = event.data.json();
    } catch {
        payload = { title: 'Uniffy', body: event.data.text() };
    }

    const title = payload.title || 'Uniffy';
    const options = {
        body: payload.body || '',
        icon: '/favicon-96x96.png',
        badge: '/favicon-96x96.png',
        data: { url: payload.url || '/' },
        tag: payload.notification_type || 'uniffy-notification',
        renotify: true,
    } satisfies NotificationOptions & { renotify: boolean };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click - focus or open the app at the relevant URL
self.addEventListener('notificationclick', (event: NotificationEvent) => {
    event.notification.close();

    const url: string = (event.notification.data as { url?: string })?.url || '/';

    event.waitUntil(
        self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                for (const client of windowClients) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.focus();
                        client.postMessage({ type: 'PUSH_NOTIFICATION_CLICK', url });
                        return;
                    }
                }
                return self.clients.openWindow(url);
            }),
    );
});

// Push subscription change - browser revoked or expired the subscription
self.addEventListener('pushsubscriptionchange', () => {
    console.warn('[MediaStreamWorker] pushsubscriptionchange -- subscription lost');
});

// Message event - handle token updates from main thread (legacy postMessage fallback)
// Note: BroadcastChannel is the primary mechanism, this is kept for compatibility
self.addEventListener('message', (event: ExtendableMessageEvent) => {
    if (event.data?.type === 'UPDATE_AUTH_TOKEN') {
        // Update in-memory token only (no persistent storage)
        memoryToken = event.data.token;
        console.log('[MediaStreamWorker] Auth token updated via postMessage');
    } else if (event.data?.type === 'CLEAR_AUTH_TOKEN') {
        // Clear in-memory token
        memoryToken = null;
        console.log('[MediaStreamWorker] Auth token cleared via postMessage');
    } else if (event.data?.type === 'PING') {
        // Health check - respond to let main thread know worker is alive
        event.source?.postMessage({ type: 'PONG' });
    }
});

export {};
