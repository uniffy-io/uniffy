/** Module-level fan-out for CONTENT_ACCESS_CHANGED stream events, so any page can refetch when its accessible-content set shifts (shared with the user, or content became/ceased OPEN_TO_ORG). */

import type { ContentType } from "@uniffy/proto/common/v1/common_pb";

export type ContentAccessAction = "granted" | "revoked" | "access_mode_changed" | "child_added";

export interface ContentAccessChange {
  contentType: ContentType;
  contentId: string;
  action: ContentAccessAction;
}

type Listener = (change: ContentAccessChange) => void;

const listeners = new Set<Listener>();

export function onContentAccessChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitContentAccessChanged(change: ContentAccessChange): void {
  listeners.forEach((listener) => listener(change));
}
