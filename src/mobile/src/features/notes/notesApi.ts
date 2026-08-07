import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  NotesService,
  CreateNoteRequestSchema,
  DeleteNoteRequestSchema,
  EmptyTrashRequestSchema,
  GetBacklinksRequestSchema,
  GetNoteRequestSchema,
  ListNotesRequestSchema,
  MoveNoteRequestSchema,
  RestoreNoteRequestSchema,
  UpdateNoteRequestSchema,
} from "@uniffy/proto/notes/v1/notes_pb";
import { transport } from "@core/api/transport";

const client = createClient(NotesService, transport);

export const notesApi = {
  listNotes: (request: MessageInitShape<typeof ListNotesRequestSchema>) =>
    client.listNotes(request),

  getNote: (request: MessageInitShape<typeof GetNoteRequestSchema>) => client.getNote(request),

  createNote: (request: MessageInitShape<typeof CreateNoteRequestSchema>) =>
    client.createNote(request),

  updateNote: (request: MessageInitShape<typeof UpdateNoteRequestSchema>) =>
    client.updateNote(request),

  deleteNote: (request: MessageInitShape<typeof DeleteNoteRequestSchema>) =>
    client.deleteNote(request),

  getBacklinks: (request: MessageInitShape<typeof GetBacklinksRequestSchema>) =>
    client.getBacklinks(request),

  restoreNote: (request: MessageInitShape<typeof RestoreNoteRequestSchema>) =>
    client.restoreNote(request),

  emptyTrash: (request: MessageInitShape<typeof EmptyTrashRequestSchema>) =>
    client.emptyTrash(request),

  moveNote: (request: MessageInitShape<typeof MoveNoteRequestSchema>) => client.moveNote(request),
};
