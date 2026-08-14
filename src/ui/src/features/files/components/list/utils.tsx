import type { Icon } from "@phosphor-icons/react";
import {
  File,
  FileImage,
  FileDoc,
  FilePdf,
  FileVideo,
  FileAudio,
  FileZip,
  FileCode,
} from "@phosphor-icons/react";

export function getFileIcon(mimeType: string): Icon {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType === "application/pdf") return FilePdf;
  if (mimeType.includes("word") || mimeType.includes("document")) return FileDoc;
  if (mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("archive"))
    return FileZip;
  if (
    mimeType.includes("javascript") ||
    mimeType.includes("json") ||
    mimeType.includes("html") ||
    mimeType.includes("css") ||
    mimeType.includes("xml")
  )
    return FileCode;
  return File;
}

export function renderFileIcon(mimeType: string, size: number, className: string) {
  const IconComponent = getFileIcon(mimeType);
  return <IconComponent size={size} weight="duotone" className={className} />;
}

export { formatProtoDate as formatDate, formatFileSize } from "@/shared/utils/dateFormatting";

/** Keep in sync with backend workers/utils/mime.py THUMBNAIL_MIME_TYPES. */
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
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
  "audio/aac",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/opus",
  "audio/webm",
]);

export function supportsThumbnail(mimeType: string): boolean {
  return THUMBNAIL_MIME_TYPES.has(mimeType);
}
