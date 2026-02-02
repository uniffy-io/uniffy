/**
 * Archive Download Utility
 *
 * Downloads multiple files and packages them into a zip archive.
 * Uses Web Worker for ZIP compression to avoid blocking the main thread.
 * Supports preserving folder structure when downloading folder contents.
 */

import type { AppDispatch } from '@/app/store';
import { filesApi } from '../api/filesApi';
import { fileWorkerManager, type ZipFileEntry } from '../workers';
import { getAccessToken, refreshAccessToken } from '@/config/api';
import {
    startDownload,
    updateDownloadProgress,
    setDownloadArchiving,
    completeDownload,
    failDownload,
} from '../store/uploadSlice';

export interface DownloadProgress {
    current: number;
    total: number;
    filename: string;
}

export interface FileDownloadItem {
    fileId: string;
    path?: string; // Optional path for folder structure (e.g., "FolderA/SubFolder/file.txt")
}

/**
 * Download multiple files and create a zip archive.
 * Supports both flat downloads (file IDs only) and hierarchical downloads (with paths).
 *
 * @param files - Array of file IDs (strings) or FileDownloadItems with paths
 * @param organizationId - Organization ID for the files
 * @param archiveName - Name for the resulting zip file (without extension)
 * @param dispatch - Redux dispatch function for progress tracking
 * @param onProgress - Optional callback for download progress
 */
export async function downloadAsArchive(
    files: (string | FileDownloadItem)[],
    organizationId: string,
    archiveName: string = 'files',
    dispatch?: AppDispatch,
    onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
    if (files.length === 0) return;

    // Normalize input to FileDownloadItem[]
    const downloadItems: FileDownloadItem[] = files.map((f) =>
        typeof f === 'string' ? { fileId: f } : f
    );

    // Generate unique download ID
    const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Start download tracking
    dispatch?.(startDownload({
        id: downloadId,
        filename: `${archiveName}.zip`,
        fileCount: downloadItems.length,
    }));

    // Initialize worker manager if needed
    if (!fileWorkerManager.isInitialized()) {
        fileWorkerManager.init(getAccessToken, refreshAccessToken);
    }

    // Track used paths for deduplication (path -> count)
    const pathCount: Record<string, number> = {};
    // Collect file data for worker compression
    const zipEntries: ZipFileEntry[] = [];

    try {
        // Download each file and collect data
        for (let i = 0; i < downloadItems.length; i++) {
            const { fileId, path: providedPath } = downloadItems[i];

            try {
                const chunks: Uint8Array[] = [];
                let filename = 'file';
                let mimeType = 'application/octet-stream';

                // Stream download from backend
                for await (const chunk of filesApi.downloadFile({ fileId, organizationId })) {
                    if (chunk.filename) filename = chunk.filename;
                    if (chunk.mimeType) mimeType = chunk.mimeType;
                    chunks.push(chunk.data);
                }

                // Determine the path in the archive
                // If a path is provided (from folder structure), use it
                // Otherwise use just the filename (flat structure)
                let archivePath = providedPath || filename;

                // Report progress
                const progress = Math.round(((i + 1) / downloadItems.length) * 80); // 80% for downloads, 20% for archiving
                dispatch?.(updateDownloadProgress({
                    id: downloadId,
                    currentFile: i + 1,
                    currentFilename: filename,
                    progress,
                }));

                onProgress?.({
                    current: i + 1,
                    total: downloadItems.length,
                    filename,
                });

                // Handle duplicate paths by adding a counter
                if (pathCount[archivePath]) {
                    const lastDot = archivePath.lastIndexOf('.');
                    const lastSlash = archivePath.lastIndexOf('/');
                    // Find extension position (must be after last slash)
                    const extPos = lastDot > lastSlash ? lastDot : -1;
                    if (extPos > 0) {
                        archivePath = `${archivePath.slice(0, extPos)} (${pathCount[archivePath]})${archivePath.slice(extPos)}`;
                    } else {
                        archivePath = `${archivePath} (${pathCount[archivePath]})`;
                    }
                    pathCount[providedPath || filename]++;
                } else {
                    pathCount[providedPath || filename] = 1;
                }

                // Combine chunks into single ArrayBuffer
                const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
                const combined = new Uint8Array(totalSize);
                let offset = 0;
                for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }

                // Add to zip entries for worker
                zipEntries.push({
                    path: archivePath,
                    data: combined.buffer,
                    mimeType,
                });
            } catch (error) {
                console.error(`Failed to download file ${fileId}:`, error);
                // Continue with other files even if one fails
            }
        }

        // Set archiving state
        dispatch?.(setDownloadArchiving(downloadId));

        // Compress in worker (off main thread)
        const zipData = await fileWorkerManager.compressZip({
            files: zipEntries,
            compressionLevel: 6,
            onProgress: (current, total) => {
                // Update progress during compression (80-100%)
                const progress = 80 + Math.round((current / total) * 20);
                dispatch?.(updateDownloadProgress({
                    id: downloadId,
                    currentFile: downloadItems.length,
                    currentFilename: 'Compressing...',
                    progress,
                }));
            },
        });

        // Create blob from worker result
        const zipBlob = new Blob([zipData], { type: 'application/zip' });

        // Trigger download
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${archiveName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Mark as complete
        dispatch?.(completeDownload(downloadId));
    } catch (error) {
        console.error('Archive download failed:', error);
        dispatch?.(failDownload({
            id: downloadId,
            error: error instanceof Error ? error.message : 'Download failed',
        }));
        throw error;
    }
}
