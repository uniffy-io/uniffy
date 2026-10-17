import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTextBinding,
  type TextBinding,
  type TextBindingCallbacks,
} from "@features/notes/realtime/textBinding";
import { useNoteRealtimeSession } from "@features/notes/realtime/useNoteRealtimeSession";
import type { DocSession } from "@shared/realtime/docSession";
import type { RealtimeStatus } from "@shared/realtime/protocol";
import type { PersistenceState } from "@shared/realtime/persistenceState";
import type { MobileRecoveredDraft } from "@shared/realtime/draftStorage";
import { saveTextDraft, saveDraft, readStoredDrafts } from "@shared/realtime/draftStorage";
import { hydrateOfflineDraft, offlineReplayBase } from "@features/notes/realtime/draftRecovery";
import { useAuth } from "@core/providers/AuthContext";

export interface NoteCoEditing {
  session: DocSession | null;
  status: RealtimeStatus;
  persistence: PersistenceState;
  recoveredDrafts: MobileRecoveredDraft[];
  restoreRecoveredDraft(draft: MobileRecoveredDraft): Promise<void>;
  discardRecoveredDraft(id: string): Promise<void>;
  /** The current session has completed its initial merge. */
  live: boolean;
  ownsContent: boolean;
  scheduleLocalPush(canonical: string): void;
  flushLocalPush(): void;
  /** Commit a deferred remote merge now (call on input blur). */
  applyPendingRemote(): void;
  /** Resolves false while some edit exists only in memory, so Done must stay open. */
  persistLocally(): Promise<boolean>;
}

