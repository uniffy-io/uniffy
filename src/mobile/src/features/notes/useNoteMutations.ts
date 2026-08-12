import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { notesApi } from "@features/notes/notesApi";
import type { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import type { NodeType } from "@uniffy/proto/notes/v1/notes_pb";

// The tree, graph and trash queries are keyed on their own prefixes, which do
// not start with "notes", so a single invalidate never reaches them. Every
// structural mutation (create, delete, restore, move, empty-trash) goes
// through here to keep all of them in step.
function invalidateNoteQueries(queryClient: QueryClient, orgId: string | null, noteId?: string) {
  queryClient.invalidateQueries({ queryKey: ["notes"] });
  queryClient.invalidateQueries({ queryKey: ["notes-tree"] });
  queryClient.invalidateQueries({ queryKey: ["notes-graph"] });
  queryClient.invalidateQueries({ queryKey: ["notes-trash"] });
  if (noteId) {
    queryClient.invalidateQueries({ queryKey: ["note", orgId, noteId] });
    queryClient.invalidateQueries({ queryKey: ["note-backlinks", orgId, noteId] });
  }
}

// Content and metadata saves fire at typing cadence (1s title debounce, 2s
// autosave). The list-shaped queries stay mounted beneath the editor, so a
// full invalidate would refetch the 500-note tree per save; mark them stale
// and let their next mount/focus refetch instead. The note itself refreshes
// immediately.
function invalidateNoteSave(queryClient: QueryClient, orgId: string | null, noteId: string) {
  queryClient.invalidateQueries({ queryKey: ["note", orgId, noteId] });
  queryClient.invalidateQueries({ queryKey: ["note-backlinks", orgId, noteId] });
  queryClient.invalidateQueries({ queryKey: ["notes"], refetchType: "none" });
  queryClient.invalidateQueries({ queryKey: ["notes-tree"], refetchType: "none" });
  queryClient.invalidateQueries({ queryKey: ["notes-graph"], refetchType: "none" });
}

export function useCreateNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      title: string;
      content: string;
      parentId?: string;
      accessMode?: AccessMode;
      nodeType?: NodeType;
    }) =>
      notesApi.createNote({
        organizationId: organizationId!,
        title: args.title,
        content: args.content,
        parentId: args.parentId,
        accessMode: args.accessMode,
        nodeType: args.nodeType,
      }),
    onSuccess: (data) => {
      invalidateNoteQueries(queryClient, organizationId, data.note?.id);
    },
  });
}

export function useUpdateNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      noteId: string;
      title?: string;
      content?: string;
      /** Empty string detaches the note from its folder. */
      parentId?: string;
      /** Replacement set. Omit to leave tags untouched, [] to clear them. */
      tagIds?: string[];
      icon?: { iconType: string; value: string };
    }) =>
      notesApi.updateNote({
        noteId: args.noteId,
        organizationId: organizationId!,
        title: args.title,
        content: args.content,
        parentId: args.parentId,
        tagIds: args.tagIds !== undefined ? { ids: args.tagIds } : undefined,
        icon: args.icon,
      }),
    onSuccess: (_data, variables) => {
      // Reparenting reshapes the tree; a title/content/tag/icon save does not.
      if (variables.parentId !== undefined) {
        invalidateNoteQueries(queryClient, organizationId, variables.noteId);
      } else {
        invalidateNoteSave(queryClient, organizationId, variables.noteId);
      }
    },
  });
}

export function useDeleteNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) =>
      notesApi.deleteNote({
        noteId,
        organizationId: organizationId!,
      }),
    onSuccess: (_data, noteId) => {
      invalidateNoteQueries(queryClient, organizationId, noteId);
    },
  });
}

export function useRestoreNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) =>
      notesApi.restoreNote({ noteId, organizationId: organizationId! }),
    onSuccess: (_data, noteId) => {
      invalidateNoteQueries(queryClient, organizationId, noteId);
    },
  });
}

export function useEmptyNotesTrash() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notesApi.emptyTrash({ organizationId: organizationId! }),
    onSuccess: () => {
      invalidateNoteQueries(queryClient, organizationId);
    },
  });
}

// A move can change the space, the parent folder, or both. Access mode lives on
// MoveNote and the parent on UpdateNote, so a cross-space move into a folder is
// two calls in that order - reparenting first would briefly place the note in a
// folder it has no business being in.
export function useMoveNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      noteId: string;
      targetAccessMode?: AccessMode;
      parentId?: string;
    }) => {
      if (args.targetAccessMode !== undefined) {
        await notesApi.moveNote({
          noteId: args.noteId,
          organizationId: organizationId!,
          targetAccessMode: args.targetAccessMode,
        });
      }
      if (args.parentId !== undefined) {
        await notesApi.updateNote({
          noteId: args.noteId,
          organizationId: organizationId!,
          parentId: args.parentId,
        });
      }
    },
    // A cross-space move is two calls; the first can succeed while the second
    // fails (e.g. the server refuses a cycle another client created). Settled
    // instead of success so the cache refreshes to whatever actually landed,
    // and the failure is surfaced instead of silently showing pre-move state.
    onSettled: (_data, error, variables) => {
      invalidateNoteQueries(queryClient, organizationId, variables.noteId);
      if (error) {
        Alert.alert("Move failed", "The item could not be moved. It may have changed elsewhere.");
      }
    },
  });
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

const AUTOSAVE_DELAY_MS = 2000;

export function useAutosave(noteId: string | undefined, orgId: string | null) {
  const queryClient = useQueryClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHashRef = useRef<number | null>(null);
  const pendingRef = useRef<{ content: string; title?: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (args: { content: string; title?: string }) =>
      notesApi.updateNote({
        noteId: noteId!,
        organizationId: orgId!,
        content: args.content,
        title: args.title,
      }),
    onSuccess: () => {
      setLastSaved(Date.now());
      if (noteId) invalidateNoteSave(queryClient, orgId, noteId);
    },
  });

  const performAutosave = useCallback(
    (content: string, title?: string) => {
      if (!noteId || !orgId) return;
      setIsSaving(true);
      mutation.mutate({ content, title }, { onSettled: () => setIsSaving(false) });
    },
    [noteId, orgId, mutation],
  );

  const scheduleAutosave = useCallback(
    (content: string, title?: string) => {
      if (!noteId || !orgId) return;

      const contentHash = hashString(content);
      if (lastHashRef.current !== null && contentHash === lastHashRef.current) {
        return;
      }
      lastHashRef.current = contentHash;
      pendingRef.current = { content, title };

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        performAutosave(content, title);
        pendingRef.current = null;
      }, AUTOSAVE_DELAY_MS);
    },
    [noteId, orgId, performAutosave],
  );

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingRef.current) {
      performAutosave(pendingRef.current.content, pendingRef.current.title);
      pendingRef.current = null;
    }
  }, [performAutosave]);

  // Drops the armed save without sending it. The editor calls this when the
  // realtime session takes over content; a stale full-document UpdateNote
  // firing after that would graft old text over newer CRDT edits.
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    pendingRef.current = null;
    lastHashRef.current = null;
  }, []);

  // Cleanup on unmount: flush pending autosave
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { scheduleAutosave, flush, cancel, isSaving, lastSaved };
}
