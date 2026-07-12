import { ENV } from "@/constants/env";
import { getAccessToken } from "@/lib/auth";

// Asset routes (files / thumbnails / media) authenticate a Bearer token on
// mobile - there is no uniffy_asset cookie as on web - so every <Image>/<WebView>
// request must carry the header explicitly via `source.headers`.
export function buildFileUrl(organizationId: string, fileId: string): string {
  return `${ENV.apiUrl}/files/${organizationId}/${fileId}`;
}

export function buildThumbnailUrl(organizationId: string, fileId: string): string {
  return `${ENV.apiUrl}/thumbnails/${organizationId}/${fileId}`;
}

export function buildMediaUrl(organizationId: string, fileId: string): string {
  return `${ENV.apiUrl}/media/${organizationId}/${fileId}`;
}

export function assetAuthHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getAccessToken() ?? ""}` };
}

// Mirrors the backend THUMBNAIL_MIME_TYPES (workers/utils/mime.py): only these
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
