"""Canonical CRUD for ``ContentMember`` rows and access-policy columns.

Polymorphic through a registered-loader pattern: each domain registers a
fetcher for its content type. Mutations enforce permissions, write to the
audit log, keep the search index in sync, and emit notifications.

This is the only place in the backend that mutates access-control state.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.cache import (
    invalidate_content as invalidate_perm_content,
)
from uniffy.core.auth.cache import (
    invalidate_role_for_user as invalidate_perm_role,
)
from uniffy.core.auth.permissions.audit import (
    record_access_mode_changed,
    record_baseline_role_changed,
    record_member_added,
    record_member_removed,
    record_member_role_changed,
    record_ownership_transferred,
)
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.auth.permissions.roles import (
    role_can_manage,
    role_can_transfer,
)
from uniffy.core.auth.permissions.visible_sets import (
    invalidate_visible_sets_for_org,
    invalidate_visible_sets_for_user,
)
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.realtime.publisher import publish_perm_change
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NotificationType,
    SubjectType,
)
from uniffy.core.valkey import publish_content_access_changed

logger = logger.bind(component="content.members")

# Loader returns the raw SQLModel row (bypassing permission checks). The row
# must expose id, organization_id, owner_id, access_mode, baseline_role columns.
ContentLoader = Callable[
    [AsyncSession, UUID, UUID],  # (session, organization_id, content_id)
    Awaitable[object | None],
]

_CONTENT_LOADERS: dict[ContentType, ContentLoader] = {}


# Returns every ``(content_type, content_id)`` whose attachments are affected
# by an access-mode change on the parent.
AttachmentCascadeLoader = Callable[
    [AsyncSession, UUID, UUID],  # (session, organization_id, parent_content_id)
    Awaitable[list[tuple[ContentType, UUID]]],
]

_attachment_cascade_loaders: dict[ContentType, list[AttachmentCascadeLoader]] = {}


def register_attachment_cascade_loader(
    parent_type: ContentType,
    loader: AttachmentCascadeLoader,
) -> None:
    """Multiple loaders may register per parent; results concatenate in order."""
    _attachment_cascade_loaders.setdefault(parent_type, []).append(loader)


def register_content_loader(content_type: ContentType, loader: ContentLoader) -> None:
    """Domains register at import time so this class can fetch rows generically."""
    _CONTENT_LOADERS[content_type] = loader


def find_content_loader(content_type: ContentType) -> ContentLoader | None:
    """Non-raising lookup for callers that treat an unregistered type as
    "cannot decide" rather than an error.
    """
    return _CONTENT_LOADERS.get(content_type)


# Domain-level management power (e.g. agents builders): grants MANAGE on rows of
# a content type without touching effective_role, so reads/lists/search stay
# unaffected. See permissions.md "Domain admin".
ManageOverride = Callable[
    [AsyncSession, UUID, UUID],  # (session, actor_user_id, organization_id)
    Awaitable[bool],
]

_manage_overrides: dict[ContentType, ManageOverride] = {}


def register_manage_override(content_type: ContentType, check: ManageOverride) -> None:
    _manage_overrides[content_type] = check


# Runs inside the ownership-transfer transaction, before its commit, so domain
# state tied to the owner (e.g. a cron task's execution identity) moves
# atomically with owner_id.
OwnershipTransferHook = Callable[
    [AsyncSession, UUID, UUID, UUID],  # (session, organization_id, content_id, new_owner_id)
    Awaitable[None],
]

_ownership_transfer_hooks: dict[ContentType, OwnershipTransferHook] = {}


def register_ownership_transfer_hook(
    content_type: ContentType,
    hook: OwnershipTransferHook,
) -> None:
    _ownership_transfer_hooks[content_type] = hook


def get_content_loader(content_type: ContentType) -> ContentLoader:
    loader = _CONTENT_LOADERS.get(content_type)
    if loader is None:
        raise ValidationError(
            "content_type",
            f"No content loader registered for {content_type.value}",
        )
    return loader


class ContentMembersOperations:
    """Generic CRUD for content members and access policies.

    Every mutation commits the row, the ``permissions.*`` audit event, the
    search-index sync, and the notification together.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permission_checker = PermissionChecker(session)
        self.search_indexer = SearchIndexer(session)

    async def _drop_perm_cache_for_member_change(
        self,
        *,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        role: ContentRole,
    ) -> None:
        """Drop perm-cache entries affected by a member mutation.

        USER + non-BLOCKED drops one key; BLOCKED grants and GROUP subjects wipe
        the whole content tag because the affected user set isn't enumerable
        cheaply.
        """
        if subject_type == SubjectType.USER and role != ContentRole.BLOCKED:
            await invalidate_perm_role(
                organization_id, subject_id, content_type, content_id
            )
            await invalidate_visible_sets_for_user(organization_id, subject_id)
        else:
            await invalidate_perm_content(content_type, content_id)
            await invalidate_visible_sets_for_org(organization_id)

    async def list_members(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> list[ContentMember]:
        """Return all member rows for a content item. Requires VIEW."""
        content = await self._load_content(organization_id, content_type, content_id)

        role = await self.permission_checker.effective_role(
            user_id=actor_user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        if role is None:
            raise PermissionDeniedError("view_members", content_type.value)

        result = await self.session.execute(
            select(ContentMember)
            .where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == content_type,
                ContentMember.content_id == content_id,
            )
            .order_by(ContentMember.added_at.asc())
        )
        return list(result.scalars().all())

    async def add_member(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        role: ContentRole,
        expires_at: datetime | None = None,
        note: str = "",
    ) -> ContentMember:
        """Add or upsert a ``ContentMember`` row. Requires MANAGE.

        Rejects OWNER (use :meth:`transfer_ownership`), BLOCKED against org/domain
        admins, adds under OWNER_ONLY, and adding the current owner.
        """
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role = await self._require_manage(
            actor_user_id, organization_id, content_type, content_id, content
        )

        if role == ContentRole.OWNER:
            raise ValidationError(
                "role",
                "Use transfer_ownership to grant the OWNER role",
            )

        effective_mode = await self._resolve_effective_mode(
            organization_id, content_type, content.access_mode,
        )
        if effective_mode == AccessMode.OWNER_ONLY:
            raise ValidationError(
                "access_mode",
                "Cannot add members while access_mode resolves to OWNER_ONLY; "
                "change the access mode first",
            )

        if subject_type == SubjectType.USER and subject_id == content.owner_id:
            raise ValidationError(
                "subject",
                "Owner cannot be added as a member",
            )

        if subject_type == SubjectType.GROUP:
            await self._require_group_subject(actor_user_id, organization_id, subject_id)

        existing = await self._get_existing_member(
            organization_id, content_type, content_id, subject_type, subject_id
        )

        if existing is None:
            member = ContentMember(
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                subject_type=subject_type,
                subject_id=subject_id,
                role=role,
                added_by_user_id=actor_user_id,
                expires_at=expires_at,
            )
            self.session.add(member)
            await record_member_added(
                self.session,
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                subject_type=subject_type,
                subject_id=subject_id,
                new_role=role,
                actor_user_id=actor_user_id,
                note=note,
            )
        else:
            previous_role = existing.role
            existing.role = role
            existing.expires_at = expires_at
            member = existing
            if previous_role != role:
                await record_member_role_changed(
                    self.session,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    previous_role=previous_role,
                    new_role=role,
                    actor_user_id=actor_user_id,
                    note=note,
                )

        await self.session.commit()
        await self.session.refresh(member)

        await self._drop_perm_cache_for_member_change(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=role,
        )

        await self._emit_granted_notification(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=role,
        )
        await self._sync_search_sharing(organization_id, content_type, content_id)
        await publish_perm_change(
            content_type,
            content_id,
            subject_id if subject_type == SubjectType.USER else None,
            role.value,
        )
        await self._publish_access_change(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            action="revoked" if role == ContentRole.BLOCKED else "granted",
        )

        return member

    async def update_member_role(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        new_role: ContentRole,
        note: str = "",
    ) -> ContentMember:
        """Change an existing member's role. Requires MANAGE; same rejects as ``add_member``."""
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role = await self._require_manage(
            actor_user_id, organization_id, content_type, content_id, content
        )

        if new_role == ContentRole.OWNER:
            raise ValidationError(
                "role",
                "Use transfer_ownership to grant the OWNER role",
            )

        existing = await self._get_existing_member(
            organization_id, content_type, content_id, subject_type, subject_id
        )
        if existing is None:
            raise NotFoundError(
                "content_member",
                f"{content_type.value}:{content_id}:{subject_type.value}:{subject_id}",
            )

        previous_role = existing.role
        if previous_role == new_role:
            return existing

        existing.role = new_role

        await record_member_role_changed(
            self.session,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            previous_role=previous_role,
            new_role=new_role,
            actor_user_id=actor_user_id,
            note=note,
        )

        await self.session.commit()
        await self.session.refresh(existing)

        # Toggling in or out of BLOCKED requires dropping both the affected
        # user's key and the content tag so previously cached group/BLOCKED-
        # derived denials clear.
        await self._drop_perm_cache_for_member_change(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=new_role,
        )
        if previous_role == ContentRole.BLOCKED and new_role != ContentRole.BLOCKED:
            await invalidate_perm_content(content_type, content_id)

        await self._emit_granted_notification(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=new_role,
        )
        await self._sync_search_sharing(organization_id, content_type, content_id)
        await publish_perm_change(
            content_type,
            content_id,
            subject_id if subject_type == SubjectType.USER else None,
            new_role.value,
        )
        await self._publish_access_change(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            action="revoked" if new_role == ContentRole.BLOCKED else "granted",
        )

        return existing

    async def remove_member(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        note: str = "",
    ) -> None:
        """Remove a ``ContentMember`` row. Requires MANAGE."""
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role = await self._require_manage(
            actor_user_id, organization_id, content_type, content_id, content
        )

        existing = await self._get_existing_member(
            organization_id, content_type, content_id, subject_type, subject_id
        )
        if existing is None:
            raise NotFoundError(
                "content_member",
                f"{content_type.value}:{content_id}:{subject_type.value}:{subject_id}",
            )

        previous_role = existing.role
        await self.session.delete(existing)

        await record_member_removed(
            self.session,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            previous_role=previous_role,
            actor_user_id=actor_user_id,
            note=note,
        )

        await self.session.commit()

        await self._drop_perm_cache_for_member_change(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=previous_role,
        )

        await self._emit_revoked_notification(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
        )
        await self._sync_search_sharing(organization_id, content_type, content_id)
        await publish_perm_change(
            content_type,
            content_id,
            subject_id if subject_type == SubjectType.USER else None,
            None,
        )
        await self._publish_access_change(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=subject_type,
            subject_id=subject_id,
            action="revoked",
        )

    async def set_access_mode(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_access_mode: AccessMode | None,
        new_baseline_role: ContentRole | None = None,
        remove_members_on_narrow: bool = False,
        note: str = "",
    ) -> None:
        """Change access mode + baseline role. Requires MANAGE.

        ``new_access_mode=None`` clears the override (row inherits org defaults);
        ``new_baseline_role`` must also be ``None`` then. Under ``OPEN_TO_ORG``,
        ``new_baseline_role=None`` means "inherit the org default baseline".
        ``OWNER`` / ``BLOCKED`` are never valid baselines. Narrowing to
        ``OWNER_ONLY`` while member rows exist requires ``remove_members_on_narrow=True``,
        which deletes them and records ``MEMBER_REMOVED`` for each.
        """
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role = await self._require_manage(
            actor_user_id, organization_id, content_type, content_id, content
        )

        self._validate_access_mode(new_access_mode, new_baseline_role)

        if new_access_mode == AccessMode.OWNER_ONLY:
            member_rows = (
                (
                    await self.session.execute(
                        select(ContentMember).where(
                            ContentMember.organization_id == organization_id,
                            ContentMember.content_type == content_type,
                            ContentMember.content_id == content_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if member_rows and not remove_members_on_narrow:
                raise ValidationError(
                    "access_mode",
                    f"Cannot switch to OWNER_ONLY while {len(member_rows)} "
                    "member rows exist. Pass remove_members_on_narrow=True "
                    "to remove them.",
                )
            for member in member_rows:
                await record_member_removed(
                    self.session,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    subject_type=member.subject_type,
                    subject_id=member.subject_id,
                    previous_role=member.role,
                    actor_user_id=actor_user_id,
                    note=note,
                )
                await self.session.delete(member)

        previous_access_mode = content.access_mode
        previous_baseline_role = content.baseline_role
        previous_effective_mode = await self._resolve_effective_mode(
            organization_id, content_type, previous_access_mode,
        )

        content.access_mode = new_access_mode
        if new_access_mode is None:
            content.baseline_role = None
        elif new_access_mode == AccessMode.OPEN_TO_ORG:
            content.baseline_role = new_baseline_role
        else:
            content.baseline_role = None

        new_effective_mode = await self._resolve_effective_mode(
            organization_id, content_type, content.access_mode,
        )

        if previous_access_mode != new_access_mode:
            await record_access_mode_changed(
                self.session,
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                previous_access_mode=previous_access_mode,
                new_access_mode=new_access_mode,
                actor_user_id=actor_user_id,
                note=note,
            )

        if previous_baseline_role != content.baseline_role:
            await record_baseline_role_changed(
                self.session,
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                previous_baseline_role=previous_baseline_role,
                new_baseline_role=content.baseline_role,
                actor_user_id=actor_user_id,
                note=note,
            )

        await self.session.commit()

        # Access-mode or baseline-role flip changes the answer for an unbounded
        # user set; wipe by content tag.
        await invalidate_perm_content(content_type, content_id)
        await invalidate_visible_sets_for_org(organization_id)

        await self._sync_search_access_policy(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        await self._sync_search_sharing(organization_id, content_type, content_id)
        await publish_perm_change(content_type, content_id, None, None)

        # Crossing the OPEN_TO_ORG boundary changes the org-member-visible set;
        # tell every member's sidebar to refresh. Transitions that don't touch
        # org visibility (e.g. OWNER_ONLY <-> EXPLICIT_MEMBERS) are covered by
        # the per-member publishes in add/remove_member instead.
        if previous_effective_mode != new_effective_mode and (
            previous_effective_mode == AccessMode.OPEN_TO_ORG
            or new_effective_mode == AccessMode.OPEN_TO_ORG
        ):
            await publish_content_access_changed(
                content_type=content_type_to_proto(content_type),
                content_id=content_id,
                action="access_mode_changed",
                organization_id=organization_id,
            )

        # Migrate attachments only when the effective mode crosses the
        # OPEN_TO_ORG boundary; pure inheritance changes are handled by the
        # org-defaults reindex.
        if previous_effective_mode != new_effective_mode and (
            previous_effective_mode == AccessMode.OPEN_TO_ORG
            or new_effective_mode == AccessMode.OPEN_TO_ORG
        ):
            await self._migrate_attachments_for_access_change(
                organization_id=organization_id,
                content_type=content_type,
                content_id=content_id,
                new_effective_mode=new_effective_mode,
                new_effective_baseline=content.baseline_role,
                owner_id=content.owner_id,
            )

    async def _resolve_effective_mode(
        self,
        organization_id: UUID,
        content_type: ContentType,
        raw_access_mode: AccessMode | None,
    ) -> AccessMode:
        if raw_access_mode is not None:
            return raw_access_mode
        mode, _ = await resolve_content_defaults(self.session, organization_id, content_type)
        return mode

    async def _migrate_attachments_for_access_change(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_effective_mode: AccessMode,
        new_effective_baseline: ContentRole | None,
        owner_id: UUID,
    ) -> None:
        """Re-route a content's attachments between USER and ORG folders; idempotent."""
        from uniffy.core.models.files.attachment import Attachment
        from uniffy.core.models.files.file import File
        from uniffy.domains.files.attachments.operations import AttachmentOperations

        affected = [(content_type, content_id)]
        for loader in _attachment_cascade_loaders.get(content_type, []):
            affected.extend(await loader(self.session, organization_id, content_id))

        attachments_ops = AttachmentOperations(self.session)
        if new_effective_mode == AccessMode.OPEN_TO_ORG:
            org_folder = await attachments_ops.get_or_create_org_attachments_folder(
                organization_id
            )
            target_folder_id = org_folder.id
            target_mode = AccessMode.OPEN_TO_ORG
            target_baseline = new_effective_baseline or ContentRole.EDITOR
        else:
            target_folder_id = None
            target_mode = AccessMode.OWNER_ONLY
            target_baseline = None

        for ct, cid in affected:
            attachments = (
                (
                    await self.session.execute(
                        select(Attachment).where(
                            Attachment.organization_id == organization_id,
                            Attachment.content_type == ct,
                            Attachment.content_id == cid,
                        )
                    )
                )
                .scalars()
                .all()
            )
            for att in attachments:
                file_row = (
                    await self.session.execute(select(File).where(File.id == att.file_id))
                ).scalar_one_or_none()
                if file_row is None:
                    continue

                if new_effective_mode == AccessMode.OPEN_TO_ORG:
                    if file_row.folder_id != target_folder_id:
                        file_row.folder_id = target_folder_id
                    if file_row.access_mode != target_mode:
                        file_row.access_mode = target_mode
                    if file_row.baseline_role != target_baseline:
                        file_row.baseline_role = target_baseline
                else:
                    user_folder = await attachments_ops.get_or_create_attachments_folder(
                        att.attached_by_user_id or owner_id, organization_id,
                    )
                    if file_row.folder_id != user_folder.id:
                        file_row.folder_id = user_folder.id
                    if file_row.access_mode != target_mode:
                        file_row.access_mode = target_mode
                    if file_row.baseline_role != target_baseline:
                        file_row.baseline_role = target_baseline

        await self.session.commit()

    async def transfer_ownership(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_owner_user_id: UUID,
        note: str = "",
    ) -> None:
        """Transfer ownership; previous owner is demoted to ADMIN via a new member row."""
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role = await self._require_transfer(
            actor_user_id, organization_id, content_type, content_id, content
        )

        if new_owner_user_id == content.owner_id:
            raise ValidationError(
                "new_owner_user_id",
                "New owner is already the current owner",
            )

        if not await self._is_active_org_member(new_owner_user_id, organization_id):
            raise ValidationError(
                "new_owner_user_id",
                "New owner is not an active member of the organization",
            )

        previous_owner_id = content.owner_id

        existing_new_owner_row = await self._get_existing_member(
            organization_id,
            content_type,
            content_id,
            SubjectType.USER,
            new_owner_user_id,
        )
        if existing_new_owner_row is not None:
            await self.session.delete(existing_new_owner_row)

        content.owner_id = new_owner_user_id

        previous_owner_row = ContentMember(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=SubjectType.USER,
            subject_id=previous_owner_id,
            role=ContentRole.ADMIN,
            added_by_user_id=actor_user_id,
        )
        self.session.add(previous_owner_row)

        await record_ownership_transferred(
            self.session,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            previous_owner_id=previous_owner_id,
            new_owner_id=new_owner_user_id,
            actor_user_id=actor_user_id,
            note=note,
        )
        await record_member_added(
            self.session,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=SubjectType.USER,
            subject_id=previous_owner_id,
            new_role=ContentRole.ADMIN,
            actor_user_id=actor_user_id,
            note="Demoted to ADMIN via ownership transfer",
        )

        transfer_hook = _ownership_transfer_hooks.get(content_type)
        if transfer_hook is not None:
            await transfer_hook(
                self.session, organization_id, content_id, new_owner_user_id
            )

        await self.session.commit()
        await self.session.refresh(content)

        await invalidate_perm_role(
            organization_id, previous_owner_id, content_type, content_id
        )
        await invalidate_perm_role(
            organization_id, new_owner_user_id, content_type, content_id
        )
        await invalidate_visible_sets_for_user(organization_id, previous_owner_id)
        await invalidate_visible_sets_for_user(organization_id, new_owner_user_id)

        await self._sync_search_access_policy(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        await self._sync_search_sharing(organization_id, content_type, content_id)

        await self._emit_granted_notification(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            content_type=content_type,
            content_id=content_id,
            subject_type=SubjectType.USER,
            subject_id=new_owner_user_id,
            role=ContentRole.OWNER,
        )
        await publish_perm_change(content_type, content_id, None, None)

    async def list_member_events(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        limit: int = 50,
        offset: int = 0,
        actor_filter_user_id: UUID | None = None,
        action_filter: str | None = None,
        after: datetime | None = None,
        before: datetime | None = None,
    ) -> list[AuditEvent]:
        """Permissions audit events for a content item. Requires VIEW."""
        content = await self._load_content(organization_id, content_type, content_id)

        role = await self.permission_checker.effective_role(
            user_id=actor_user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        if role is None:
            raise PermissionDeniedError("view_member_events", content_type.value)

        query = (
            select(AuditEvent)
            .where(
                AuditEvent.organization_id == organization_id,
                AuditEvent.resource_type == content_type.value,
                AuditEvent.resource_id == content_id,
                AuditEvent.action.like("permissions.%"),
            )
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(limit)
            .offset(offset)
        )
        if actor_filter_user_id is not None:
            query = query.where(AuditEvent.actor_user_id == actor_filter_user_id)
        if action_filter is not None:
            query = query.where(AuditEvent.action == action_filter)
        if after is not None:
            query = query.where(AuditEvent.created_at >= after)
        if before is not None:
            query = query.where(AuditEvent.created_at <= before)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def _load_content(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ):
        loader = get_content_loader(content_type)
        content = await loader(self.session, organization_id, content_id)
        if content is None:
            raise NotFoundError(content_type.value, content_id)
        return content

    async def _require_manage(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content,
    ) -> ContentRole:
        role = await self.permission_checker.effective_role(
            user_id=actor_user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        if not role_can_manage(role):
            override = _manage_overrides.get(content_type)
            if override and await override(self.session, actor_user_id, organization_id):
                return ContentRole.ADMIN
            raise PermissionDeniedError("manage", content_type.value)
        return role

    async def _require_transfer(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content,
    ) -> ContentRole:
        role = await self.permission_checker.effective_role(
            user_id=actor_user_id,
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        if not role_can_transfer(role):
            raise PermissionDeniedError("transfer", content_type.value)
        return role

    async def _get_existing_member(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> ContentMember | None:
        result = await self.session.execute(
            select(ContentMember).where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == content_type,
                ContentMember.content_id == content_id,
                ContentMember.subject_type == subject_type,
                ContentMember.subject_id == subject_id,
            )
        )
        return result.scalar_one_or_none()

    def _validate_access_mode(
        self,
        new_access_mode: AccessMode | None,
        new_baseline_role: ContentRole | None,
    ) -> None:
        """Validate the (access_mode, baseline_role) pair against storage invariants.

        - ``(None, None)`` inherits org defaults; ``(None, X)`` is invalid.
        - ``(OPEN_TO_ORG, None)`` means "inherit org default baseline".
        - ``(OPEN_TO_ORG, X)`` rejects ``OWNER`` / ``BLOCKED``.
        - Any other mode forces baseline NULL.
        """
        if new_access_mode is None:
            if new_baseline_role is not None:
                raise ValidationError(
                    "baseline_role",
                    "baseline_role cannot be set without an access_mode",
                )
            return

        if new_access_mode == AccessMode.OPEN_TO_ORG:
            if new_baseline_role in (ContentRole.OWNER, ContentRole.BLOCKED):
                raise ValidationError(
                    "baseline_role",
                    f"{new_baseline_role.value} is not a valid baseline role",
                )
            return

        if new_baseline_role is not None:
            raise ValidationError(
                "baseline_role",
                "baseline_role must be null unless access_mode is OPEN_TO_ORG",
            )

    async def _is_active_org_member(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> bool:
        result = await self.session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none() is not None

    async def _emit_granted_notification(
        self,
        *,
        organization_id: UUID,
        actor_user_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        role: ContentRole,
    ) -> None:
        if role == ContentRole.BLOCKED:
            return
        target_ids = await self._resolve_notification_targets(
            organization_id, subject_type, subject_id
        )
        try:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.PERMISSION_GRANTED,
                    organization_id=organization_id,
                    actor_id=actor_user_id,
                    title=f"You were added as {role.value.lower()}",
                    source_urn=build_content_urn(content_type, content_id),
                    target_user_ids=target_ids,
                )
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to emit PERMISSION_GRANTED notification"
            )

    async def _emit_revoked_notification(
        self,
        *,
        organization_id: UUID,
        actor_user_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> None:
        target_ids = await self._resolve_notification_targets(
            organization_id, subject_type, subject_id
        )
        try:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.PERMISSION_REVOKED,
                    organization_id=organization_id,
                    actor_id=actor_user_id,
                    title="Your access was removed",
                    source_urn=build_content_urn(content_type, content_id),
                    target_user_ids=target_ids,
                )
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to emit PERMISSION_REVOKED notification"
            )

    async def _publish_access_change(
        self,
        *,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
        action: str,
    ) -> None:
        """Signal the affected users' sidebars to refresh after an explicit grant/revoke."""
        target_ids = await self._resolve_notification_targets(
            organization_id, subject_type, subject_id
        )
        if not target_ids:
            return
        await publish_content_access_changed(
            content_type=content_type_to_proto(content_type),
            content_id=content_id,
            action=action,
            organization_id=organization_id,
            target_user_ids=target_ids,
        )

    async def _require_group_subject(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        group_id: UUID,
    ) -> None:
        """A GROUP grant hands the whole roster the content, so the subject must
        be a real group of THIS org that the actor can see. A private group the
        actor cannot see reports "not found" - existence is the leak."""
        from uniffy.core.models.login.group import Group
        from uniffy.core.models.login.group_member import GroupMember

        result = await self.session.execute(
            select(Group.is_private).where(
                Group.id == group_id,
                Group.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row is None:
            raise NotFoundError("Group", str(group_id))
        if not row[0]:
            return

        member = await self.session.execute(
            select(GroupMember.id).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == actor_user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        if member.scalar_one_or_none() is not None:
            return

        admin = await self.session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.user_id == actor_user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
                OrganizationMember.role.in_(
                    [OrganizationRole.OWNER, OrganizationRole.ADMIN]
                ),
            )
        )
        if admin.scalar_one_or_none() is not None:
            return
        raise NotFoundError("Group", str(group_id))

    async def _resolve_notification_targets(
        self,
        organization_id: UUID,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> list[UUID]:
        if subject_type == SubjectType.USER:
            return [subject_id]

        from uniffy.core.models.login.group import Group
        from uniffy.core.models.login.group_member import GroupMember

        result = await self.session.execute(
            select(GroupMember.user_id)
            .join(Group, Group.id == GroupMember.group_id)
            .join(
                OrganizationMember,
                OrganizationMember.user_id == GroupMember.user_id,
            )
            .where(
                GroupMember.group_id == subject_id,
                GroupMember.is_active == True,  # noqa: E712
                Group.organization_id == organization_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

    async def _sync_search_sharing(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        try:
            result = await self.session.execute(
                select(
                    ContentMember.subject_type,
                    ContentMember.subject_id,
                    ContentMember.role,
                ).where(
                    ContentMember.organization_id == organization_id,
                    ContentMember.content_type == content_type,
                    ContentMember.content_id == content_id,
                )
            )
            shared_users: list[UUID] = []
            shared_groups: list[UUID] = []
            blocked_users: list[UUID] = []
            blocked_groups: list[UUID] = []
            for subject_type, subject_id, role in result.all():
                if subject_type == SubjectType.USER:
                    if role == ContentRole.BLOCKED:
                        blocked_users.append(subject_id)
                    else:
                        shared_users.append(subject_id)
                elif subject_type == SubjectType.GROUP:
                    if role == ContentRole.BLOCKED:
                        blocked_groups.append(subject_id)
                    else:
                        shared_groups.append(subject_id)

            urn = build_content_urn(content_type, content_id)
            await self.search_indexer.update_sharing(
                urn=urn,
                organization_id=organization_id,
                shared_user_ids=shared_users,
                shared_group_ids=shared_groups,
                blocked_user_ids=blocked_users,
                blocked_group_ids=blocked_groups,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to sync search sharing metadata"
            )

    async def _sync_search_access_policy(
        self,
        *,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        owner_id: UUID,
        access_mode: AccessMode | None,
        baseline_role: ContentRole | None,
    ) -> None:
        """Index must carry the effective values since the Meili filter matches literals."""
        try:
            default_mode, default_baseline = await resolve_content_defaults(
                self.session, organization_id, content_type,
            )
            effective_mode, effective_baseline = resolve_effective_policy(
                access_mode, baseline_role, default_mode, default_baseline,
            )
            await self.search_indexer.update_access_policy(
                urn=build_content_urn(content_type, content_id),
                organization_id=organization_id,
                access_mode=effective_mode.value,
                baseline_role=(
                    effective_baseline.value if effective_baseline is not None else None
                ),
                owner_id=owner_id,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to sync search access policy"
            )
