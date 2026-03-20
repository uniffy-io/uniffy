import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { NotesService } from "@uniffy/proto/notes/v1/notes_connect";
import type {
  ListNotesRequest,
  GetNoteRequest,
  CreateNoteRequest,
  UpdateNoteRequest,
  DeleteNoteRequest,
  AutosaveNoteRequest,
  GetBacklinksRequest,
} from "@uniffy/proto/notes/v1/notes_pb";
import { transport } from "@/lib/transport";

const client = createClient(NotesService, transport);

export const notesApi = {
  listNotes: (request: PartialMessage<ListNotesRequest>) => client.listNotes(request),

  getNote: (request: PartialMessage<GetNoteRequest>) => client.getNote(request),

  createNote: (request: PartialMessage<CreateNoteRequest>) => client.createNote(request),

  updateNote: (request: PartialMessage<UpdateNoteRequest>) => client.updateNote(request),

  deleteNote: (request: PartialMessage<DeleteNoteRequest>) => client.deleteNote(request),

  autosaveNote: (request: PartialMessage<AutosaveNoteRequest>) => client.autosaveNote(request),

  getBacklinks: (request: PartialMessage<GetBacklinksRequest>) => client.getBacklinks(request),
};
