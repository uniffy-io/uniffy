"""Generic content member management.

:class:`ContentMembersOperations` provides the canonical CRUD for
``ContentMember`` rows plus the ``access_mode`` / ``baseline_role`` /
``owner_id`` fields on any content item. It works for every content
type through a registered loader pattern: each domain registers a
function that loads its content rows, and this class dispatches.

The class enforces role-based permissions on every mutation, writes to
the audit log, keeps the search index in sync, and emits notifications.
It is the one place in the backend that mutates access control state.
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
from uniffy.core.auth.permissions.roles import (
    role_can_manage,
    role_can_transfer,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.content_member_event import ContentMemberEvent
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentMemberAction,
    ContentRole,
    ContentType,
    NotificationType,
    SubjectType,
)

# Content loader registry

# Each domain registers a function that loads one of its content rows
# by id. The loader returns the raw SQLModel row (not through
# BaseContentOperations, to avoid circular permission checks) or None
# if the content does not exist in the organization.
#
# The loaded row must have: id, organization_id, owner_id, access_mode,
# baseline_role columns.

ContentLoader = Callable[
    [AsyncSession, UUID, UUID],  # (session, organization_id, content_id)
    Awaitable[object | None],
]

_CONTENT_LOADERS: dict[ContentType, ContentLoader] = {}


def register_content_loader(content_type: ContentType, loader: ContentLoader) -> None:
    """Register a loader for a content type.

    Called by each domain (typically from its ``__init__`` or module
    initializer) so :class:`ContentMembersOperations` can fetch content
    rows generically.
    """
    _CONTENT_LOADERS[content_type] = loader


def get_content_loader(content_type: ContentType) -> ContentLoader:
    """Look up a registered loader or raise if none is registered."""
    loader = _CONTENT_LOADERS.get(content_type)
    if loader is None:
        raise ValidationError(
            "content_type",
            f"No content loader registered for {content_type.value}",
        )
    return loader


# ContentMembersOperations


class ContentMembersOperations:
    """Generic CRUD for content members and access policies.

    Every mutation:
    1. Loads the content row via the registered loader.
    2. Resolves the actor's effective role through ``PermissionChecker``.
    3. Enforces the capability required for the action.
    4. Performs the mutation.
    5. Writes a row to ``permissions_content_member_events``.
    6. Updates the search index membership / access policy fields.
    7. Emits a notification where appropriate.

    All methods are transactional in the sense that the mutation row,
    the audit row, and the notification are committed in the same
    transaction.
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
        """Drop the perm cache entries affected by a member mutation.

        For a USER subject with a non-BLOCKED role we know exactly whose
        cached role changed (one key). For BLOCKED grants and GROUP
        subjects the affected user set isn't enumerable cheaply (groups
        can have thousands of members; BLOCKED affects role resolution
        for any user matched by the subject), so we wipe the whole
        ``content:{ct}:{cid}`` tag.
        """
        if subject_type == SubjectType.USER and role != ContentRole.BLOCKED:
            await invalidate_perm_role(
                organization_id, subject_id, content_type, content_id
            )
        else:
            await invalidate_perm_content(content_type, content_id)

    async def list_members(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> list[ContentMember]:
        """Return all member rows for a content item. Requires VIEW."""
        content = await self._load_content(organization_id, content_type, content_id)

        # VIEW is the floor for listing members. We resolve effective_role
        # and let BaseContentOperations' predicate handle it.
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

        Rejects:
        - ``role == OWNER`` (use :meth:`transfer_ownership`)
        - Setting BLOCKED on an org admin or matching domain admin
        - Adding a member when ``access_mode = OWNER_ONLY``
        - Adding the current owner as a member (owner is implicit)
        """
        content = await self._load_content(organization_id, content_type, content_id)
        actor_role, actor_org_role = await self._require_manage(
            actor_user_id, organization_id, content_type, content_id, content
        )

        if role == ContentRole.OWNER:
            raise ValidationError(
                "role",
                "Use transfer_ownership to grant the OWNER role",
            )

        if content.access_mode == AccessMode.OWNER_ONLY:
            raise ValidationError(
                "access_mode",
                "Cannot add members while access_mode is OWNER_ONLY; change the access mode first",
            )

        if subject_type == SubjectType.USER and subject_id == content.owner_id:
            raise ValidationError(
                "subject",
                "Owner cannot be added as a member",
            )

        if role == ContentRole.BLOCKED:
            await self._reject_blocking_admins(
                organization_id, content_type, subject_type, subject_id
            )

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
                actor_org_role=actor_org_role,
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
                    actor_org_role=actor_org_role,
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
        """Change an existing member's role. Requires MANAGE.

        Rejects the same conditions as :meth:`add_member`.
        """
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role, actor_org_role = await self._require_manage(
            actor_user_id, organization_id, content_type, content_id, content
        )

        if new_role == ContentRole.OWNER:
            raise ValidationError(
                "role",
                "Use transfer_ownership to grant the OWNER role",
            )

        if new_role == ContentRole.BLOCKED:
            await self._reject_blocking_admins(
                organization_id, content_type, subject_type, subject_id
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
            actor_org_role=actor_org_role,
            note=note,
        )

        await self.session.commit()
        await self.session.refresh(existing)

        # The previous role might have been BLOCKED while the new role
        # isn't (or vice versa). Wipe both representations: drop the
        # single key for the new role's affected user, and if either
        # role is BLOCKED also wipe the content tag so previously-cached
        # group/BLOCKED-derived denials drop too.
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
        _actor_role, actor_org_role = await self._require_manage(
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
            actor_org_role=actor_org_role,
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

    async def set_access_mode(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_access_mode: AccessMode,
        new_baseline_role: ContentRole | None = None,
        remove_members_on_narrow: bool = False,
        note: str = "",
    ) -> None:
        """Change access mode and baseline role. Requires MANAGE.

        Validation:
        - ``new_baseline_role`` must be non-null iff
          ``new_access_mode = OPEN_TO_ORG``.
        - ``new_baseline_role`` must not be ``OWNER`` or ``BLOCKED``.
        - Moving to ``OWNER_ONLY`` while member rows exist is rejected
          unless ``remove_members_on_narrow=True``; in that case the
          rows are deleted first and a ``MEMBER_REMOVED`` event is
          written for each.
        """
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role, actor_org_role = await self._require_manage(
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
                    actor_org_role=actor_org_role,
                    note=note,
                )
                await self.session.delete(member)

        previous_access_mode = content.access_mode
        previous_baseline_role = content.baseline_role

        content.access_mode = new_access_mode
        content.baseline_role = (
            new_baseline_role if new_access_mode == AccessMode.OPEN_TO_ORG else None
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
                actor_org_role=actor_org_role,
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
                actor_org_role=actor_org_role,
                note=note,
            )

        await self.session.commit()

        # Access mode or baseline role flip changes the answer for an
        # unbounded user set (every org member when OPEN_TO_ORG flips,
        # every BLOCKED-derived denial when narrowed). Wipe by content tag.
        await invalidate_perm_content(content_type, content_id)

        await self._sync_search_access_policy(
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        await self._sync_search_sharing(organization_id, content_type, content_id)

    async def transfer_ownership(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        new_owner_user_id: UUID,
        note: str = "",
    ) -> None:
        """Transfer content ownership to a different user.

        - Requires OWNER (or org/domain admin bypass).
        - Target must be an active member of the organization.
        - Previous owner becomes ADMIN via a new ``ContentMember`` row.
        - New owner's existing ``ContentMember`` row, if any, is deleted.
        - Writes OWNERSHIP_TRANSFERRED + MEMBER_ADDED events.
        """
        content = await self._load_content(organization_id, content_type, content_id)
        _actor_role, actor_org_role = await self._require_transfer(
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

        # Delete new owner's existing member row if any.
        existing_new_owner_row = await self._get_existing_member(
            organization_id,
            content_type,
            content_id,
            SubjectType.USER,
            new_owner_user_id,
        )
        if existing_new_owner_row is not None:
            await self.session.delete(existing_new_owner_row)

        # Flip ownership on the content row.
        content.owner_id = new_owner_user_id

        # Previous owner becomes ADMIN via a new ContentMember row.
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
            actor_org_role=actor_org_role,
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
            actor_org_role=actor_org_role,
            note="Demoted to ADMIN via ownership transfer",
        )

        await self.session.commit()
        await self.session.refresh(content)

        await invalidate_perm_role(
            organization_id, previous_owner_id, content_type, content_id
        )
        await invalidate_perm_role(
            organization_id, new_owner_user_id, content_type, content_id
        )

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

    async def list_member_events(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        limit: int = 50,
        offset: int = 0,
        actor_filter_user_id: UUID | None = None,
        action_filter: ContentMemberAction | None = None,
        after: datetime | None = None,
        before: datetime | None = None,
    ) -> list[ContentMemberEvent]:
        """List audit events for a content item. Requires VIEW."""
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
            select(ContentMemberEvent)
            .where(
                ContentMemberEvent.organization_id == organization_id,
                ContentMemberEvent.content_type == content_type,
                ContentMemberEvent.content_id == content_id,
            )
            .order_by(ContentMemberEvent.occurred_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if actor_filter_user_id is not None:
            query = query.where(ContentMemberEvent.actor_user_id == actor_filter_user_id)
        if action_filter is not None:
            query = query.where(ContentMemberEvent.action == action_filter)
        if after is not None:
            query = query.where(ContentMemberEvent.occurred_at >= after)
        if before is not None:
            query = query.where(ContentMemberEvent.occurred_at <= before)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    # Internal helpers

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
    ) -> tuple[ContentRole, OrganizationRole]:
        """Resolve the actor's role and require MANAGE.

        Returns (effective_role, snapshot_of_actor_org_role) so the
        caller can reuse the org role for audit logging.
        """
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
            raise PermissionDeniedError("manage", content_type.value)
        org_role = await self.permission_checker.get_user_org_role(actor_user_id, organization_id)
        return role, org_role or OrganizationRole.MEMBER

    async def _require_transfer(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        content,
    ) -> tuple[ContentRole, OrganizationRole]:
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
        org_role = await self.permission_checker.get_user_org_role(actor_user_id, organization_id)
        return role, org_role or OrganizationRole.MEMBER

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

    async def _reject_blocking_admins(
        self,
        organization_id: UUID,
        content_type: ContentType,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> None:
        """Raise ValidationError if the subject is an org or domain admin.

        Org OWNER/ADMIN roles and domain admins always bypass BLOCKED via
        the permission checker, so blocking them is misleading. Reject at
        the API layer with a clear error instead of letting it quietly
        not work.
        """
        if subject_type != SubjectType.USER:
            return

        if await self.permission_checker.is_org_admin(subject_id, organization_id):
            raise ValidationError(
                "subject",
                "Organization admins cannot be blocked. Remove their "
                "admin role first if you need to restrict their access.",
            )

        if await self.permission_checker.is_domain_admin(subject_id, organization_id, content_type):
            raise ValidationError(
                "subject",
                "Domain admins for this content type cannot be blocked. "
                "Revoke their domain admin status first.",
            )

    def _validate_access_mode(
        self,
        new_access_mode: AccessMode,
        new_baseline_role: ContentRole | None,
    ) -> None:
        """Validate the (access_mode, baseline_role) combination."""
        if new_access_mode == AccessMode.OPEN_TO_ORG:
            if new_baseline_role is None:
                raise ValidationError(
                    "baseline_role",
                    "baseline_role is required when access_mode is OPEN_TO_ORG",
                )
            if new_baseline_role in (ContentRole.OWNER, ContentRole.BLOCKED):
                raise ValidationError(
                    "baseline_role",
                    f"{new_baseline_role.value} is not a valid baseline role",
                )
        else:
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
        target_ids = await self._resolve_notification_targets(subject_type, subject_id)
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
            logger.warning(
                "Failed to emit PERMISSION_GRANTED notification",
                exc_info=True,
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
        target_ids = await self._resolve_notification_targets(subject_type, subject_id)
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
            logger.warning(
                "Failed to emit PERMISSION_REVOKED notification",
                exc_info=True,
            )

    async def _resolve_notification_targets(
        self,
        subject_type: SubjectType,
        subject_id: UUID,
    ) -> list[UUID]:
        """Resolve subject to target user IDs for notifications."""
        if subject_type == SubjectType.USER:
            return [subject_id]

        from uniffy.core.models.login.group_member import GroupMember

        result = await self.session.execute(
            select(GroupMember.user_id).where(
                GroupMember.group_id == subject_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

    async def _sync_search_sharing(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        """Sync shared / blocked user / group lists in the search index."""
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
            logger.warning(
                "Failed to sync search sharing metadata",
                exc_info=True,
            )

    async def _sync_search_access_policy(
        self,
        *,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        owner_id: UUID,
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
    ) -> None:
        """Sync access policy fields in the search index."""
        try:
            await self.search_indexer.update_access_policy(
                urn=build_content_urn(content_type, content_id),
                organization_id=organization_id,
                access_mode=access_mode.value,
                baseline_role=baseline_role.value if baseline_role is not None else None,
                owner_id=owner_id,
            )
        except Exception:
            logger.warning(
                "Failed to sync search access policy",
                exc_info=True,
            )
