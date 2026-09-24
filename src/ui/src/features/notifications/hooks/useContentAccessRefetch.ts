import { useEffect, useRef } from "react";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  onContentAccessChanged,
  type ContentAccessChange,
} from "@/features/notifications/contentAccessEmitter";

/** Coalesce repeated events without dropping distinct resources or actions. */
export function useContentAccessRefetch(
  contentType: ContentType | ContentType[],
  refetch: (changes: readonly ContentAccessChange[]) => void,
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
    const pending = new Map<string, ContentAccessChange>();
    const unsubscribe = onContentAccessChanged((change) => {
      if (!types.has(change.contentType)) return;
      pending.set(`${change.contentType}:${change.contentId}:${change.action}`, change);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const changes = [...pending.values()];
        pending.clear();
        refetchRef.current(changes);
      }, debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [typeKey, debounceMs]);
}
