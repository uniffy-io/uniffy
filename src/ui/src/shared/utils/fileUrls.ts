/**
 * File URL Utilities
 *
 * Centralized URL builders and parsers for file-related URLs.
 * All file/media URLs in the app should use these helpers
 * instead of constructing or parsing URL strings inline.
 *
 * URL patterns:
 *   /api/files/{orgId}/{fileId}          - images, documents (service worker auth + caching)
 *   /api/thumbnails/{orgId}/{fileId}     - thumbnails (service worker auth + caching)
 *   /api/avatars/{userId}/{size}         - user avatars
 *   /api/agents/avatars/{agentId}/{size} - agent avatars
 *   /media-stream/{orgId}/{fileId}       - video/audio streaming (Range header support)
 */

// -- URL Builders --

/** Build an image/document file URL: /api/files/{orgId}/{fileId} */
export function buildFileUrl(organizationId: string, fileId: string): string {
    return `/api/files/${organizationId}/${fileId}`;
}

/** Build a thumbnail URL: /api/thumbnails/{orgId}/{fileId} */
export function buildThumbnailUrl(organizationId: string, fileId: string): string {
    return `/api/thumbnails/${organizationId}/${fileId}`;
}

/** Build a media stream URL: /media-stream/{orgId}/{fileId} */
export function buildMediaStreamUrl(organizationId: string, fileId: string): string {
    return `/media-stream/${organizationId}/${fileId}`;
}

/** Build an avatar URL: /api/avatars/{userId}/{size} */
export function buildAvatarUrl(userId: string, size: string): string {
    return `/api/avatars/${userId}/${size}`;
}

// -- URL Patterns (for service worker and CSS attribute selectors) --

/** Matches /api/files/{orgId}/{fileId} - groups: [orgId, fileId] */
export const FILE_URL_PATTERN = /^\/api\/files\/([^/]+)\/([^/]+)$/;

/** Matches /api/thumbnails/{orgId}/{fileId} - groups: [orgId, fileId] */
export const THUMBNAIL_URL_PATTERN = /^\/api\/thumbnails\/([^/]+)\/([^/]+)$/;

/** Matches /media-stream/{orgId}/{fileId} - groups: [orgId, fileId] */
export const MEDIA_STREAM_URL_PATTERN = /^\/media-stream\/([^/]+)\/([^/]+)$/;

/** Matches /api/avatars/{userId}/{size} - groups: [userId, size] */
export const AVATAR_URL_PATTERN = /^\/api\/avatars\/([^/]+)\/([^/]+)$/;

/** Matches /api/agents/avatars/{agentId}/{size} - groups: [agentId, size] */
export const AGENT_AVATAR_URL_PATTERN = /^\/api\/agents\/avatars\/([^/]+)\/([^/]+)/;

// -- URL Parsers --

interface ParsedFileUrl {
    organizationId: string;
    fileId: string;
}

/**
 * Parse a file URL and extract orgId + fileId.
 * Works with both relative paths and full URLs (e.g. from img.src).
 * Matches /api/files/{orgId}/{fileId} pattern.
 */
export function parseFileUrl(url: string): ParsedFileUrl | null {
    const match = url.match(/\/api\/files\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    return { organizationId: match[1], fileId: match[2] };
}

/**
 * Parse a media stream URL and extract orgId + fileId.
 * Works with both relative paths and full URLs.
 * Matches /media-stream/{orgId}/{fileId} pattern.
 */
export function parseMediaStreamUrl(url: string): ParsedFileUrl | null {
    const match = url.match(/\/media-stream\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    return { organizationId: match[1], fileId: match[2] };
}

/**
 * Extract a file ID from any file-related URL (file or media-stream).
 * Returns the fileId or null if the URL doesn't match any known pattern.
 */
export function extractFileId(url: string): string | null {
    return parseFileUrl(url)?.fileId ?? parseMediaStreamUrl(url)?.fileId ?? null;
}
