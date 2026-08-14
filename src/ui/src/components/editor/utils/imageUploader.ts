import { uploadService } from "@/features/files/upload";
import { attachmentsApi } from "@/features/files/api/attachmentsApi";
import { buildFileUrl } from "@/shared/utils/fileUrls";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";

const attachmentsFolderCache = new Map<string, string>();

async function getAttachmentsFolderId(organizationId: string): Promise<string> {
  const cached = attachmentsFolderCache.get(organizationId);
  if (cached) {
    return cached;
  }

  const response = await attachmentsApi.getAttachmentsFolder({
    organizationId,
  });

  const folderId = response.folderId;
  attachmentsFolderCache.set(organizationId, folderId);
  return folderId;
}

export interface UploadImageOptions {
  file: File;
  organizationId: string;
  /** Empty string defers attachment until the editor flushes content. */
  contentId: string;
  contentType: ContentType;
  onProgress?: (percent: number) => void;
  onFileUploaded?: (fileId: string) => void;
}

export async function uploadImage(options: UploadImageOptions): Promise<string> {
  const { file, organizationId, contentId, contentType, onProgress, onFileUploaded } = options;

  const folderId = await getAttachmentsFolderId(organizationId);
  onProgress?.(5);

  // The shared engine slices and POSTs in a worker, off the main thread, so a large paste no longer
  // freezes the editor. persist:false: an editor image is ephemeral until the content flushes.
  const [handle] = uploadService.enqueue([
    {
      file,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      organizationId,
      context: "editor",
      folderId,
      persist: false,
    },
  ]);

  const unsubscribe = uploadService.subscribe((records) => {
    const record = records.find((r) => r.id === handle.id);
    if (record) onProgress?.(5 + record.progress * 0.8);
  });

  let fileId: string;
  try {
    ({ fileId } = await handle.done);
  } finally {
    unsubscribe();
  }
  onProgress?.(85);

  if (contentId) {
    await attachmentsApi.attachFile({
      organizationId,
      sourceFileId: fileId,
      contentType,
      contentId,
    });
  }
  onFileUploaded?.(fileId);
  onProgress?.(100);

  return buildFileUrl(organizationId, fileId);
}

export function createImageUploadHandler(
  contentType: ContentType,
  contentId: string,
  organizationId: string,
  onFileUploaded?: (fileId: string) => void,
): (file: File) => Promise<string> {
  return async (file: File): Promise<string> => {
    return uploadImage({
      file,
      organizationId,
      contentId,
      contentType,
      onFileUploaded,
    });
  };
}
