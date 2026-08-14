import { useCallback, useEffect, useRef, useState } from "react";
import type { YTextEvent } from "yjs";
import { getMarkdownYText } from "@features/notes/realtime/markdown";
import { diffStrings } from "@features/notes/realtime/textDiff";
import { useNoteRealtimeSession } from "@features/notes/realtime/useNoteRealtimeSession";
import type { DocSession } from "@shared/realtime/useDocSession";
import type { RealtimeStatus } from "@shared/realtime/protocol";

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
  status: RealtimeStatus;
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
  opts: {
    noteId: string | undefined;
    enabled: boolean;
    readOnly?: boolean;
  } & CoEditingCallbacks,
): NoteCoEditing {
  const controllerRef = useRef<Controller | null>(null);
  // Flush in-flight local edits while the doc and socket are still live; the
  // controller effect's own cleanup runs after the detach and is too late.
  const onBeforeDetach = useCallback(() => {
    controllerRef.current?.flush();
  }, []);

  const { session, status } = useNoteRealtimeSession({
    noteId: opts.noteId,
    enabled: opts.enabled,
    readOnly: opts.readOnly,
    onBeforeDetach,
  });
  const [live, setLive] = useState(false);

  const callbacksRef = useRef<CoEditingCallbacks>(opts);
  useEffect(() => {
    callbacksRef.current = opts;
  });

  useEffect(() => {
    if (!session) {
      // `live` is not derivable: it turns true only after the post-handshake
      // seed inside whenSynced, and it decides which writer owns the note's
      // content. Losing the session has to hand ownership back to the RPC
      // autosave in the same tick, or neither writer saves.
      // eslint-disable-next-line react/react-compiler
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
      if (loaded !== null && local !== loaded) {
        // The user typed before the handshake finished. Diff against the
        // RPC-loaded base their input actually grew from - seeding from the
        // server text would turn every character a peer added since that
        // load into a local delete and broadcast it.
        lastPushed = loaded;
        doPush(local);
      } else {
        lastPushed = serverText;
        if (serverText !== local) {
          callbacksRef.current.applyRemote(serverText);
        }
      }
      ytext.observe(observer);
      observing = true;
      setLive(true);
    });

    return () => {
      cancelled = true;
      if (observing) ytext.unobserve(observer);
      if (remoteTimer) clearTimeout(remoteTimer);
      // The pre-detach hook already flushed while the doc was live; this
      // covers effect re-runs where the session survives.
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

  return { session, status, live, scheduleLocalPush, flushLocalPush, applyPendingRemote };
}
