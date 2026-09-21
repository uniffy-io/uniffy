import { getApiBaseUrl } from "@core/config/serverUrl";

// Asset routes (files / thumbnails / media) authenticate via the asset-read
// cookie attached as an explicit header (see core/auth/assetAuth.ts), so every
// <Image>/<WebView> request must carry `source.headers`.
export { assetAuthHeaders } from "@core/auth/assetAuth";

export function buildFileUrl(organizationId: string, fileId: string): string {
  return `${getApiBaseUrl()}/files/${organizationId}/${fileId}`;
}

export function buildThumbnailUrl(organizationId: string, fileId: string): string {
  return `${getApiBaseUrl()}/thumbnails/${organizationId}/${fileId}`;
}

export function buildMediaUrl(organizationId: string, fileId: string): string {
  return `${getApiBaseUrl()}/media/${organizationId}/${fileId}`;
}

// Mirrors the backend THUMBNAIL_MIME_TYPES (domains/files/jobs/mime.py): only these
// types have a server-generated thumbnail, so only these should attempt the
// thumbnail route - everything else falls straight back to an icon/badge.
const THUMBNAIL_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
  "video/ogg",
]);

export function supportsThumbnail(mimeType?: string): boolean {
  if (!mimeType) return false;
  return THUMBNAIL_MIME_TYPES.has(mimeType.split(";")[0].trim().toLowerCase());
}

export function buildPlaybackUrl(organizationId: string, fileId: string, version: number): string {
  return `${buildMediaUrl(organizationId, fileId)}/playback/${version}`;
}
