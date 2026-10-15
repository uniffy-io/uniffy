import { useEffect, useRef } from "react";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { subscribeContentRefresh } from "@/features/notifications/contentChangedEmitter";

export function useContentRefresh(
  contentType: ContentType,
  contentId: string | null,
  refresh: () => void,
): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    if (!contentId) return;
    const unsubscribe = subscribeContentRefresh(contentType, contentId, () => refreshRef.current());
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [contentType, contentId]);
}
