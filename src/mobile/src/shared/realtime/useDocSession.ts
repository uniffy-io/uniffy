import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@core/providers/AuthContext";
import {
  DETACHED_SESSION_SNAPSHOT,
  openDocSession,
  type DocSession,
  type DocSessionHandle,
  type DocSessionSnapshot,
} from "@shared/realtime/docSession";

export interface DocSessionState extends DocSessionSnapshot {
  session: DocSession | null;
  discardRecoveredDraft: (id: string) => Promise<void>;
  trackDraftWrite: (write: Promise<void>) => Promise<boolean>;
  persistLocally: () => Promise<boolean>;
}

export interface UseDocSessionOptions {
  contentType: string;
  contentId: string | null | undefined;
  enabled: boolean;
  /** Suppresses every write frame, which the server refuses from a viewer anyway. */
  readOnly?: boolean;
  /**
   * Runs at the top of the detach cleanup, while the doc and the multiplexer
   * update handler are still live. Bindings flush pending local edits here -
   * their own effect cleanup runs AFTER this one (React destroys effects in
   * declaration order), which is too late for the edit to ship.
   */
  onBeforeDetach?: () => void;
}

const subscribeDetached = () => () => {};
const detachedSnapshot = () => DETACHED_SESSION_SNAPSHOT;

export function useDocSession(opts: UseDocSessionOptions): DocSessionState {
  const { contentType, contentId, enabled, readOnly } = opts;
  const { organizationId, user } = useAuth();
  const userId = user?.id;

  const [handle, setHandle] = useState<DocSessionHandle | null>(null);
  const [reset, setReset] = useState(0);
  // Content stays in the organization it was first opened in. After a switch or a lost grant the
  // screen can still name it for a moment, and attaching it under the new organization would
  // keep its edits there.
  const openedIn = useRef<{ contentId: string; organizationId: string } | null>(null);

  const beforeDetachRef = useRef(opts.onBeforeDetach);
  useEffect(() => {
    beforeDetachRef.current = opts.onBeforeDetach;
  });

  useEffect(() => {
    if (!enabled || !contentId || !organizationId || !userId) return;
    const loadedIn = openedIn.current;
    if (loadedIn?.contentId === contentId && loadedIn.organizationId !== organizationId) return;
    openedIn.current = { contentId, organizationId };
    const opened = openDocSession({
      contentType,
      contentId,
      organizationId,
      userId,
      readOnly,
      onGenerationMismatch: () => setReset((value) => value + 1),
    });
    if (!opened) return;
    // The handle can only exist after the attach side effect succeeds; there
    // is nothing to derive during render.
    // eslint-disable-next-line react/react-compiler
    setHandle(opened);
    return () => {
      beforeDetachRef.current?.();
      void opened.close();
      setHandle(null);
    };
  }, [enabled, contentType, contentId, organizationId, userId, readOnly, reset]);

  const snapshot = useSyncExternalStore(
    handle?.subscribe ?? subscribeDetached,
    handle?.getSnapshot ?? detachedSnapshot,
  );

  const discardRecoveredDraft = useCallback(
    async (id: string) => {
      await handle?.discardRecoveredDraft(id);
    },
    [handle],
  );
  const trackDraftWrite = useCallback(
    (write: Promise<void>) =>
      handle?.trackDraftWrite(write) ??
      write.then(
        () => true,
        () => false,
      ),
    [handle],
  );
  const persistLocally = useCallback(
    () => handle?.persistLocally() ?? Promise.resolve(true),
    [handle],
  );

  return {
    ...snapshot,
    session: handle?.session ?? null,
    discardRecoveredDraft,
    trackDraftWrite,
    persistLocally,
  };
}
