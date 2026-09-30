import { ContentType } from "@uniffy/proto/common/v1/common_pb";

export function docContentTypeName(contentType: ContentType): string {
  return ContentType[contentType];
}
