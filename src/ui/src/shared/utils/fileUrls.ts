// URL patterns (all same-origin, authenticated by the asset cookie or a Bearer header):
//   /api/files/{orgId}/{fileId}          - images, documents
//   /api/thumbnails/{orgId}/{fileId}     - thumbnails
//   /api/media/{orgId}/{fileId}          - video/audio streaming (Range header support)
//   /api/avatars/{userId}/{size}         - user avatars
//   /api/agents/avatars/{agentId}/{size} - agent avatars

export function buildFileUrl(organizationId: string, fileId: string): string {
    return `/api/files/${organizationId}/${fileId}`;
}

export function buildThumbnailUrl(organizationId: string, fileId: string): string {
    return `/api/thumbnails/${organizationId}/${fileId}`;
}

export function buildMediaUrl(organizationId: string, fileId: string): string {
    return `/api/media/${organizationId}/${fileId}`;
}

/** `options.full=true` skips chunking; use for audio that needs full waveform analysis. */
export function getMediaUrl(
    organizationId: string,
    fileId: string,
    options?: { full?: boolean }
): string {
    const base = buildMediaUrl(organizationId, fileId);
    return options?.full ? `${base}?full=true` : base;
}

export function buildAvatarUrl(userId: string, size: string): string {
    // `?_v=2` busts immutable cache entries written before ETag support landed.
    return `/api/avatars/${userId}/${size}?_v=2`;
}

export function buildAgentAvatarUrl(agentId: string, size: string = 'sm'): string {
    return `/api/agents/avatars/${agentId}/${size}`;
}

interface ParsedFileUrl {
    organizationId: string;
    fileId: string;
}

export function parseFileUrl(url: string): ParsedFileUrl | null {
    const match = url.match(/\/api\/files\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    return { organizationId: match[1], fileId: match[2] };
}

export function parseMediaUrl(url: string): ParsedFileUrl | null {
    // Recognizes the current `/api/media/` scheme and the legacy `/media-stream/` still in older content.
    const match = url.match(/\/(?:api\/media|media-stream)\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    return { organizationId: match[1], fileId: match[2] };
}

export function extractFileId(url: string): string | null {
    return parseFileUrl(url)?.fileId ?? parseMediaUrl(url)?.fileId ?? null;
}
