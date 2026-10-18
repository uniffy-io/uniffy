import type { ContentType } from "@uniffy/proto/common/v1/common_pb";

export interface ContentChange {
  contentType: ContentType;
  contentId: string;
}

type Listener = (change: ContentChange | null) => void;
const listeners = new Set<Listener>();

export function onContentChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A null hint refreshes mounted readers after stream reconnection.
export function emitContentChanged(change: ContentChange | null): void {
  for (const listener of listeners) listener(change);
}

export function subscribeContentRefresh(
  contentType: ContentType,
  contentId: string | null,
  refresh: () => void,
  delay = 300,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = onContentChanged((change) => {
    if (
      change &&
      (change.contentType !== contentType || (contentId !== null && change.contentId !== contentId))
    )
      return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delay);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
