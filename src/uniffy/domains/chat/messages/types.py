"""Chat message mutation vocabulary."""

from enum import StrEnum


class ChatMessageAction(StrEnum):
    EDIT = "edit"
    DELETE = "delete"
    PIN = "pin"
