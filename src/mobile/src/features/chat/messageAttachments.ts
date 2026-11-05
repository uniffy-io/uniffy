import { filesApi } from "@features/files/filesApi";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { SerializedMessage } from "@features/chat/chatSerializer";

export async function attachAttachments(organizationId: string, messages: SerializedMessage[]) {
  if (messages.length === 0) return;
  try {
    const batch = await filesApi.batchListAttachments({
      organizationId,
      contentType: ContentType.CHAT_MESSAGE,
      contentIds: messages.map((m) => m.id),
    });
    const byId = new Map<string, SerializedMessage["attachments"]>();
    for (const group of batch.groups) {
      byId.set(
        group.contentId,
        group.attachments.map((a) => ({
          id: a.id,
          fileId: a.fileId,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: Number(a.sizeBytes),
        })),
      );
    }
    for (const m of messages) {
      const attachments = byId.get(m.id);
      if (attachments) m.attachments = attachments;
    }
  } catch {
    // Messages render without attachment metadata.
  }
}
