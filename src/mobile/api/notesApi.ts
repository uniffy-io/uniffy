import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { NotesService, AutosaveNoteRequestSchema, CreateNoteRequestSchema, DeleteNoteRequestSchema, GetBacklinksRequestSchema, GetNoteRequestSchema, ListNotesRequestSchema, UpdateNoteRequestSchema } from "@uniffy/proto/notes/v1/notes_pb";
import { transport } from "@/lib/transport";

const client = createClient(NotesService, transport);

export const notesApi = {
  listNotes: (request: MessageInitShape<typeof ListNotesRequestSchema>) => client.listNotes(request),

  getNote: (request: MessageInitShape<typeof GetNoteRequestSchema>) => client.getNote(request),

  createNote: (request: MessageInitShape<typeof CreateNoteRequestSchema>) => client.createNote(request),

  updateNote: (request: MessageInitShape<typeof UpdateNoteRequestSchema>) => client.updateNote(request),

  deleteNote: (request: MessageInitShape<typeof DeleteNoteRequestSchema>) => client.deleteNote(request),

  autosaveNote: (request: MessageInitShape<typeof AutosaveNoteRequestSchema>) => client.autosaveNote(request),

  getBacklinks: (request: MessageInitShape<typeof GetBacklinksRequestSchema>) => client.getBacklinks(request),
};
