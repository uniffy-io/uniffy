import { filesApi } from "@/features/files/api/filesApi";
import { setFile } from "@/features/files/store/filesSlice";
import { fileToPlain } from "@/features/files/store/filesThunks";
import type { AppDispatch } from "@/app/store";

export function ensurePdfExtension(name: string): string {
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

/**
 * Chunked upload of a generated PDF; projects the resulting File row into the
 * store. `versionOfFileId` swaps the bytes in as a new version of that file
 * instead of creating a new one.
 */
export async function uploadPdfBlob(
  blob: Blob,
  filename: string,
  organizationId: string,
  dispatch: AppDispatch,
  options?: { versionOfFileId?: string },
): Promise<void> {
  const initResponse = await filesApi.initiateUpload({
    organizationId,
    filename,
    totalSize: BigInt(blob.size),
    mimeType: "application/pdf",
  });

  const { uploadId, chunkSize, totalChunks } = initResponse;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, blob.size);
    const arrayBuffer = await blob.slice(start, end).arrayBuffer();
    await filesApi.uploadChunk({
      uploadId,
      chunkNumber: i + 1,
      data: new Uint8Array(arrayBuffer),
    });
  }

  const completed = await filesApi.completeUpload({
    uploadId,
    versionOfFileId: options?.versionOfFileId,
  });
  if (completed.file) {
    dispatch(setFile(fileToPlain(completed.file)));
  }
}
