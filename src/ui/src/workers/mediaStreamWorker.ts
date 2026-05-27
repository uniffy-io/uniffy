// Intercepts /media-stream/, /api/files/, /api/thumbnails/, and /api/avatars/ URLs
// to inject Bearer auth (which <img>/<video>/<audio> tags can't send) and stream
// file ranges over ConnectRPC for seekable media.
// Token sync: worker BroadcastChannels TOKEN_REQUEST; main thread answers TOKEN_RESPONSE
// and also pushes TOKEN_UPDATE on login/refresh. Memory only, never persisted.

/// <reference lib="webworker" />

import { createConnectTransport } from '@connectrpc/connect-web';
import { createClient } from '@connectrpc/connect';
import { FilesService } from '@uniffy/proto/files/v1/files_pb';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

import {
    MEDIA_STREAM_URL_PATTERN,
    FILE_URL_PATTERN,
    THUMBNAIL_URL_PATTERN,
    AVATAR_URL_PATTERN,
    AGENT_AVATAR_URL_PATTERN,
} from '@/shared/utils/fileUrls';

const MEDIA_STREAM_PATTERN = MEDIA_STREAM_URL_PATTERN;
const THUMBNAIL_PATTERN = THUMBNAIL_URL_PATTERN;
const FILES_PATTERN = FILE_URL_PATTERN;
const AVATARS_PATTERN = AVATAR_URL_PATTERN;
const AGENT_AVATARS_PATTERN = AGENT_AVATAR_URL_PATTERN;

const TOKEN_CHANNEL_NAME = 'uniffy-auth-token';

const REQUEST_TIMEOUT_MS = 120000;
const TOKEN_REQUEST_TIMEOUT_MS = 5000;

let memoryToken: string | null = null;
let tokenChannel: BroadcastChannel | null = null;
let pendingTokenRequest: Promise<string | null> | null = null;
const tokenResponseCallbacks: Array<(token: string | null) => void> = [];

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms)
        ),
    ]);
}

function requestTokenFromMainThread(): Promise<string | null> {
    if (memoryToken) {
        return Promise.resolve(memoryToken);
    }

    if (pendingTokenRequest) {
        return pendingTokenRequest;
    }

    pendingTokenRequest = new Promise<string | null>((resolve) => {
        tokenResponseCallbacks.push(resolve);

        if (tokenChannel) {
            tokenChannel.postMessage({ type: 'TOKEN_REQUEST' });
        }

        setTimeout(() => {
            const index = tokenResponseCallbacks.indexOf(resolve);
            if (index !== -1) {
                tokenResponseCallbacks.splice(index, 1);
                resolve(null);
            }
        }, TOKEN_REQUEST_TIMEOUT_MS);
    }).finally(() => {
        pendingTokenRequest = null;
    });

    return pendingTokenRequest;
}

async function getAuthToken(): Promise<string | null> {
    if (memoryToken) {
        return memoryToken;
    }
    return requestTokenFromMainThread();
}

function resolveTokenCallbacks(token: string | null): void {
    while (tokenResponseCallbacks.length > 0) {
        const callback = tokenResponseCallbacks.shift();
        if (callback) {
            callback(token);
        }
    }
}

function initTokenChannel(): void {
    tokenChannel = new BroadcastChannel(TOKEN_CHANNEL_NAME);

    tokenChannel.onmessage = (event) => {
        if (event.data?.type === 'TOKEN_UPDATE') {
            memoryToken = event.data.token;
            resolveTokenCallbacks(event.data.token);
        } else if (event.data?.type === 'TOKEN_RESPONSE') {
            memoryToken = event.data.token;
            resolveTokenCallbacks(event.data.token);
        } else if (event.data?.type === 'TOKEN_CLEAR') {
            memoryToken = null;
            resolveTokenCallbacks(null);
        }
    };

    // Pre-fetch token to handle page reloads where the worker outlives the page.
    requestTokenFromMainThread();
}

initTokenChannel();

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

function parseRangeRequest(
    request: Request,
    requestFullFile: boolean
): { startByte: number; endByte: number | undefined; hasRangeHeader: boolean } {
    return parseRangeRequestUtil(request.headers.get('Range'), requestFullFile);
}

