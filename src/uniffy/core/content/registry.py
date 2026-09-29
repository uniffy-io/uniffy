"""Typed extension points shared by content domains and permission operations."""

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.types import AccessMode, ContentRole, ContentType

ContentLoader = Callable[[AsyncSession, UUID, UUID], Awaitable[object | None]]
AttachmentCascadeLoader = Callable[
    [AsyncSession, UUID, UUID],
    Awaitable[list[tuple[ContentType, UUID]]],
]
ManageOverride = Callable[[AsyncSession, UUID, UUID], Awaitable[bool]]
OwnershipTransferHook = Callable[[AsyncSession, UUID, UUID, UUID], Awaitable[None]]
ChildAclRefreshRecorder = Callable[[AsyncSession, UUID, UUID], Awaitable[None]]
ChildAclRefreshEnqueuer = Callable[[UUID], Awaitable[None]]
# (session, actor_user_id, organization_id, content, new_access_mode, new_baseline_role);
# raises to refuse the change before anything is written.
AccessModeGuard = Callable[
    [AsyncSession, UUID, UUID, object, AccessMode | None, ContentRole | None],
    Awaitable[None],
]
# (session, actor_user_id, organization_id, content) -> the actor's role on that item, for
# content whose access also derives from a container (an event through its calendar).
RoleResolver = Callable[[AsyncSession, UUID, UUID, object], Awaitable[ContentRole | None]]
# (session, organization_id, content, new_owner_user_id); raises to refuse the transfer.
TransferGuard = Callable[[AsyncSession, UUID, object, UUID], Awaitable[None]]

_content_loaders: dict[ContentType, ContentLoader] = {}
_attachment_cascade_loaders: dict[ContentType, list[AttachmentCascadeLoader]] = {}
_manage_overrides: dict[ContentType, ManageOverride] = {}
_ownership_transfer_hooks: dict[ContentType, OwnershipTransferHook] = {}
_access_mode_guards: dict[ContentType, AccessModeGuard] = {}
_transfer_guards: dict[ContentType, TransferGuard] = {}
_role_resolvers: dict[ContentType, RoleResolver] = {}
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


def register_role_resolver(content_type: ContentType, resolver: RoleResolver) -> None:
    _role_resolvers[content_type] = resolver


def find_role_resolver(content_type: ContentType) -> RoleResolver | None:
    return _role_resolvers.get(content_type)


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


def register_access_mode_guard(content_type: ContentType, guard: AccessModeGuard) -> None:
    _access_mode_guards[content_type] = guard


def find_access_mode_guard(content_type: ContentType) -> AccessModeGuard | None:
    return _access_mode_guards.get(content_type)


def register_transfer_guard(content_type: ContentType, guard: TransferGuard) -> None:
    _transfer_guards[content_type] = guard


def find_transfer_guard(content_type: ContentType) -> TransferGuard | None:
    return _transfer_guards.get(content_type)
