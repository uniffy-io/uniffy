"""File attachments: link files to content (notes, chat, events, tasks)."""

from uniffy.domains.files.attachments.handlers import AttachmentsHandlersMixin
from uniffy.domains.files.attachments.operations import AttachmentOperations

__all__ = ["AttachmentOperations", "AttachmentsHandlersMixin"]