/** Binds the plain-text markdown editor to the note's live doc for one session at a time. */
export function useNoteCoEditing(
  opts: {
    noteId: string | undefined;
    enabled: boolean;
    readOnly?: boolean;
  } & TextBindingCallbacks,
): NoteCoEditing {
  const { user, organizationId } = useAuth();
  const controllerRef = useRef<TextBinding | null>(null);
  const inputBase = useRef<{ noteId: string | undefined; text: string } | null>(null);
  // Flush in-flight local edits while the doc and socket are still live; the
  // binding effect's own cleanup runs after the detach and is too late.
  const onBeforeDetach = useCallback(() => {
    controllerRef.current?.flush();
    const text = controllerRef.current?.getInputBase();
    if (text !== null && text !== undefined) inputBase.current = { noteId: opts.noteId, text };
  }, [opts.noteId]);

  const {
    session,
    status,
    persistence,
    recoveredDrafts,
    discardRecoveredDraft,
    trackDraftWrite,
    persistLocally,
  } = useNoteRealtimeSession({
    noteId: opts.noteId,
    enabled: opts.enabled,
    readOnly: opts.readOnly,
    onBeforeDetach,
  });
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [draftId] = useState(() => `${Date.now()}.${Math.random().toString(36).slice(2)}`);
  const draftLineage = useRef(draftId);
  const live = session !== null && liveSessionId === session.sessionId;

  const callbacksRef = useRef<TextBindingCallbacks>(opts);
  useEffect(() => {
    callbacksRef.current = opts;
  });

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react/react-compiler
      setLiveSessionId(null);
      controllerRef.current = null;
      return;
    }
    let cancelled = false;
    let consumedText: string | null = null;
    let restoredDraft: MobileRecoveredDraft | null = null;
    let replayed = true;
    const prepared = session.initialDrafts
      .then((drafts) => {
        if (cancelled || opts.readOnly) return;
        const restored = hydrateOfflineDraft(drafts, callbacksRef.current);
        restoredDraft = restored;
        if (restored) draftLineage.current = restored.generation.slice("unmerged:".length);
      })
      .catch((error) => console.warn("[realtime] offline draft recovery failed", error));
    const binding = createTextBinding({
      ydoc: session.ydoc,
      origin: session.sessionId,
      whenSynced: Promise.all([session.whenSynced, prepared]).then(() => {}),
      // Read through the ref so the screen's per-render callbacks stay current.
      callbacks: {
        getLocalCanonical: () => {
          const text = callbacksRef.current.getLocalCanonical();
          consumedText = text;
          return text;
        },
        getLoadedCanonical: () => {
          if (restoredDraft) {
            const base = offlineReplayBase(
              restoredDraft,
              session.ydoc.getText("markdown").toString(),
            );
            if (base !== null) return base;
            replayed = false;
            return callbacksRef.current.getLocalCanonical();
          }
          return inputBase.current && inputBase.current.noteId === opts.noteId
            ? inputBase.current.text
            : callbacksRef.current.getLoadedCanonical();
        },
        applyRemote: (canonical, mapIndex) => callbacksRef.current.applyRemote(canonical, mapIndex),
        isComposing: () => callbacksRef.current.isComposing?.() ?? false,
      },
      onLive: (localPreserved) => {
        setLiveSessionId(session.sessionId);
        if (
          !opts.readOnly &&
          replayed &&
          localPreserved &&
          (restoredDraft !== null || consumedText !== callbacksRef.current.getLoadedCanonical())
        ) {
          const lineage = draftLineage.current;
          const text = consumedText;
          // Retire text copies only after the merged causal document is durable.
          void saveDraft(session.storageKey, session.ydoc)
            .then(async () => {
              const drafts = await readStoredDrafts(session.storageKey);
              for (const draft of drafts) {
                if (draft.generation === `unmerged:${lineage}` && draft.text === text)
                  await discardRecoveredDraft(draft.id);
              }
            })
            .catch((error) => console.warn("[realtime] merged draft storage failed", error));
        }
      },
    });
    controllerRef.current = binding;
    return () => {
      cancelled = true;
      binding.dispose();
      controllerRef.current = null;
    };
  }, [session, opts.noteId, opts.readOnly, discardRecoveredDraft]);

  const scheduleLocalPush = useCallback(
    (canonical: string) => {
      if (opts.readOnly) return;
      if (live) controllerRef.current?.schedule(canonical);
      else if (user?.id && organizationId && opts.noteId) {
        void trackDraftWrite(
          saveTextDraft(
            `realtime.${user.id}.${organizationId}.NOTE.${opts.noteId}`,
            canonical,
            inputBase.current && inputBase.current.noteId === opts.noteId
              ? inputBase.current.text
              : callbacksRef.current.getLoadedCanonical(),
            draftLineage.current,
          ),
        );
      }
    },
    [live, user, organizationId, opts.noteId, opts.readOnly, trackDraftWrite],
  );
  const flushLocalPush = useCallback(() => {
    controllerRef.current?.flush();
  }, []);
  const applyPendingRemote = useCallback(() => {
    controllerRef.current?.applyNow();
  }, []);

  const restoreRecoveredDraft = useCallback(
    async (draft: MobileRecoveredDraft) => {
      if (
        !session ||
        opts.readOnly ||
        status === "permission_lost" ||
        status === "access_lost" ||
        status === "update_rejected" ||
        status === "token_revoked"
      )
        return;
      controllerRef.current?.flush();
      controllerRef.current?.applyNow();
      const current = callbacksRef.current.getLocalCanonical();
      const text = current ? `${current}\n\n${draft.text}` : draft.text;
      callbacksRef.current.applyRemote(text, (index) => Math.min(index, text.length));
      if (live) {
        controllerRef.current?.schedule(text);
        controllerRef.current?.flush();
        controllerRef.current?.applyNow();
        await saveDraft(session.storageKey, session.ydoc);
      } else {
        await saveTextDraft(
          session.storageKey,
          text,
          callbacksRef.current.getLoadedCanonical(),
          draftLineage.current,
        );
      }
    },
    [session, live, opts.readOnly, status],
  );

  return {
    session,
    status,
    persistence,
    live,
    ownsContent: opts.noteId !== undefined,
    recoveredDrafts,
    restoreRecoveredDraft,
    discardRecoveredDraft,
    scheduleLocalPush,
    flushLocalPush,
    applyPendingRemote,
    persistLocally,
  };
}
