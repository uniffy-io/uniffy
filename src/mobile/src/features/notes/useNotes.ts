import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { notesApi } from "@features/notes/notesApi";
import { bookmarksApi } from "@features/bookmarks/bookmarksApi";
import { noteToPlain, formatRelativeTime, stripMarkdown } from "@features/notes/noteSerializer";
import type { SerializedNote } from "@features/notes/noteSerializer";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";

export type NoteListItem = SerializedNote & {
  snippet: string;
  editedAt: string;
  refCount: number;
};

function deriveListItem(note: SerializedNote): NoteListItem {
  // A canvas keeps board JSON in `content`; running it through stripMarkdown
  // spills raw JSON into the snippet.
  const isCanvas = note.nodeType === NodeType.CANVAS;
  const snippet = isCanvas ? "" : stripMarkdown(note.content || "").slice(0, 120);

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
      // ListNotes has no node-type filter, and a folder is structure rather
      // than content - it has no business in a recency list.
      const notes = response.notes
        .map((n) => deriveListItem(noteToPlain(n)))
        .filter((n) => n.nodeType !== NodeType.FOLDER);

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

const TRASH_PAGE_SIZE = 100;
const TRASH_MAX_PAGES = 10;

// ListNotes has no deleted-only filter: `includeDeleted` widens the set rather
// than narrowing it, so the trash has to be sieved out of the full list. A
// single page would hide deleted notes behind live ones, hence the paging loop.
export function useNotesTrash() {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["notes-trash", organizationId],
    queryFn: async () => {
      const deleted: SerializedNote[] = [];
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages && page <= TRASH_MAX_PAGES) {
        const response = await notesApi.listNotes({
          organizationId: organizationId!,
          page,
          pageSize: TRASH_PAGE_SIZE,
          includeDeleted: true,
          excludeContent: true,
          sortBy: "updated_at",
          sortOrder: "desc",
        });
        totalPages = response.totalPages;
        for (const note of response.notes) {
          const plain = noteToPlain(note);
          if (plain.isDeleted) deleted.push(plain);
        }
        page++;
      }

      return deleted;
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
