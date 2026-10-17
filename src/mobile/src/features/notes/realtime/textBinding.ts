import { AppState } from "react-native";
import type * as Y from "yjs";
import type { YTextEvent } from "yjs";
import {
  getMarkdownYText,
  MARKDOWN_MIRROR_FIELD,
  MIRROR_ACTIVE_KEY,
} from "@features/notes/realtime/markdown";
import { diffStrings, type TextDelta } from "@features/notes/realtime/textDiff";
import {
  applyDelta,
  composeDeltas,
  deltaFromTextDelta,
  deltaFromYjs,
  fineDiff,
  refineDelta,
  transformDelta,
  transformIndex,
  type Delta,
} from "@features/notes/realtime/textDelta";

export const PUSH_DEBOUNCE_MS = 120;
// Remote merges render continuously; the window only coalesces bursts so the
// input is not rebuilt per keystroke of a fast-typing peer.
export const APPLY_COALESCE_MS = 200;
// Rebuilding the controlled TextInput while the local user is mid-typing drops
// the keystrokes that sit between the native event and the JS rebuild - there
// is no delta API, every apply replaces the whole native buffer. Hold applies
// until this much silence; blur and teardown still force-apply.
export const TYPING_IDLE_MS = 900;
export const COMPOSITION_RECHECK_MS = 300;

export interface TextBindingCallbacks {
  getLocalCanonical: () => string;
  getLoadedCanonical: () => string | null;
  /**
   * Rebuild the visible input from the merged doc text. `mapIndex` carries an
   * index of the previous local text to its place in `canonical`.
   */
  applyRemote: (canonical: string, mapIndex: (index: number) => number) => void;
  /** The IME still owns an uncommitted word; a rebuild now would split it. */
  isComposing?: () => boolean;
}

export interface TextBindingOptions {
  ydoc: Y.Doc;
  /** Origin tag of this session's transactions; remote events are everything else. */
  origin: unknown;
  whenSynced: Promise<void>;
  callbacks: TextBindingCallbacks;
  onLive: (localPreserved: boolean) => void;
}

export interface TextBinding {
  getInputBase: () => string | null;
  schedule: (canonical: string) => void;
  flush: () => void;
  /** Commit a deferred remote merge now, bypassing the typing and composition gates. */
  applyNow: () => void;
  dispose: () => void;
}

/** A text the native input may be based on, with the remote changes it has not seen. */
export interface PushBase {
  text: string;
  pending: Delta;
}

export interface PushChoice {
  base: PushBase;
  local: TextDelta;
}

function deltaSize(delta: TextDelta): number {
  return delta.deleteCount + delta.insert.length;
}

/**
 * Pick the base a native text grew from. A keystroke differs from its real
 * base by about one character, so the pre-rebuild text wins only when it
 * explains the input strictly better; ties and exact matches fall back to the
 * rebuilt text, which is what the input shows when nothing was in flight.
 */
export function selectPushBase(
  canonical: string,
  primary: PushBase,
  stale: PushBase | null,
): PushChoice | null {
  const fromPrimary = diffStrings(primary.text, canonical);
  if (!fromPrimary) return null;
  if (stale) {
    const fromStale = diffStrings(stale.text, canonical);
    if (fromStale && deltaSize(fromStale) < deltaSize(fromPrimary)) {
      return { base: stale, local: fromStale };
    }
  }
  return { base: primary, local: fromPrimary };
}

/**
 * Two-way binding between a plain-text input and the note's
 * `Y.Text("markdown")`. Local edits are diffed against the text the input
 * grew from and rebased through the remote deltas that text has not seen;
 * remote merges rebuild the input once the local user pauses, with indices
 * mapped through the same deltas.
 */
