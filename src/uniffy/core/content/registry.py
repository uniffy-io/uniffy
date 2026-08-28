"""Typed extension points shared by content domains and permission operations."""

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.types import ContentType

ContentLoader = Callable[[AsyncSession, UUID, UUID], Awaitable[object | None]]
AttachmentCascadeLoader = Callable[
    [AsyncSession, UUID, UUID],
    Awaitable[list[tuple[ContentType, UUID]]],
]
ManageOverride = Callable[[AsyncSession, UUID, UUID], Awaitable[bool]]
OwnershipTransferHook = Callable[[AsyncSession, UUID, UUID, UUID], Awaitable[None]]
ChildAclRefreshRecorder = Callable[[AsyncSession, UUID, UUID], Awaitable[None]]
ChildAclRefreshEnqueuer = Callable[[UUID], Awaitable[None]]

_content_loaders: dict[ContentType, ContentLoader] = {}
_attachment_cascade_loaders: dict[ContentType, list[AttachmentCascadeLoader]] = {}
_manage_overrides: dict[ContentType, ManageOverride] = {}
_ownership_transfer_hooks: dict[ContentType, OwnershipTransferHook] = {}
_child_acl_refresh_hooks: dict[
    ContentType,
    tuple[ChildAclRefreshRecorder, ChildAclRefreshEnqueuer],
] = {}


def register_content_loader(content_type: ContentType, loader: ContentLoader) -> None:
    _content_loaders[content_type] = loader


def find_content_loader(content_type: ContentType) -> ContentLoader | None:
    return _content_loaders.get(content_type)


def get_content_loader(content_type: ContentType) -> ContentLoader:
    loader = find_content_loader(content_type)
    if loader is None:
        raise ValidationError(
            "content_type",
            f"No content loader registered for {content_type.value}",
        )
    return loader


def register_attachment_cascade_loader(
    parent_type: ContentType,
    loader: AttachmentCascadeLoader,
) -> None:
    _attachment_cascade_loaders.setdefault(parent_type, []).append(loader)


def attachment_cascade_loaders(
    parent_type: ContentType,
) -> tuple[AttachmentCascadeLoader, ...]:
    return tuple(_attachment_cascade_loaders.get(parent_type, ()))


def register_manage_override(content_type: ContentType, check: ManageOverride) -> None:
    _manage_overrides[content_type] = check


def find_manage_override(content_type: ContentType) -> ManageOverride | None:
    return _manage_overrides.get(content_type)


def register_ownership_transfer_hook(
    content_type: ContentType,
    hook: OwnershipTransferHook,
) -> None:
    _ownership_transfer_hooks[content_type] = hook


def find_ownership_transfer_hook(
    content_type: ContentType,
) -> OwnershipTransferHook | None:
    return _ownership_transfer_hooks.get(content_type)


def register_child_acl_refresh_hook(
    content_type: ContentType,
    recorder: ChildAclRefreshRecorder,
    enqueuer: ChildAclRefreshEnqueuer,
) -> None:
    _child_acl_refresh_hooks[content_type] = (recorder, enqueuer)


def find_child_acl_refresh_hook(
    content_type: ContentType,
) -> tuple[ChildAclRefreshRecorder, ChildAclRefreshEnqueuer] | None:
    return _child_acl_refresh_hooks.get(content_type)
