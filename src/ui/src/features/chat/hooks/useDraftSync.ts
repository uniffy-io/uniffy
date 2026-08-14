import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { draftKey, draftRemoved, selectDraft } from "@/features/chat/store/chatDraftsSlice";
import { saveDraftToServer, deleteDraftOnServer } from "@/features/chat/store/chatThunks";

const SAVE_DEBOUNCE_MS = 1500;

interface DraftSyncHandle {
  initialDraft: string | null;
  /** Non-null only when a remote change is safe to apply (no unsaved local edits). */
  remoteDraft: string | null;
  onDraftChange: (markdown: string) => void;
  flushOnSend: () => void;
}

export function useDraftSync(channelId: string | null, rootMessageId?: string): DraftSyncHandle {
  const dispatch = useAppDispatch();
  const key = channelId ? draftKey(channelId, rootMessageId) : null;
  const draft = useAppSelector((state) => (key ? selectDraft(state, key) : undefined));
  const draftContent = draft?.content ?? null;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const inflightSaveRef = useRef<Promise<unknown> | null>(null);
  const lastSyncedRef = useRef("");
  const lastLocalRef = useRef("");
  const seededKeyRef = useRef<string | null>(null);
  const [remote, setRemote] = useState<{ key: string; content: string } | null>(null);

  const syncNow = useCallback(
    (markdown: string) => {
      if (!channelId) return;
      // No no-op writes: every save costs an access check + upsert + fanout.
      if (markdown === lastSyncedRef.current) return;
      lastSyncedRef.current = markdown;
      if (markdown.trim().length === 0) {
        void dispatch(deleteDraftOnServer({ channelId, rootMessageId }));
      } else {
        const save = dispatch(saveDraftToServer({ channelId, rootMessageId, content: markdown }));
        inflightSaveRef.current = save;
        void save.finally(() => {
          if (inflightSaveRef.current === save) inflightSaveRef.current = null;
        });
      }
    },
    [channelId, rootMessageId, dispatch],
  );

  useEffect(() => {
    if (!key) return;
    const incoming = draftContent ?? "";
    if (seededKeyRef.current !== key) {
      // First run for this key: seed with the store value so the initial
      // hydration is not mistaken for a remote change.
      seededKeyRef.current = key;
      lastSyncedRef.current = incoming;
      lastLocalRef.current = incoming;
      return;
    }
    if (incoming === lastSyncedRef.current) return;
    // Last-write-wins: unsaved local edits beat the remote value; the next
    // debounced save overwrites the server copy.
    if (lastLocalRef.current !== lastSyncedRef.current) return;
    lastSyncedRef.current = incoming;
    lastLocalRef.current = incoming;
    setRemote({ key, content: incoming });
  }, [key, draftContent]);

  useEffect(() => {
    return () => {
      // Key change or unmount: save any pending text immediately instead of dropping the timer.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) {
        syncNow(pending);
      }
    };
  }, [key, syncNow]);

  const onDraftChange = useCallback(
    (markdown: string) => {
      lastLocalRef.current = markdown;
      pendingRef.current = markdown;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) {
          syncNow(pending);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [syncNow],
  );

  // Cancels the pending save without flushing it. A save already on the wire
  // cannot be recalled and may land after the server-side send clear,
  // resurrecting the row; a compensating delete issued once it settles wins
  // regardless of ordering (skipped if a newer draft synced in the meantime).
  const flushOnSend = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    lastSyncedRef.current = "";
    lastLocalRef.current = "";
    setRemote(null);
    if (channelId) {
      dispatch(draftRemoved(draftKey(channelId, rootMessageId)));
      const inflight = inflightSaveRef.current;
      if (inflight) {
        void inflight.finally(() => {
          if (lastSyncedRef.current === "") {
            void dispatch(deleteDraftOnServer({ channelId, rootMessageId }));
          }
        });
      }
    }
  }, [channelId, rootMessageId, dispatch]);

  return {
    initialDraft: draftContent,
    remoteDraft: remote && remote.key === key ? remote.content : null,
    onDraftChange,
    flushOnSend,
  };
}
