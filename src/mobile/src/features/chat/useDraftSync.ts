import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { useDrafts } from "@features/chat/useChat";
import {
  useSaveDraft,
  useDeleteDraft,
  removeDraftFromCache,
} from "@features/chat/useChatMutations";
import { draftKey } from "@features/chat/chatSerializer";
import { parseMentions, toCanonical, type MentionEntry } from "@shared/mentions/useMentionInput";

const SAVE_DEBOUNCE_MS = 1500;

/**
 * Keeps a composer's text in sync with the server-side draft for one channel
 * or thread: hydrates the composer once, debounce-saves local edits, applies
 * remote changes only while there are no unsaved local edits (last-write-wins),
 * and flushes pending text when the screen unmounts.
 */
export function useDraftSync(args: {
  channelId: string;
  rootMessageId?: string;
  draft: string;
  setDraft: (text: string) => void;
  mentionsRef: RefObject<MentionEntry[]>;
  editing?: boolean;
}): { flushOnSend: () => void } {
  const { channelId, draft, setDraft, mentionsRef, editing = false } = args;
  const rootMessageId = args.rootMessageId || undefined;
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const draftsQuery = useDrafts();

  const key = draftKey(channelId, rootMessageId);
  const savedContent = draftsQuery.data?.[key]?.content;

  // The canonical text this screen believes the server holds ("" = no draft).
  // Saves diff against it to skip no-op writes; remote events apply only when
  // the composer still matches it (no unsaved local edits).
  const lastSyncedRef = useRef("");
  const hydratedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightSaveRef = useRef<Promise<unknown> | null>(null);

  const { mutateAsync: saveDraft } = useSaveDraft();
  const { mutate: deleteDraft } = useDeleteDraft();

  const syncNow = useCallback(
    (canonical: string) => {
      if (canonical === lastSyncedRef.current) return;
      lastSyncedRef.current = canonical;
      if (canonical.trim()) {
        const save = saveDraft({ channelId, rootMessageId, content: canonical }).catch(() => {});
        inflightSaveRef.current = save;
        void save.finally(() => {
          if (inflightSaveRef.current === save) inflightSaveRef.current = null;
        });
      } else {
        deleteDraft({ channelId, rootMessageId });
      }
    },
    [channelId, rootMessageId, saveDraft, deleteDraft],
  );

  // Hydrate once per draft key, when the first drafts snapshot arrives. Text
  // the user already typed wins over the stored draft; the next debounced
  // save then overwrites the server copy.
  useEffect(() => {
    if (draftsQuery.data === undefined || hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    const saved = draftsQuery.data[key];
    lastSyncedRef.current = saved?.content ?? "";
    if (!saved || draft.length > 0 || editing) return;
    const { display, mentions } = parseMentions(saved.content);
    mentionsRef.current = mentions;
    setDraft(display);
  }, [draftsQuery.data, key, draft, editing, setDraft, mentionsRef]);

  // Remote apply: another session changed the draft. Re-hydrate only when the
  // local composer has no unsaved edits, so live typing is never clobbered.
  useEffect(() => {
    if (hydratedKeyRef.current !== key || editing) return;
    const remote = savedContent ?? "";
    if (remote === lastSyncedRef.current) return;
    if (toCanonical(draft, mentionsRef.current) !== lastSyncedRef.current) return;
    const { display, mentions } = parseMentions(remote);
    mentionsRef.current = mentions;
    setDraft(display);
    lastSyncedRef.current = remote;
  }, [savedContent, key, draft, editing, setDraft, mentionsRef]);

  useEffect(() => {
    if (editing) return;
    const timer = setTimeout(() => {
      if (timerRef.current === timer) timerRef.current = null;
      syncNow(toCanonical(draft, mentionsRef.current));
    }, SAVE_DEBOUNCE_MS);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [draft, editing, syncNow, mentionsRef]);

  // Unmount flush: persist whatever the debounce had not shipped yet. syncNow
  // no-ops when everything already matches the server.
  const composeStateRef = useRef({ draft, editing });
  useEffect(() => {
    composeStateRef.current = { draft, editing };
  }, [draft, editing]);
  useEffect(() => {
    return () => {
      const state = composeStateRef.current;
      if (state.editing) return;
      syncNow(toCanonical(state.draft, mentionsRef.current));
    };
  }, [syncNow, mentionsRef]);

  // Called before sending the composed message: the server clears the draft
  // inside the send pipeline. A save already on the wire cannot be recalled
  // and may land after that clear, resurrecting the row; a compensating
  // delete issued once it settles wins regardless of ordering (skipped if a
  // newer draft synced in the meantime).
  const flushOnSend = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastSyncedRef.current = "";
    removeDraftFromCache(queryClient, organizationId, key);
    const inflight = inflightSaveRef.current;
    if (inflight) {
      void inflight.finally(() => {
        if (lastSyncedRef.current === "") {
          deleteDraft({ channelId, rootMessageId });
        }
      });
    }
  }, [queryClient, organizationId, key, deleteDraft, channelId, rootMessageId]);

  return { flushOnSend };
}
