import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { notesApi } from "@/api/notesApi";

export function useCreateNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { title: string; content: string }) =>
      notesApi.createNote({
        organizationId: organizationId!,
        title: args.title,
        content: args.content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export function useUpdateNote() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { noteId: string; title?: string; content?: string }) =>
      notesApi.updateNote({
        noteId: args.noteId,
        organizationId: organizationId!,
        title: args.title,
        content: args.content,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["note", organizationId, variables.noteId] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
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
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      if (noteId) {
        queryClient.invalidateQueries({ queryKey: ["note", orgId, noteId] });
      }
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

  // Cleanup on unmount: flush pending autosave
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { scheduleAutosave, flush, isSaving, lastSaved };
}