/** Streams chunks directly to the response without buffering, so large videos stay memory-bounded. */
async function handleMediaRequest(
    request: Request,
    orgId: string,
    fileId: string,
    requestFullFile: boolean
): Promise<Response> {
    const { startByte, endByte, hasRangeHeader } = parseRangeRequest(request, requestFullFile);

    const token = await getAuthToken();
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const transport = createConnectTransport({
            baseUrl: `${self.location.origin}/api`,
            interceptors: [createAuthInterceptor(token)],
        });

        const client = createClient(FilesService, transport);

        const streamIterator = client.streamFileRange({
            fileId,
            organizationId: orgId,
            startByte: BigInt(startByte),
            ...(endByte !== undefined && { endByte: BigInt(endByte) }),
        });

        // First chunk carries the metadata we need for response headers.
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

        // 206 iff the browser explicitly sent a Range header. Unsolicited 206 breaks
        // <audio>/<video> initial loads; conversely, a tail-covering Range MUST still
        // be 206 - returning 200 with Content-Length: totalSize when the body only
        // carries totalSize-N bytes trips MEDIA_ERR_NETWORK on small files.
        const isPartial = hasRangeHeader;

        const headers: HeadersInit = {
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': isPartial ? String(rangeEnd - rangeStart + 1) : String(totalSize),
            'Content-Disposition': buildContentDisposition(filename),
        };

        if (isPartial) {
            headers['Content-Range'] = `bytes ${rangeStart}-${rangeEnd}/${totalSize}`;
        }

        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                try {
                    if (cancelled) return;
                    controller.enqueue(firstChunk.data);

                    for await (const response of streamIterator) {
                        if (cancelled) return;
                        controller.enqueue(response.data);
                    }

                    if (!cancelled) {
                        controller.close();
                    }
                } catch (error) {
                    if (cancelled) return;

                    if (!(error instanceof Error && error.name === 'AbortError')) {
                        console.error('[MediaStreamWorker] Stream error:', error);
                    }
                    try {
                        controller.error(error);
                    } catch {
                        // Controller already closed/errored.
                    }
                }
            },
            cancel() {
                cancelled = true;
            },
        });

        return new Response(stream, { status: isPartial ? 206 : 200, headers });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return new Response('Request Aborted', { status: 499 });
        }
        console.error('[MediaStreamWorker] Error streaming file:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

self.addEventListener('error', (event: ErrorEvent) => {
    console.error('[MediaStreamWorker] Uncaught error:', event.error);
    event.preventDefault();
});

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    console.error('[MediaStreamWorker] Unhandled rejection:', event.reason);
    event.preventDefault();
});

self.addEventListener('install', (event: ExtendableEvent) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(self.clients.claim());
});

/** Proxies a thumbnail request with the Bearer token; backend cache headers pass through. */
async function handleThumbnailRequest(request: Request): Promise<Response> {
    const token = await getAuthToken();
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // Strip client cache directives so backend Cache-Control/ETag drives the HTTP cache.
        const headers = new Headers(request.headers);
        headers.delete('cache-control');
        headers.delete('pragma');
        headers.set('Authorization', `Bearer ${token}`);

        const authRequest = new Request(request.url, {
            method: request.method,
            headers,
            credentials: 'omit',
        });

        const response = await fetch(authRequest);

        return response;
    } catch (error) {
        console.error('[MediaStreamWorker] Thumbnail fetch error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

/** Proxies a file request (images in notes, etc.) with the Bearer token. */
async function handleFileRequest(request: Request): Promise<Response> {
    const token = await getAuthToken();
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // Strip client cache directives so backend Cache-Control/ETag drives the HTTP cache.
        const headers = new Headers(request.headers);
        headers.delete('cache-control');
        headers.delete('pragma');
        headers.set('Authorization', `Bearer ${token}`);

        const authRequest = new Request(request.url, {
            method: request.method,
            headers,
            credentials: 'omit',
        });

        const response = await fetch(authRequest);

        return response;
    } catch (error) {
        console.error('[MediaStreamWorker] File fetch error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);

    const thumbnailMatch = url.pathname.match(THUMBNAIL_PATTERN);
    if (thumbnailMatch) {
        event.respondWith(handleThumbnailRequest(event.request));
        return;
    }

    const filesMatch = url.pathname.match(FILES_PATTERN);
    if (filesMatch) {
        event.respondWith(handleFileRequest(event.request));
        return;
    }

    const avatarsMatch = url.pathname.match(AVATARS_PATTERN);
    if (avatarsMatch) {
        event.respondWith(handleFileRequest(event.request));
        return;
    }

    const agentAvatarsMatch = url.pathname.match(AGENT_AVATARS_PATTERN);
    if (agentAvatarsMatch) {
        event.respondWith(handleFileRequest(event.request));
        return;
    }

    const mediaMatch = url.pathname.match(MEDIA_STREAM_PATTERN);
    if (!mediaMatch) {
        return;
    }

    const [, orgId, fileId] = mediaMatch;
    // `?full=true` is for audio that needs waveform analysis before playback.
    const requestFullFile = url.searchParams.get('full') === 'true';

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

self.addEventListener('pushsubscriptionchange', () => {
    console.warn('[MediaStreamWorker] pushsubscriptionchange -- subscription lost');
});

// postMessage fallback for environments without BroadcastChannel.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
    if (event.data?.type === 'UPDATE_AUTH_TOKEN') {
        memoryToken = event.data.token;
    } else if (event.data?.type === 'CLEAR_AUTH_TOKEN') {
        memoryToken = null;
    } else if (event.data?.type === 'PING') {
        event.source?.postMessage({ type: 'PONG' });
    }
});

export {};
