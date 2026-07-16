import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { notesApi } from "@features/notes/notesApi";
import { bookmarksApi } from "@features/bookmarks/bookmarksApi";
import { noteToPlain, formatRelativeTime, stripMarkdown } from "@features/notes/noteSerializer";
import type { SerializedNote } from "@features/notes/noteSerializer";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

export type NoteListItem = SerializedNote & {
  snippet: string;
  editedAt: string;
  refCount: number;
};

function deriveListItem(note: SerializedNote): NoteListItem {
  const snippet = stripMarkdown(note.content || "").slice(0, 120);

  const editedAt = note.updatedAt ? formatRelativeTime(note.updatedAt.seconds) : "just now";

  return {
    ...note,
    snippet,
    editedAt,
    refCount: note.outgoingReferences.length,
  };
}

export function useNotesList(filter: string) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["notes", organizationId, filter],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        organizationId: organizationId!,
        pageSize: 20,
        sortBy: "updated_at",
        sortOrder: "desc",
      };

      if (filter === "Recent") {
        params.sortBy = "updated_at";
      } else if (filter === "Shared") {
        params.accessMode = AccessMode.OPEN_TO_ORG;
      }

      const response = await notesApi.listNotes(params);
      const notes = response.notes.map((n) => deriveListItem(noteToPlain(n)));

      if (filter === "Favorites") {
        const bookmarksResponse = await bookmarksApi.listBookmarks({
          organizationId: organizationId!,
        });
        const bookmarkedUrns = new Set(bookmarksResponse.bookmarks.map((b) => b.urn));
        return notes.filter((n) => bookmarkedUrns.has(`urn:uniffy:content:NOTE:${n.id}`));
      }

      return notes;
    },
    enabled: !!organizationId,
  });
}

export function useNote(noteId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["note", organizationId, noteId],
    queryFn: async () => {
      const response = await notesApi.getNote({
        noteId: noteId!,
        organizationId: organizationId!,
      });
      if (!response.note) throw new Error("Note not found");
      return noteToPlain(response.note);
    },
    enabled: !!organizationId && !!noteId,
  });
}

export function useNoteBacklinks(noteId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["note-backlinks", organizationId, noteId],
    queryFn: async () => {
      const response = await notesApi.getBacklinks({
        noteId: noteId!,
        organizationId: organizationId!,
      });
      return response.backlinks.map((bl) => ({
        id: bl.id,
        title: bl.title,
        slug: bl.slug,
      }));
    },
    enabled: !!organizationId && !!noteId,
  });
}
