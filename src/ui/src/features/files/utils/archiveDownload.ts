import type { AppDispatch } from "@/app/store";
import { filesApi } from "@/features/files/api/filesApi";
import { fileWorkerManager, type ZipFileEntry } from "@/features/files/workers";
import { getAccessToken, refreshAccessToken } from "@/config/api";
import {
  startDownload,
  updateDownloadProgress,
  setDownloadArchiving,
  completeDownload,
  failDownload,
} from "@/features/files/store/uploadSlice";

export interface DownloadProgress {
  current: number;
  total: number;
  filename: string;
}

export interface FileDownloadItem {
  fileId: string;
  /** Path within the archive when preserving folder structure (e.g. "Folder/file.txt"). */
  path?: string;
}

export async function downloadAsArchive(
  files: (string | FileDownloadItem)[],
  organizationId: string,
  archiveName: string = "files",
  dispatch?: AppDispatch,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (files.length === 0) return;

  const downloadItems: FileDownloadItem[] = files.map((f) =>
    typeof f === "string" ? { fileId: f } : f,
  );

  const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  dispatch?.(
    startDownload({
      id: downloadId,
      filename: `${archiveName}.zip`,
      fileCount: downloadItems.length,
    }),
  );

  if (!fileWorkerManager.isInitialized()) {
    fileWorkerManager.init(getAccessToken, refreshAccessToken);
  }

  const pathCount: Record<string, number> = {};
  const zipEntries: ZipFileEntry[] = [];

  try {
    for (let i = 0; i < downloadItems.length; i++) {
      const { fileId, path: providedPath } = downloadItems[i];

      try {
        const chunks: Uint8Array[] = [];
        let filename = "file";
        let mimeType = "application/octet-stream";

        for await (const chunk of filesApi.downloadFile({ fileId, organizationId })) {
          if (chunk.filename) filename = chunk.filename;
          if (chunk.mimeType) mimeType = chunk.mimeType;
          chunks.push(chunk.data);
        }

        let archivePath = providedPath || filename;

        // Reserve 80% of progress for downloads, the rest for compression.
        const progress = Math.round(((i + 1) / downloadItems.length) * 80);
        dispatch?.(
          updateDownloadProgress({
            id: downloadId,
            currentFile: i + 1,
            currentFilename: filename,
            progress,
          }),
        );

        onProgress?.({
          current: i + 1,
          total: downloadItems.length,
          filename,
        });

        if (pathCount[archivePath]) {
          const lastDot = archivePath.lastIndexOf(".");
          const lastSlash = archivePath.lastIndexOf("/");
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

        const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        zipEntries.push({
          path: archivePath,
          data: combined.buffer,
          mimeType,
        });
      } catch (error) {
        console.error(`Failed to download file ${fileId}:`, error);
      }
    }

    dispatch?.(setDownloadArchiving(downloadId));

    const zipData = await fileWorkerManager.compressZip({
      files: zipEntries,
      compressionLevel: 6,
      onProgress: (current, total) => {
        const progress = 80 + Math.round((current / total) * 20);
        dispatch?.(
          updateDownloadProgress({
            id: downloadId,
            currentFile: downloadItems.length,
            currentFilename: "Compressing...",
            progress,
          }),
        );
      },
    });

    const zipBlob = new Blob([zipData], { type: "application/zip" });

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${archiveName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    dispatch?.(completeDownload(downloadId));
  } catch (error) {
    dispatch?.(
      failDownload({
        id: downloadId,
        error: error instanceof Error ? error.message : "Download failed",
      }),
    );
    throw error;
  }
}
