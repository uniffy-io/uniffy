"""
Shared enums and types used across all UNIFFY modules.

This module centralizes all enum definitions to ensure consistency
across domains and avoid circular imports.
"""

import re
from enum import Enum
from uuid import uuid7

# Central ID generator for all models. Using UUIDv7 (time-ordered, RFC 9562).
# Change this single binding if the ID generation strategy ever changes.
generate_id = uuid7


class VisibilityScope(str, Enum):
    """
    Visibility scope for content items.

    Defines who can access a piece of content within an organization.

    Attributes
    ----------
    PRIVATE : str
        Personal space - only the owner can access.
    GROUP : str
        Group space - accessible to members of associated group(s).
    ORGANIZATION : str
        Organization space - accessible to all members of the organization.
    PUBLIC : str
        Public - accessible to anyone (for future external sharing features).

    """

    PRIVATE = "PRIVATE"
    GROUP = "GROUP"
    ORGANIZATION = "ORGANIZATION"
    PUBLIC = "PUBLIC"


class PermissionLevel(str, Enum):
    """
    Permission levels for content access.

    Defines what actions a user can perform on a piece of content.

    Attributes
    ----------
    VIEW : str
        Can view content but not modify it.
    EDIT : str
        Can view and edit content but not delete or share.
    ADMIN : str
        Can view, edit, delete, and share content.
    OWNER : str
        Full control including transfer of ownership.

    """

    VIEW = "VIEW"
    EDIT = "EDIT"
    ADMIN = "ADMIN"
    OWNER = "OWNER"


class NodeType(str, Enum):
    """
    Node type for notes hierarchy.

    Defines the type of a note in the hierarchy.

    Attributes
    ----------
    NOTE : str
        Regular note with content.
    FOLDER : str
        Folder for organizing notes (can also have content).
    TEMPLATE : str
        Template note for creating new notes (future use).

    """

    NOTE = "NOTE"
    FOLDER = "FOLDER"
    TEMPLATE = "TEMPLATE"


class ContentType(str, Enum):
    """
    Types of content in the system.

    Used for polymorphic references in permission tables.

    Attributes
    ----------
    NOTE : str
        Notes/documents.
    FILE : str
        Files (uploaded documents, images, etc.).
    FOLDER : str
        Folders for organizing files.
    CALENDAR_EVENT : str
        Calendar events.
    CHAT_MESSAGE : str
        Chat messages.
    USER : str
        User profiles (for @mentions and references).
    PROJECT : str
        Projects (task containers).
    TASK : str
        Tasks (individual work items within projects).

    """

    NOTE = "NOTE"
    FILE = "FILE"
    FOLDER = "FOLDER"
    CALENDAR_EVENT = "CALENDAR_EVENT"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    USER = "USER"
    PROJECT = "PROJECT"
    TASK = "TASK"
    AGENT = "AGENT"
    PROVIDER_KEY = "PROVIDER_KEY"
    PROMPT = "PROMPT"
    AGENT_CRON_TASK = "AGENT_CRON_TASK"


class SubjectType(str, Enum):
    """
    Types of subjects that can have permissions.

    Used to identify who or what has access to content.

    Attributes
    ----------
    USER : str
        Individual user.
    GROUP : str
        Group of users.
    ORGANIZATION : str
        Entire organization.

    """

    USER = "USER"
    GROUP = "GROUP"
    ORGANIZATION = "ORGANIZATION"


def slugify(text: str, max_length: int = 500) -> str:
    """Convert text to a URL-friendly slug.

    Parameters
    ----------
    text : str
        Text to slugify.
    max_length : int
        Maximum length of the slug (default 500).

    Returns
    -------
    str
        Lowercase, hyphen-separated slug.

    """
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    return text.strip("-")[:max_length]
