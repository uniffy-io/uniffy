/**
 * Utility functions for file list components
 */

import type { Icon } from '@phosphor-icons/react';
import {
    File,
    FileImage,
    FileDoc,
    FilePdf,
    FileVideo,
    FileAudio,
    FileZip,
    FileCode,
} from '@phosphor-icons/react';

/**
 * Get icon component for file type based on MIME type
 */
export function getFileIcon(mimeType: string): Icon {
    if (mimeType.startsWith('image/')) return FileImage;
    if (mimeType.startsWith('video/')) return FileVideo;
    if (mimeType.startsWith('audio/')) return FileAudio;
    if (mimeType === 'application/pdf') return FilePdf;
    if (mimeType.includes('word') || mimeType.includes('document')) return FileDoc;
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return FileZip;
    if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('html') || mimeType.includes('css') || mimeType.includes('xml')) return FileCode;
    return File;
}

/**
 * Render file icon - avoids component creation during render
 */
export function renderFileIcon(mimeType: string, size: number, className: string) {
    const IconComponent = getFileIcon(mimeType);
    return <IconComponent size={size} weight="duotone" className={className} />;
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format timestamp to readable date string
 */
export function formatDate(timestamp?: { seconds: number; nanos: number }): string {
    if (!timestamp) return '-';
    const date = new Date(timestamp.seconds * 1000);
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
}

/**
 * MIME types that support server-side thumbnail generation.
 * Keep in sync with backend workers/utils/mime.py THUMBNAIL_MIME_TYPES.
 */
const THUMBNAIL_MIME_TYPES = new Set([
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    // PDFs
    'application/pdf',
    // Videos
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/mpeg',
    'video/ogg',
]);

/**
 * Check if a MIME type supports thumbnail generation
 */
export function supportsThumbnail(mimeType: string): boolean {
    return THUMBNAIL_MIME_TYPES.has(mimeType);
}
