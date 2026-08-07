import { useCallback, useEffect, useRef, useState } from "react";
import type { YTextEvent } from "yjs";
import { getMarkdownYText } from "@features/notes/realtime/noteYText";
import { diffStrings } from "@features/notes/realtime/textDiff";
import { useNoteRealtimeSession } from "@features/notes/realtime/useNoteRealtimeSession";
import type { DocSession } from "@shared/realtime/useDocSession";

const PUSH_DEBOUNCE_MS = 120;
// Remote merges render continuously; the window only coalesces bursts so the
// input is not rebuilt per keystroke of a fast-typing peer.
const APPLY_COALESCE_MS = 200;
// Rebuilding the controlled TextInput while the local user is mid-typing drops
// the keystrokes that sit between the native event and the JS rebuild - there
// is no delta API, every apply replaces the whole native buffer. Hold applies
// until this much silence; blur and teardown still force-apply.
const TYPING_IDLE_MS = 900;

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
 * string, transformed onto the live doc when peers moved it. Remote merges
 * rebuild the visible input as soon as the local user pauses typing, with the
 * local caret mapped across each change. Both sides' inserts survive
 * concurrent typing.
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
    let pendingPush: string | null = null;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let remotePending = false;
    let remoteTimer: ReturnType<typeof setTimeout> | null = null;
    let lastLocalInputAt = 0;

    // `lastPushed` mirrors the string the INPUT is based on, not the merged
    // doc. Pushing a diff computed against a base the doc has moved past
    // would treat every peer insert as a local delete and wipe it.
    const doPush = (canonical: string) => {
      const prev = lastPushed ?? "";
      if (canonical === prev) return;
      const dLocal = diffStrings(prev, canonical);
      if (!dLocal) return;
      const current = ytext.toString();
      let index = dLocal.index;
      let deleteCount = dLocal.deleteCount;
      if (current !== prev) {
        // Remote edits landed since the input last rebased; transform the
        // local delta onto the live doc instead of trusting stale indices.
        const dRemote = diffStrings(prev, current);
        if (dRemote) {
          const remoteEnd = dRemote.index + dRemote.deleteCount;
          const localEnd = dLocal.index + dLocal.deleteCount;
          if (index >= remoteEnd) {
            index += dRemote.insert.length - dRemote.deleteCount;
          } else if (localEnd > dRemote.index) {
            // Overlapping regions: never delete peer text on a guess - keep
            // the local insert and land it right after the remote edit.
            deleteCount = 0;
            index = dRemote.index + dRemote.insert.length;
          }
        }
        // The input still lags the doc; queue a rebase.
        remotePending = true;
      }
      index = Math.min(index, ytext.length);
      session.ydoc.transact(() => {
        if (deleteCount > 0) ytext.delete(index, Math.min(deleteCount, ytext.length - index));
        if (dLocal.insert.length > 0) ytext.insert(index, dLocal.insert);
      }, session.sessionId);
      lastPushed = canonical;
      if (remotePending) scheduleApply();
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
      lastLocalInputAt = Date.now();
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

    const armApply = (delay: number) => {
      remoteTimer = setTimeout(() => {
        remoteTimer = null;
        if (cancelled) return;
        const sinceLocal = Date.now() - lastLocalInputAt;
        if (sinceLocal < TYPING_IDLE_MS) {
          armApply(TYPING_IDLE_MS - sinceLocal);
          return;
        }
        applyNow();
      }, delay);
    };

    const scheduleApply = () => {
      if (remoteTimer || cancelled) return;
      armApply(APPLY_COALESCE_MS);
    };

    const observer = (event: YTextEvent) => {
      if (event.transaction.origin === session.sessionId) return;
      remotePending = true;
      scheduleApply();
    };

    controllerRef.current = { schedule, flush, applyNow };

    let observing = false;
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
      observing = true;
      setLive(true);
    });

    return () => {
      cancelled = true;
      if (observing) ytext.unobserve(observer);
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
