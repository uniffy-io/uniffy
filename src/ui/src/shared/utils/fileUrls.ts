// URL patterns:
//   /api/files/{orgId}/{fileId}          - images, documents (service worker auth + caching)
//   /api/thumbnails/{orgId}/{fileId}     - thumbnails (service worker auth + caching)
//   /api/avatars/{userId}/{size}         - user avatars
//   /api/agents/avatars/{agentId}/{size} - agent avatars
//   /media-stream/{orgId}/{fileId}       - video/audio streaming (Range header support)

export function buildFileUrl(organizationId: string, fileId: string): string {
    return `/api/files/${organizationId}/${fileId}`;
}

export function buildThumbnailUrl(organizationId: string, fileId: string): string {
    return `/api/thumbnails/${organizationId}/${fileId}`;
}

export function buildMediaStreamUrl(organizationId: string, fileId: string): string {
    return `/media-stream/${organizationId}/${fileId}`;
}

export function buildAvatarUrl(userId: string, size: string): string {
    // `?_v=2` busts immutable cache entries written before ETag support landed.
    return `/api/avatars/${userId}/${size}?_v=2`;
}

export function buildAgentAvatarUrl(agentId: string, size: string = 'sm'): string {
    return `/api/agents/avatars/${agentId}/${size}`;
}

export const FILE_URL_PATTERN = /^\/api\/files\/([^/]+)\/([^/]+)$/;
export const THUMBNAIL_URL_PATTERN = /^\/api\/thumbnails\/([^/]+)\/([^/]+)$/;
export const MEDIA_STREAM_URL_PATTERN = /^\/media-stream\/([^/]+)\/([^/]+)$/;
export const AVATAR_URL_PATTERN = /^\/api\/avatars\/([^/]+)\/([^/]+)$/;
export const AGENT_AVATAR_URL_PATTERN = /^\/api\/agents\/avatars\/([^/]+)\/([^/]+)/;

interface ParsedFileUrl {
    organizationId: string;
    fileId: string;
}

export function parseFileUrl(url: string): ParsedFileUrl | null {
    const match = url.match(/\/api\/files\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    return { organizationId: match[1], fileId: match[2] };
}

export function parseMediaStreamUrl(url: string): ParsedFileUrl | null {
    const match = url.match(/\/media-stream\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    return { organizationId: match[1], fileId: match[2] };
}

export function extractFileId(url: string): string | null {
    return parseFileUrl(url)?.fileId ?? parseMediaStreamUrl(url)?.fileId ?? null;
}
