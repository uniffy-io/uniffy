import { useCallback, useEffect, useRef, useState } from "react";
import type { YTextEvent } from "yjs";
import { getMarkdownYText } from "@features/notes/realtime/noteYText";
import { diffStrings } from "@features/notes/realtime/textDiff";
import { useNoteRealtimeSession } from "@features/notes/realtime/useNoteRealtimeSession";
import type { DocSession } from "@shared/realtime/useDocSession";

const PUSH_DEBOUNCE_MS = 250;
const IDLE_APPLY_MS = 1500;
const IDLE_RETRY_MS = 500;

export interface NoteCoEditing {
  session: DocSession | null;
  /** Realtime owns content persistence once the first sync lands. */
  live: boolean;
  scheduleLocalPush(canonical: string): void;
  flushLocalPush(): void;
  /** Commit a deferred remote merge now (call on input blur). */
  applyPendingRemote(): void;
}

interface CoEditingCallbacks {
  getLocalCanonical: () => string;
  getLoadedCanonical: () => string | null;
  /** Rebuild the visible input from the merged doc text. */
  applyRemote: (canonical: string) => void;
}

interface Controller {
  schedule(canonical: string): void;
  flush(): void;
  applyNow(): void;
}

/**
 * Two-way binding between the plain-text markdown editor and the note's
 * `Y.Text("markdown")`.
 *
 * Local edits push as minimal deltas diffed against the user's LAST LOCAL
 * string - diffing against the merged doc view would delete concurrent peer
 * inserts. Remote merges refresh the visible input only while the user is
 * idle; while they type, peer edits accumulate in the CRDT and land on the
 * next pause. Both sides' inserts survive either way.
 */
export function useNoteCoEditing(
  opts: { noteId: string | undefined; enabled: boolean } & CoEditingCallbacks,
): NoteCoEditing {
  const session = useNoteRealtimeSession({ noteId: opts.noteId, enabled: opts.enabled });
  const [live, setLive] = useState(false);

  const callbacksRef = useRef<CoEditingCallbacks>(opts);
  useEffect(() => {
    callbacksRef.current = opts;
  });

  const controllerRef = useRef<Controller | null>(null);

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLive(false);
      controllerRef.current = null;
      return;
    }

    const ytext = getMarkdownYText(session.ydoc);
    let cancelled = false;
    let lastPushed: string | null = null;
    let lastLocalEditAt = 0;
    let pendingPush: string | null = null;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let remotePending = false;
    let remoteTimer: ReturnType<typeof setTimeout> | null = null;

    const doPush = (canonical: string) => {
      const prev = lastPushed ?? "";
      const delta = diffStrings(prev, canonical);
      if (!delta) return;
      session.ydoc.transact(() => {
        if (delta.deleteCount > 0) ytext.delete(delta.index, delta.deleteCount);
        if (delta.insert.length > 0) ytext.insert(delta.index, delta.insert);
      }, session.sessionId);
      lastPushed = canonical;
    };

    const flush = () => {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
      }
      if (pendingPush !== null) {
        const c = pendingPush;
        pendingPush = null;
        doPush(c);
      }
    };

    const schedule = (canonical: string) => {
      lastLocalEditAt = Date.now();
      pendingPush = canonical;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = null;
        if (pendingPush !== null) {
          const c = pendingPush;
          pendingPush = null;
          doPush(c);
        }
      }, PUSH_DEBOUNCE_MS);
    };

    const applyNow = () => {
      if (remoteTimer) {
        clearTimeout(remoteTimer);
        remoteTimer = null;
      }
      if (!remotePending || cancelled) return;
      if (Date.now() - lastLocalEditAt < IDLE_APPLY_MS) {
        remoteTimer = setTimeout(applyNow, IDLE_RETRY_MS);
        return;
      }
      remotePending = false;
      // Commit in-flight keystrokes before reading the merged doc, so the
      // rebuild below cannot silently drop them.
      flush();
      const merged = ytext.toString();
      lastPushed = merged;
      if (merged !== callbacksRef.current.getLocalCanonical()) {
        callbacksRef.current.applyRemote(merged);
      }
    };

    const observer = (event: YTextEvent) => {
      if (event.transaction.origin === session.sessionId) return;
      remotePending = true;
      applyNow();
    };

    controllerRef.current = { schedule, flush, applyNow };

    void session.whenSynced.then(() => {
      if (cancelled) return;
      const serverText = ytext.toString();
      const local = callbacksRef.current.getLocalCanonical();
      const loaded = callbacksRef.current.getLoadedCanonical();
      lastPushed = serverText;
      if (loaded !== null && local !== loaded) {
        // The user typed before the handshake finished; merge those edits in
        // rather than overwriting them with the server text.
        doPush(local);
      } else if (serverText !== local) {
        callbacksRef.current.applyRemote(serverText);
      }
      ytext.observe(observer);
      setLive(true);
    });

    return () => {
      cancelled = true;
      ytext.unobserve(observer);
      if (remoteTimer) clearTimeout(remoteTimer);
      // A pending local delta still lands in the doc; the multiplexer ships it
      // before the session tears down (this cleanup runs first).
      flush();
      controllerRef.current = null;
    };
  }, [session]);

  const scheduleLocalPush = useCallback((canonical: string) => {
    controllerRef.current?.schedule(canonical);
  }, []);
  const flushLocalPush = useCallback(() => {
    controllerRef.current?.flush();
  }, []);
  const applyPendingRemote = useCallback(() => {
    controllerRef.current?.applyNow();
  }, []);

  return { session, live, scheduleLocalPush, flushLocalPush, applyPendingRemote };
}
