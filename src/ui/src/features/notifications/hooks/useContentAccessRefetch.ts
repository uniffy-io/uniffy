import { useEffect, useRef } from "react";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  onContentAccessChanged,
  type ContentAccessChange,
} from "@/features/notifications/contentAccessEmitter";

/**
 * Refetch a page's data when content of `contentType` changes: shared with the
 * user, access removed, access mode flipped, a child added to a container
 * (e.g. a task created in a project), or a shared project view changed.
 * Page-scoped: only fires while the calling
 * component is mounted. Debounced so a burst collapses into a single refetch;
 * the callback receives the latest change so it can branch on action/id.
 */
export function useContentAccessRefetch(
  contentType: ContentType | ContentType[],
  refetch: (change: ContentAccessChange) => void,
  debounceMs = 500,
): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  // Array identity changes every render; collapse to a stable dependency key.
  const typeKey = (Array.isArray(contentType) ? contentType : [contentType]).join(",");

  useEffect(() => {
    const types = new Set(typeKey.split(",").map(Number));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latest: ContentAccessChange | null = null;
    const unsubscribe = onContentAccessChanged((change) => {
      if (!types.has(change.contentType)) return;
      latest = change;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (latest) refetchRef.current(latest);
      }, debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [typeKey, debounceMs]);
}
