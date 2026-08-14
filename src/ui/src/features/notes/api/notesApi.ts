import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  NotesService,
  CopyNoteRequestSchema,
  CreateNoteRequestSchema,
  DeleteNoteRequestSchema,
  EmptyTrashRequestSchema,
  GetBacklinksRequestSchema,
  GetNoteRequestSchema,
  ListNotesRequestSchema,
  MoveNoteRequestSchema,
  RestoreNoteRequestSchema,
  SearchNotesRequestSchema,
  UpdateNoteRequestSchema,
} from "@uniffy/proto/notes/v1/notes_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const notesClient = createClient(NotesService, unaryTransport);

export const notesApi = {
  createNote: async (request: MessageInitShape<typeof CreateNoteRequestSchema>) => {
    return notesClient.createNote(request);
  },

  getNote: async (request: MessageInitShape<typeof GetNoteRequestSchema>) => {
    return notesClient.getNote(request);
  },

  updateNote: async (request: MessageInitShape<typeof UpdateNoteRequestSchema>) => {
    return notesClient.updateNote(request);
  },

  deleteNote: async (request: MessageInitShape<typeof DeleteNoteRequestSchema>) => {
    return notesClient.deleteNote(request);
  },

  listNotes: async (request: MessageInitShape<typeof ListNotesRequestSchema>) => {
    return notesClient.listNotes(request);
  },

  searchNotes: async (request: MessageInitShape<typeof SearchNotesRequestSchema>) => {
    return notesClient.searchNotes(request);
  },

  getBacklinks: async (request: MessageInitShape<typeof GetBacklinksRequestSchema>) => {
    return notesClient.getBacklinks(request);
  },

  restoreNote: async (request: MessageInitShape<typeof RestoreNoteRequestSchema>) => {
    return notesClient.restoreNote(request);
  },

  moveNote: async (request: MessageInitShape<typeof MoveNoteRequestSchema>) => {
    return notesClient.moveNote(request);
  },

  copyNote: async (request: MessageInitShape<typeof CopyNoteRequestSchema>) => {
    return notesClient.copyNote(request);
  },

  emptyTrash: async (request: MessageInitShape<typeof EmptyTrashRequestSchema>) => {
    return notesClient.emptyTrash(request);
  },
};