export function createTextBinding(opts: TextBindingOptions): TextBinding {
  const { ydoc, origin, callbacks } = opts;
  const ytext = getMarkdownYText(ydoc);
  let cancelled = false;
  let ready = false;
  let observing = false;
  let base: PushBase = { text: "", pending: [] };
  // Kept from a rebuild until the next native text reveals which lineage the
  // input follows: a keystroke typed in the JS-to-native gap arrives on the
  // pre-rebuild text, and diffing it against the merged text would read the
  // peer's insert as a local delete.
  let stale: PushBase | null = null;
  // Doc text as of the last observed transaction; the pre-event text a coarse
  // remote replace is refined against.
  let shadow = "";
  let pendingPush: string | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let remotePending = false;
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLocalInputAt = 0;

  const writeDelta = (delta: Delta) => {
    let index = 0;
    for (const op of delta) {
      index = Math.min(index, ytext.length);
      if ("retain" in op) {
        index += op.retain;
      } else if ("insert" in op) {
        ytext.insert(index, op.insert);
        index += op.insert.length;
      } else {
        ytext.delete(index, Math.min(op.delete, ytext.length - index));
      }
    }
  };

  const clearRemoteTimer = () => {
    if (remoteTimer) {
      clearTimeout(remoteTimer);
      remoteTimer = null;
    }
  };

  const doPush = (canonical: string) => {
    if (!ready) return;
    const choice = selectPushBase(canonical, base, stale);
    if (!choice) return;
    stale = null;
    let pending = choice.base.pending;
    const docText = ytext.toString();
    if (applyDelta(choice.base.text, pending) !== docText) {
      // Bookkeeping drifted from the doc; a fresh diff is the honest base.
      pending = fineDiff(choice.base.text, docText);
    }
    const local = deltaFromTextDelta(choice.local);
    ydoc.transact(() => {
      ydoc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, false);
      writeDelta(transformDelta(local, pending, false));
    }, origin);
    base = { text: canonical, pending: transformDelta(pending, local, true) };
    shadow = ytext.toString();
    if (base.pending.length > 0) {
      remotePending = true;
      scheduleApply();
    }
  };

  const flush = () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (pendingPush !== null) {
      const canonical = pendingPush;
      pendingPush = null;
      doPush(canonical);
    }
  };

  const schedule = (canonical: string) => {
    lastLocalInputAt = Date.now();
    pendingPush = canonical;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      flush();
    }, PUSH_DEBOUNCE_MS);
  };

  // iOS can suspend or kill the app from inactive or background without another JS turn, so text
  // still waiting for the debounce goes into the document, its device copy and the transport now.
  const lifecycle = AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") flush();
  });

  const applyNow = () => {
    clearRemoteTimer();
    if (!remotePending || cancelled) return;
    // Commit in-flight keystrokes before reading the merged doc, so the
    // rebuild below cannot silently drop them.
    flush();
    clearRemoteTimer();
    remotePending = false;
    const previous = base;
    const merged = ytext.toString();
    base = { text: merged, pending: [] };
    if (merged === callbacks.getLocalCanonical()) {
      stale = null;
      return;
    }
    stale = previous;
    callbacks.applyRemote(merged, (index) => transformIndex(index, previous.pending, true));
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
      if (callbacks.isComposing?.()) {
        armApply(COMPOSITION_RECHECK_MS);
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
    if (event.transaction.origin === origin) {
      shadow = ytext.toString();
      return;
    }
    const current = ytext.toString();
    let remote = refineDelta(deltaFromYjs(event.delta), shadow);
    if (applyDelta(shadow, remote) !== current) remote = fineDiff(shadow, current);
    shadow = current;
    base = { text: base.text, pending: composeDeltas(base.pending, remote) };
    if (stale) stale = { text: stale.text, pending: composeDeltas(stale.pending, remote) };
    remotePending = true;
    scheduleApply();
  };

  void opts.whenSynced.then(() => {
    if (cancelled) return;
    const serverText = ytext.toString();
    const local = callbacks.getLocalCanonical();
    const loaded = callbacks.getLoadedCanonical();
    ready = true;
    shadow = serverText;
    ytext.observe(observer);
    observing = true;
    if (loaded !== null && local !== loaded) {
      // The user typed before the handshake finished. Diff against the
      // RPC-loaded base their input actually grew from - seeding from the
      // server text would turn every character a peer added since that
      // load into a local delete and broadcast it.
      base = { text: loaded, pending: fineDiff(loaded, serverText) };
      doPush(local);
    } else {
      base = { text: serverText, pending: [] };
      if (serverText !== local) {
        const fromLocal = fineDiff(local, serverText);
        callbacks.applyRemote(serverText, (index) => transformIndex(index, fromLocal, true));
      }
    }
    opts.onLive(local === serverText || (loaded !== null && local !== loaded));
  });

  const dispose = () => {
    cancelled = true;
    lifecycle.remove();
    if (observing) ytext.unobserve(observer);
    clearRemoteTimer();
    // The pre-detach hook already flushed while the doc was live; this
    // covers effect re-runs where the session survives.
    flush();
  };

  return { schedule, flush, applyNow, dispose, getInputBase: () => (ready ? base.text : null) };
}
