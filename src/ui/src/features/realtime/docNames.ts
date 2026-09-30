import { ContentType } from "@uniffy/proto/common/v1/common_pb";

export function docContentTypeName(contentType: ContentType): string {
  return ContentType[contentType];
}

/** Wire doc name, byte-identical to the backend `doc_name_for`. */
export function docNameFor(contentType: string, contentId: string): string {
  return `${contentType}:${contentId}`;
}
