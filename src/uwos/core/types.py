"""
Shared enums and types used across all UWOS modules.

This module centralizes all enum definitions to ensure consistency
across domains and avoid circular imports.
"""

from enum import Enum


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
    CALENDAR_EVENT : str
        Calendar events.
    BOOK : str
        Books and reading materials.
    PASSWORD : str
        Password entries.
    WORKFLOW : str
        Automated workflows.
    CHAT_MESSAGE : str
        Chat messages.
    SPACE : str
        AI-powered spaces.
    USER : str
        User profiles (for @mentions and references).

    """

    NOTE = "NOTE"
    FILE = "FILE"
    CALENDAR_EVENT = "CALENDAR_EVENT"
    BOOK = "BOOK"
    PASSWORD = "PASSWORD"
    WORKFLOW = "WORKFLOW"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    SPACE = "SPACE"
    USER = "USER"


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
