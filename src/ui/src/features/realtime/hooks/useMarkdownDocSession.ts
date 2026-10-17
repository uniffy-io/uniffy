import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { ySyncPluginKey } from "y-prosemirror";
import { useAppSelector } from "@/app/hooks";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import { docNameFor } from "@/features/realtime/docNames";
import { useDocSession } from "@/features/realtime/hooks/useDocSession";
import { PROSEMIRROR_FRAGMENT_FIELD } from "@/features/realtime/markdown";
import type { RealtimeStatus } from "@/features/realtime/protocol";
import type { CrepeRealtimeBinding } from "@/components/editor/CrepeEditor";

interface MarkdownDocSessionOptions {
  contentType: string;
  contentId: string | null;
  enabled: boolean;
  canEdit?: boolean;
  /** See `UseDocSessionOptions.discardLocalOnCleanClose`. */
  discardLocalOnCleanClose?: boolean;
  /** See `UseDocSessionOptions.onGenerationReset`. */
  onGenerationReset?: (info: { hasLocalEdits: boolean }) => void;
}

export function useMarkdownDocSession({
  contentType,
  contentId,
  enabled,
  canEdit = true,
  discardLocalOnCleanClose = false,
  onGenerationReset,
}: MarkdownDocSessionOptions): {
  binding: CrepeRealtimeBinding | null;
  status: RealtimeStatus;
  docName: string | null;
  generationResets: number;
} {
  const session = useDocSession({
    contentType,
    contentId,
    enabled: enabled && Boolean(contentId),
    discardLocalOnCleanClose,
    onGenerationReset,
  });
  const user = useAppSelector((state) => state.auth.user);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);
  const docName = contentId ? docNameFor(contentType, contentId) : null;
  const ydoc = session?.ydoc;
  const awareness = session?.awareness;
  const sessionId = session?.sessionId;

  // The server closes read-only sockets on any SYNC write frame; the flag makes
  // the multiplexer suppress them, IDB hydration replays included.
  useEffect(() => {
    if (!ydoc || !docName) return;
    realtimeMultiplexer.setDocReadOnly(docName, !canEdit);
  }, [ydoc, docName, canEdit]);

  useEffect(() => {
    if (!ydoc || !sessionId || !canEdit) return;
    const manager = new Y.UndoManager([ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment)], {
      trackedOrigins: new Set([sessionId, ySyncPluginKey]),
      captureTimeout: 500,
    });
    // Publish effect-owned Yjs resource.
    // eslint-disable-next-line react/react-compiler
    setUndoManager(manager);
    return () => {
      manager.destroy();
      setUndoManager(null);
    };
  }, [ydoc, sessionId, canEdit]);

  // Identity lives in its own effect so an avatar or name change never rebuilds the
  // UndoManager, which would drop the undo history.
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField("user", {
      id: user?.id ?? null,
      name: user?.fullName ?? user?.username ?? "Anonymous",
      avatarUrl: user?.avatarUrl ?? null,
      hasAvatar: user?.hasAvatar ?? false,
    });
  }, [awareness, user?.id, user?.fullName, user?.username, user?.hasAvatar, user?.avatarUrl]);

  const binding = useMemo<CrepeRealtimeBinding | null>(() => {
    if (!session) return null;
    return {
      ydoc: session.ydoc,
      awareness: session.awareness,
      undoManager,
      sessionId: session.sessionId,
      fragmentSeeder: session.fragmentSeeder,
      whenSynced: session.whenSynced,
    };
  }, [session, undoManager]);
  return {
    binding,
    status: session?.status ?? "idle",
    docName,
    generationResets: session?.generationResets ?? 0,
  };
}
