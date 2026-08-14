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
  options?: { full?: boolean },
): string {
  const base = buildMediaUrl(organizationId, fileId);
  return options?.full ? `${base}?full=true` : base;
}

/** Stored avatar variants and their pixel size; mirrors `AVATAR_SIZES` in `core/avatars.py`. */
const AVATAR_VARIANT_PX = { sm: 32, md: 64, lg: 128 } as const;

export type AvatarVariant = keyof typeof AVATAR_VARIANT_PX;

/** Smallest stored variant that still covers a `cssPx` box on a 2x display.
 *  Asking for the variant that matches the box 1:1 is what makes avatars look
 *  soft on every retina screen. */
export function avatarVariantForPx(cssPx: number): AvatarVariant {
  const needed = cssPx * 2;
  if (needed <= AVATAR_VARIANT_PX.sm) return "sm";
  if (needed <= AVATAR_VARIANT_PX.md) return "md";
  return "lg";
}

/** `version` is the upload's content hash, so a new avatar gets a new URL.
 *  Without one, `_v=2` busts immutable cache entries written before ETag
 *  support landed but leaves the browser serving the old image for its
 *  max-age after a re-upload. */
export function buildAvatarUrl(userId: string, size: string, version?: string): string {
  return `/api/avatars/${userId}/${size}?${version ? `v=${version}` : "_v=2"}`;
}

/** Points a server-built avatar URL at another stored variant, keeping its content
 *  hash. The server picks one size for every consumer, so the surface that knows
 *  its own box size is the one that has to state the variant it needs. */
export function avatarUrlAtVariant(url: string, variant: AvatarVariant): string {
  const match = url.match(/^(.*\/api\/avatars\/[^/?#]+)\/[^/?#]+(\?.*)?$/);
  return match ? `${match[1]}/${variant}${match[2] ?? ""}` : url;
}

/** Reads the content hash back out of a server-built avatar URL. */
export function avatarVersionFromUrl(url: string | null | undefined): string | undefined {
  const query = url?.split("?")[1];
  if (!query) return undefined;
  return new URLSearchParams(query).get("v") ?? undefined;
}

export function buildAgentAvatarUrl(agentId: string, size: string = "sm"): string {
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
