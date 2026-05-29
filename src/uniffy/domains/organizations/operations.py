"""Organization CRUD, membership, and permission defaults."""

import copy
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.cache import invalidate_org_defaults
from uniffy.core.auth.permissions import invalidate_visible_sets_for_user
from uniffy.core.auth.permissions.visible_sets import invalidate_visible_sets_for_org
from uniffy.core.crypto import OrgCipher
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models import Group, Organization, OrganizationPermissionDefaults, User
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import AccessMode, ContentRole, ContentType, DomainType
from uniffy.core.valkey.cache import cache_invalidate_by_tag
from uniffy.domains.organizations.defaults import DEFAULT_ORG_SETTINGS


async def _drop_user_perm_cache(user_id: UUID) -> None:
    """Drop every cached perm entry tied to ``user_id``; failures fall back to TTL expiry."""
    try:
        await cache_invalidate_by_tag(f"user:{user_id}")
    except Exception:
        logger.warning(
            f"Perm-cache invalidation failed for user {user_id}",
            component="org-ops",
        )


class OrganizationOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

        from uniffy.domains.users.search import UserSearchIndexer

        self._user_indexer = UserSearchIndexer(session)

    async def get_by_id(self, org_id: UUID) -> Organization:
        result = await self._session.execute(select(Organization).where(Organization.id == org_id))
        org = result.scalar_one_or_none()
        if not org:
            raise NotFoundError("Organization", str(org_id))
        return org

    async def get_by_slug(self, slug: str) -> Organization | None:
        result = await self._session.execute(select(Organization).where(Organization.slug == slug))
        return result.scalar_one_or_none()

    async def create(
        self,
        name: str,
        slug: str,
        owner_user_id: UUID,
        domain: str | None = None,
        plan: str = "free",
        actor_user_id: UUID | None = None,
    ) -> Organization:
        org = Organization(
            name=name,
            slug=slug,
            domain=domain,
            plan=plan,
            settings=copy.deepcopy(DEFAULT_ORG_SETTINGS),
        )
        self._session.add(org)
        await self._session.flush()

        membership = OrganizationMember(
            user_id=owner_user_id,
            organization_id=org.id,
            role=OrganizationRole.OWNER,
        )
        self._session.add(membership)

        await self._session.commit()
        await self._session.refresh(org)

        await OrgCipher(self._session).provision(org.id, owner_user_id)
        await self._session.commit()

        result = await self._session.execute(select(User).where(User.id == owner_user_id))
        owner = result.scalar_one_or_none()
        if owner:
            await self._user_indexer.index_for_organization(owner, org.id)
            await self._session.commit()

        from uniffy.domains.attachments.operations import AttachmentOperations

        attachment_ops = AttachmentOperations(self._session)
        await attachment_ops.get_or_create_attachments_folder(owner_user_id, org.id)
        await self._session.commit()

        from uniffy.domains.files.filters.presets import create_default_presets

        await create_default_presets(self._session, org.id, owner_user_id)
        await self._session.commit()

        from uniffy.domains.tags.filters.presets import (
            create_default_tag_filter_presets,
        )

        await create_default_tag_filter_presets(
            self._session, org.id, owner_user_id
        )
        await self._session.commit()

        from uniffy.core.models.chat.channel import ChannelType
        from uniffy.domains.chat.channels.operations import ChatChannelOperations

        chat_ops = ChatChannelOperations(self._session)
        await chat_ops.create_channel(
            user_id=owner_user_id,
            organization_id=org.id,
            name="general",
            channel_type=ChannelType.PUBLIC,
            description="Organization-wide discussions",
            is_default=True,
        )
        await self._session.commit()

        from uniffy.domains.organizations.defaults import ORG_PERMISSION_DEFAULTS

        for ct, flags in ORG_PERMISSION_DEFAULTS.items():
            self._session.add(
                OrganizationPermissionDefaults(
                    organization_id=org.id,
                    content_type=ct,
                    updated_by_user_id=owner_user_id,
                    **flags,
                )
            )
        await self._session.commit()

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=actor_user_id or owner_user_id,
            action=Action.ORGANIZATION_CREATED,
            resource_type="ORGANIZATION",
            resource_id=org.id,
            details={"name": name, "slug": slug, "plan": plan},
        )
        await self._session.commit()

        return org

    async def update(
        self,
        org_id: UUID,
        name: str | None = None,
        slug: str | None = None,
        domain: str | None = None,
        plan: str | None = None,
        is_active: bool | None = None,
        actor_user_id: UUID | None = None,
    ) -> Organization:
        org = await self.get_by_id(org_id)

        changed_keys: list[str] = []
        if name is not None and org.name != name:
            org.name = name
            changed_keys.append("name")
        if slug is not None and org.slug != slug:
            org.slug = slug
            changed_keys.append("slug")
        if domain is not None and org.domain != domain:
            org.domain = domain
            changed_keys.append("domain")
        if plan is not None and org.plan != plan:
            org.plan = plan
            changed_keys.append("plan")
        if is_active is not None and org.is_active != is_active:
            org.is_active = is_active
            changed_keys.append("is_active")

        if changed_keys:
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=actor_user_id,
                action=Action.ORGANIZATION_SETTINGS_CHANGED,
                resource_type="ORGANIZATION",
                resource_id=org_id,
                details={"changed_keys": changed_keys},
            )

        await self._session.commit()
        await self._session.refresh(org)
        return org

    async def delete(self, org_id: UUID, actor_user_id: UUID | None = None) -> bool:
        org = await self.get_by_id(org_id)

        groups_result = await self._session.execute(
            select(Group.id).where(Group.organization_id == org_id)
        )
        group_ids = [row[0] for row in groups_result.all()]
        if group_ids:
            await self._session.execute(
                sql_delete(GroupMember).where(GroupMember.group_id.in_(group_ids))
            )

        await self._session.execute(sql_delete(Group).where(Group.organization_id == org_id))

        await self._session.execute(
            sql_delete(DomainAdmin).where(DomainAdmin.organization_id == org_id)
        )

        await self._session.execute(
            sql_delete(OrganizationPermissionDefaults).where(
                OrganizationPermissionDefaults.organization_id == org_id
            )
        )

        await self._session.execute(
            sql_delete(OrganizationMember).where(OrganizationMember.organization_id == org_id)
        )

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=actor_user_id,
            action=Action.ORGANIZATION_DELETED,
            resource_type="ORGANIZATION",
            resource_id=org_id,
            details={"name": org.name, "slug": org.slug},
        )

        await self._session.delete(org)
        await self._session.commit()

        return True

    async def list_all(
        self,
        page: int = 1,
        page_size: int = 20,
        query_str: str | None = None,
    ) -> tuple[list[tuple[Organization, int, int]], int]:
        query = select(Organization)

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(Organization.name.ilike(pattern) | Organization.slug.ilike(pattern))

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        query = query.order_by(Organization.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        orgs = list(result.scalars().all())

        orgs_with_counts: list[tuple[Organization, int, int]] = []
        for org in orgs:
            member_count_result = await self._session.execute(
                select(func.count()).select_from(
                    select(OrganizationMember)
                    .where(OrganizationMember.organization_id == org.id)
                    .where(OrganizationMember.is_active.is_(True))
                    .subquery()
                )
            )
            member_count = member_count_result.scalar() or 0

            group_count_result = await self._session.execute(
                select(func.count()).select_from(
                    select(Group).where(Group.organization_id == org.id).subquery()
                )
            )
            group_count = group_count_result.scalar() or 0

            orgs_with_counts.append((org, member_count, group_count))

        return orgs_with_counts, total

    async def get_user_organizations(
        self,
        user_id: UUID,
    ) -> list[tuple[Organization, OrganizationMember]]:
        result = await self._session.execute(
            select(Organization, OrganizationMember)
            .join(OrganizationMember, Organization.id == OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == user_id)
            .where(OrganizationMember.is_active.is_(True))
            .order_by(Organization.name)
        )
        return [(row[0], row[1]) for row in result.all()]

    async def get_overview(self, org_id: UUID) -> dict:
        org = await self.get_by_id(org_id)

        member_count_result = await self._session.execute(
            select(func.count()).select_from(
                select(OrganizationMember)
                .where(OrganizationMember.organization_id == org_id)
                .where(OrganizationMember.is_active.is_(True))
                .subquery()
            )
        )
        member_count = member_count_result.scalar() or 0

        group_count_result = await self._session.execute(
            select(func.count()).select_from(
                select(Group).where(Group.organization_id == org_id).subquery()
            )
        )
        group_count = group_count_result.scalar() or 0

        return {
            "organization": org,
            "member_count": member_count,
            "group_count": group_count,
        }

    async def get_membership(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember | None:
        result = await self._session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def require_org_admin(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember:
        membership = await self.get_membership(user_id, org_id)
        if not membership or membership.role not in (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        ):
            raise PermissionDeniedError("Requires organization admin privileges")
        return membership

    async def require_org_owner(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember:
        """Stricter than ``require_org_admin``; used for actions kept to a
        single accountable person.
        """
        membership = await self.get_membership(user_id, org_id)
        if not membership or membership.role != OrganizationRole.OWNER:
            raise PermissionDeniedError("Requires organization owner privileges")
        return membership

    async def require_org_member(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember:
        membership = await self.get_membership(user_id, org_id)
        if not membership:
            raise PermissionDeniedError("Requires organization membership")
        return membership

    async def list_members(
        self,
        org_id: UUID,
        page: int = 1,
        page_size: int = 50,
        role_filter: OrganizationRole | None = None,
        search: str | None = None,
        include_inactive: bool = False,
    ) -> tuple[list[tuple[OrganizationMember, User]], int]:
        base_query = (
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == org_id)
        )

        if not include_inactive:
            base_query = base_query.where(OrganizationMember.is_active.is_(True))

        if role_filter:
            base_query = base_query.where(OrganizationMember.role == role_filter)

        if search:
            base_query = base_query.where(
                User.email.ilike(f"%{search}%")
                | User.full_name.ilike(f"%{search}%")
                | User.username.ilike(f"%{search}%")
            )

        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        query = base_query.order_by(OrganizationMember.joined_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        members = [(row[0], row[1]) for row in result.all()]

        return (members, total)

    async def add_member(
        self,
        user_id: UUID,
        org_id: UUID,
        role: OrganizationRole = OrganizationRole.MEMBER,
        actor_user_id: UUID | None = None,
    ) -> OrganizationMember:
        existing = await self.get_membership(user_id, org_id)
        if existing:
            return existing

        membership = OrganizationMember(
            user_id=user_id,
            organization_id=org_id,
            role=role,
        )
        self._session.add(membership)
        await self._session.commit()
        await self._session.refresh(membership)

        result = await self._session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            await self._user_indexer.index_for_organization(user, org_id)
            await self._session.commit()

        from uniffy.domains.attachments.operations import AttachmentOperations

        attachment_ops = AttachmentOperations(self._session)
        await attachment_ops.get_or_create_attachments_folder(user_id, org_id)
        await self._session.commit()

        from uniffy.domains.chat.channels.operations import ChatChannelOperations

        chat_ops = ChatChannelOperations(self._session)
        await chat_ops.join_default_channels(user_id, org_id)
        await self._session.commit()

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=actor_user_id,
            action=Action.ORGANIZATION_MEMBER_ADDED,
            resource_type="USER",
            resource_id=user_id,
            details={"role": role.value},
        )
        await self._session.commit()

        await _drop_user_perm_cache(user_id)
        from uniffy.core.auth.membership import invalidate_membership_cache

        await invalidate_membership_cache(user_id, org_id)

        return membership

    async def update_member_role(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        new_role: OrganizationRole,
    ) -> tuple[OrganizationMember, User]:
        await self.require_org_admin(admin_user_id, org_id)

        result = await self._session.execute(
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == org_id)
            .where(OrganizationMember.user_id == target_user_id)
        )
        row = result.first()
        if not row:
            raise NotFoundError("Member", str(target_user_id))

        member, user = row[0], row[1]

        # Only OWNER can change roles to/from OWNER.
        admin_membership = await self.get_membership(admin_user_id, org_id)

        if member.role == OrganizationRole.OWNER or new_role == OrganizationRole.OWNER:
            if not admin_membership or admin_membership.role != OrganizationRole.OWNER:
                raise PermissionDeniedError("Only owners can modify owner roles")

        previous_role = member.role
        member.role = new_role
        member.updated_at = datetime.now(UTC)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=admin_user_id,
            action=Action.ORGANIZATION_MEMBER_ROLE_CHANGED,
            resource_type="USER",
            resource_id=target_user_id,
            details={
                "previous_role": previous_role.value,
                "new_role": new_role.value,
            },
        )

        await self._session.commit()
        await self._session.refresh(member)

        await _drop_user_perm_cache(target_user_id)
        from uniffy.core.auth.membership import invalidate_membership_cache

        await invalidate_membership_cache(target_user_id, org_id)

        return (member, user)

    async def remove_member(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
    ) -> bool:
        await self.require_org_admin(admin_user_id, org_id)

        membership = await self.get_membership(target_user_id, org_id)
        if not membership:
            return False

        if membership.role == OrganizationRole.OWNER:
            raise PermissionDeniedError("Cannot remove organization owner")

        await self._session.execute(
            sql_delete(DomainAdmin).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
            )
        )

        previous_role = membership.role
        await self._session.delete(membership)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=admin_user_id,
            action=Action.ORGANIZATION_MEMBER_REMOVED,
            resource_type="USER",
            resource_id=target_user_id,
            details={"previous_role": previous_role.value},
        )

        await self._session.commit()

        await self._user_indexer.remove_from_organization(target_user_id, org_id)
        await self._session.commit()

        await _drop_user_perm_cache(target_user_id)
        from uniffy.core.auth.membership import invalidate_membership_cache

        await invalidate_membership_cache(target_user_id, org_id)

        return True

    async def get_permission_defaults(
        self,
        org_id: UUID,
    ) -> list[OrganizationPermissionDefaults]:
        result = await self._session.execute(
            select(OrganizationPermissionDefaults).where(
                OrganizationPermissionDefaults.organization_id == org_id
            )
        )
        return list(result.scalars().all())

    async def update_permission_defaults(
        self,
        user_id: UUID,
        org_id: UUID,
        content_type: ContentType,
        default_access_mode: AccessMode | None = None,
        default_baseline_role: ContentRole | None = None,
    ) -> OrganizationPermissionDefaults:
        await self.require_org_admin(user_id, org_id)

        result = await self._session.execute(
            select(OrganizationPermissionDefaults)
            .where(OrganizationPermissionDefaults.organization_id == org_id)
            .where(OrganizationPermissionDefaults.content_type == content_type)
        )
        defaults = result.scalar_one_or_none()

        previous_access_mode = defaults.default_access_mode if defaults else None
        previous_baseline_role = defaults.default_baseline_role if defaults else None

        if defaults:
            if default_access_mode is not None:
                defaults.default_access_mode = default_access_mode
                if default_access_mode != AccessMode.OPEN_TO_ORG:
                    defaults.default_baseline_role = None
            if default_baseline_role is not None:
                defaults.default_baseline_role = default_baseline_role
            defaults.updated_by_user_id = user_id
            defaults.updated_at = datetime.now(UTC)
        else:
            from uniffy.domains.organizations.defaults import ORG_PERMISSION_DEFAULTS

            base = ORG_PERMISSION_DEFAULTS.get(content_type, {})
            mode = default_access_mode or base.get("default_access_mode", AccessMode.OWNER_ONLY)
            baseline = (
                default_baseline_role
                if default_baseline_role is not None
                else base.get("default_baseline_role")
            )
            if mode != AccessMode.OPEN_TO_ORG:
                baseline = None
            defaults = OrganizationPermissionDefaults(
                organization_id=org_id,
                content_type=content_type,
                default_access_mode=mode,
                default_baseline_role=baseline,
                updated_by_user_id=user_id,
            )
            self._session.add(defaults)

        await self._session.commit()
        await self._session.refresh(defaults)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=user_id,
            action=Action.ORGANIZATION_PERMISSION_DEFAULTS_CHANGED,
            resource_type="CONTENT_TYPE",
            resource_id=None,
            details={
                "content_type": content_type.value,
                "previous_access_mode": previous_access_mode.value
                if previous_access_mode
                else None,
                "new_access_mode": defaults.default_access_mode.value,
                "previous_baseline_role": previous_baseline_role.value
                if previous_baseline_role
                else None,
                "new_baseline_role": defaults.default_baseline_role.value
                if defaults.default_baseline_role
                else None,
            },
        )
        await self._session.commit()

        # A defaults flip changes the effective policy for every inheriting row.
        await invalidate_org_defaults(org_id, content_type)
        await invalidate_visible_sets_for_org(org_id)

        # Search docs bake the resolved policy at index time; job-id dedup coalesces burst toggles.
        try:
            from uniffy.core.queue import get_queue

            queue = get_queue()
            await queue.enqueue_job(
                "reindex_org_content_for_defaults",
                str(org_id),
                content_type.value,
                _job_id=f"reindex_defaults:{org_id}:{content_type.value}",
            )
        except Exception:
            logger.warning(
                "Failed to enqueue org-content reindex after defaults change",
                exc_info=True,
            )

        try:
            from uniffy.core.realtime.publisher import publish_defaults_changed

            await publish_defaults_changed(org_id, content_type)
        except Exception:
            logger.warning(
                "Failed to publish realtime defaults_changed event",
                exc_info=True,
            )

        return defaults

    async def get_organization_settings(self, org_id: UUID) -> dict[str, Any]:
        org = await self.get_by_id(org_id)
        return dict(org.settings or {})

    async def update_organization_settings(
        self,
        user_id: UUID,
        org_id: UUID,
        chat_agents_enabled: bool | None = None,
    ) -> dict[str, Any]:
        """Merge-update the settings JSONB; reassigned to a new dict so
        SQLAlchemy detects the mutation.
        """
        await self.require_org_admin(user_id, org_id)
        org = await self.get_by_id(org_id)
        settings = dict(org.settings or {})
        changed_keys: list[str] = []
        if chat_agents_enabled is not None:
            chat = dict(settings.get("chat") or {})
            if chat.get("agents_enabled") != chat_agents_enabled:
                chat["agents_enabled"] = chat_agents_enabled
                settings["chat"] = chat
                changed_keys.append("chat.agents_enabled")
        org.settings = settings

        if changed_keys:
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=user_id,
                action=Action.ORGANIZATION_SETTINGS_CHANGED,
                resource_type="ORGANIZATION",
                resource_id=org_id,
                details={"changed_keys": changed_keys},
            )

        await self._session.commit()
        await self._session.refresh(org)
        return dict(org.settings or {})

    async def grant_domain_admin(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        domain: DomainType,
    ) -> tuple[DomainAdmin, User]:
        """Idempotent: returns existing assignment if already granted."""
        await self.require_org_admin(admin_user_id, org_id)
        await self.require_org_member(target_user_id, org_id)

        result = await self._session.execute(
            select(DomainAdmin).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
                DomainAdmin.domain == domain,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            user_result = await self._session.execute(select(User).where(User.id == target_user_id))
            user = user_result.scalar_one()
            return existing, user

        da = DomainAdmin(
            user_id=target_user_id,
            organization_id=org_id,
            domain=domain,
            granted_by=admin_user_id,
        )
        self._session.add(da)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=admin_user_id,
            action=Action.DOMAIN_ADMIN_GRANTED,
            resource_type="USER",
            resource_id=target_user_id,
            details={"domain": domain.value},
        )

        await self._session.commit()
        await self._session.refresh(da)

        await invalidate_visible_sets_for_user(org_id, target_user_id)

        from uniffy.core.valkey.pubsub import publish_notification

        await publish_notification(target_user_id, {"_type": "permissions_changed"})

        user_result = await self._session.execute(select(User).where(User.id == target_user_id))
        user = user_result.scalar_one()
        return da, user

    async def revoke_domain_admin(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        domain: DomainType,
    ) -> bool:
        await self.require_org_admin(admin_user_id, org_id)

        result = await self._session.execute(
            select(DomainAdmin).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
                DomainAdmin.domain == domain,
            )
        )
        da = result.scalar_one_or_none()
        if not da:
            raise NotFoundError("DomainAdmin", f"{target_user_id}:{domain.value}")

        previous_state = {
            "granted_at": da.granted_at.isoformat(),
            "granted_by": str(da.granted_by),
        }

        await self._session.delete(da)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=admin_user_id,
            action=Action.DOMAIN_ADMIN_REVOKED,
            resource_type="USER",
            resource_id=target_user_id,
            details={"domain": domain.value, "previous_state": previous_state},
        )

        await self._session.commit()

        await invalidate_visible_sets_for_user(org_id, target_user_id)

        from uniffy.core.valkey.pubsub import publish_notification

        await publish_notification(target_user_id, {"_type": "permissions_changed"})

        return True

    async def list_domain_admins(
        self,
        org_id: UUID,
        domain_filter: DomainType | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[tuple[DomainAdmin, User]], int]:
        base_query = (
            select(DomainAdmin, User)
            .join(User, User.id == DomainAdmin.user_id)
            .where(DomainAdmin.organization_id == org_id)
        )

        if domain_filter:
            base_query = base_query.where(DomainAdmin.domain == domain_filter)

        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        query = base_query.order_by(DomainAdmin.granted_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        items = [(row[0], row[1]) for row in result.all()]
        return items, total

    async def get_user_domain_admins(
        self,
        org_id: UUID,
        target_user_id: UUID,
    ) -> list[DomainType]:
        result = await self._session.execute(
            select(DomainAdmin.domain).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
            )
        )
        return [row[0] for row in result.all()]

    async def rotate_encryption_key(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[int, int, datetime]:
        """Org OWNER only - separation of duty from admins."""
        await self.require_org_owner(user_id, organization_id)
        new_version = await OrgCipher(self._session).rotate(organization_id, user_id)
        rotated_at = datetime.now(UTC)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.ORGANIZATION_ENCRYPTION_KEY_ROTATED,
            resource_type="organization",
            resource_id=organization_id,
            details={
                "previous_version": new_version - 1,
                "new_version": new_version,
            },
        )
        await self._session.commit()
        return new_version - 1, new_version, rotated_at
