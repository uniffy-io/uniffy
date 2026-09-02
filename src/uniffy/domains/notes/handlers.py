"""Notes RPC handler surface."""

from uniffy.domains.notes.rpc.mutations import NoteMutationHandlers
from uniffy.domains.notes.rpc.queries import NoteQueryHandlers
from uniffy.domains.notes.rpc.support import parse_canvas_content as _parse_canvas_content


class NotesHandlers(NoteMutationHandlers, NoteQueryHandlers):
    """RPC surface assembled from mutation and query handlers."""


__all__ = ["NotesHandlers", "_parse_canvas_content"]
