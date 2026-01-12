"""
Notes domain - note management with permissions and search.

This domain handles:
- Note CRUD operations with permission checking
- Full-text search within notes
- Backlinks and wiki-link tracking
- Hierarchical organization (folders)
"""

from uwos.domains.notes.converters import note_to_proto, note_to_reference
from uwos.domains.notes.handlers import NotesHandlers
from uwos.domains.notes.operations import NoteOperations
from uwos.domains.notes.service import NotesServiceImpl

__all__ = [
    "NoteOperations",
    "NotesHandlers",
    "NotesServiceImpl",
    "note_to_proto",
    "note_to_reference",
]
