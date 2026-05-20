"""
Notes domain - note management with permissions and search.

This domain handles:
- Note CRUD operations with permission checking
- Full-text search within notes
- Backlinks and wiki-link tracking
- Hierarchical organization (folders)
"""

import uniffy.domains.notes.realtime_adapter  # noqa: F401 - registers NoteRealtimeAdapter on import
from uniffy.domains.notes.converters import note_to_proto, note_to_reference
from uniffy.domains.notes.handlers import NotesHandlers
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notes.service import NotesServiceImpl

__all__ = [
    "NoteOperations",
    "NotesHandlers",
    "NotesServiceImpl",
    "note_to_proto",
    "note_to_reference",
]
