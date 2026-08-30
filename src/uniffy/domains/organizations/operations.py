"""Organization CRUD, membership, and permission defaults."""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions.defaults import ORG_PERMISSION_DEFAULTS
from uniffy.core.crypto import OrgCipher
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.models import Group, Organization, OrganizationPermissionDefaults, User
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType, DomainType
from uniffy.db.seed_docs import (
    seed_workspace_docs,
    starter_content_enabled,
    workspace_docs_available,
)
from uniffy.domains.agents.bootstrap import (
    StagedDefaultAgent,
    finish_default_agent_after_commit,
    stage_default_agent,
)
from uniffy.domains.calls.operations import kick_user_from_active_call
from uniffy.domains.chat.cache import (
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.channels import stage_default_channel_memberships
from uniffy.domains.chat.channels.operations import (
    ChatChannelOperations,
    StagedChatChannelCreate,
)
from uniffy.domains.chat.cleanup import cleanup_chat_membership_for_organization
from uniffy.domains.chat.search import enqueue_chat_search_acl_refresh
from uniffy.domains.files.attachments import stage_personal_attachments_folder
from uniffy.domains.files.filters.presets import create_default_presets
from uniffy.domains.permissions.jobs.contracts import REINDEX_ORG_CONTENT_FOR_DEFAULTS
from uniffy.domains.tags.filters.presets import create_default_tag_filter_presets

logger = logger.bind(component="organizations.operations")


@dataclass(frozen=True)
class StagedOrganizationMembership:
    membership: OrganizationMember
    organization_id: UUID
    organization_slug: str
    default_channel_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class StagedOrganizationCreate:
    organization: Organization
    owner: User
    default_channel: StagedChatChannelCreate
    default_agent: StagedDefaultAgent


class OrganizationOperations:
    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        self._session = session
        self._storage = storage
        self._search_indexer = search_indexer

        from uniffy.domains.users.search import UserSearchIndexer

        self._user_indexer = (
            UserSearchIndexer(session, search_indexer) if search_indexer is not None else None
        )

    @property
    def search_indexer(self) -> SearchIndexer:
        if self._search_indexer is None:
            raise RuntimeError("Search indexing is required for organization mutations")
        return self._search_indexer

    @property
    def user_indexer(self):
        if self._user_indexer is None:
            raise RuntimeError("Search indexing is required for organization mutations")
        return self._user_indexer

    async def get_by_id(self, org_id: UUID) -> Organization:
        result = await self._session.execute(select(Organization).where(Organization.id == org_id))
        org = result.scalar_one_or_none()
        if not org:
            raise NotFoundError("Organization", str(org_id))
        return org

    async def create(
        self,
        name: str,
        slug: str,
        owner_user_id: UUID,
        domain: str | None = None,
        plan: str = "free",
        actor_user_id: UUID | None = None,
    ) -> Organization:
        try:
            staged = await self.stage_organization(
                name=name,
                slug=slug,
                owner_user_id=owner_user_id,
                domain=domain,
                plan=plan,
                actor_user_id=actor_user_id,
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise

        await self._session.refresh(staged.organization)
        await self.finish_organization_create_after_commit(staged)
        await self._session.refresh(staged.organization)
        return staged.organization

    async def stage_organization(
        self,
        name: str,
        slug: str,
        owner_user_id: UUID,
        domain: str | None = None,
        plan: str = "free",
        actor_user_id: UUID | None = None,
    ) -> StagedOrganizationCreate:
        org = Organization(
            name=name,
            slug=slug,
            domain=domain,
            plan=plan,
        )
        self._session.add(org)
        await self._session.flush()

        result = await self._session.execute(select(User).where(User.id == owner_user_id))
        owner = result.scalar_one_or_none()
        if owner is None:
            raise NotFoundError("User", str(owner_user_id))

        self._session.add_all([
            OrganizationMember(
                user_id=owner_user_id,
                organization_id=org.id,
                role=OrganizationRole.OWNER,
            ),
            IdentitySource(
                organization_id=org.id,
                kind=IdentitySourceKind.LOCAL,
                name="Local",
            ),
        ])

        await OrgCipher(self._session).provision(org.id, owner_user_id)
        await stage_personal_attachments_folder(self._session, owner_user_id, org.id)
        await create_default_presets(self._session, org.id, owner_user_id)
        await create_default_tag_filter_presets(self._session, org.id, owner_user_id)

        default_channel = await ChatChannelOperations(self._session).stage_channel(
            user_id=owner_user_id,
            organization_id=org.id,
            name="general",
            channel_type=ChannelType.PUBLIC,
            description="Organization-wide discussions",
            is_default=True,
        )
        default_agent = await stage_default_agent(self._session, org.id, owner_user_id)

        for ct, flags in ORG_PERMISSION_DEFAULTS.items():
            self._session.add(
                OrganizationPermissionDefaults(
                    organization_id=org.id,
                    content_type=ct,
                    updated_by_user_id=owner_user_id,
                    **flags,
                )
            )

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=actor_user_id or owner_user_id,
            action=Action.ORGANIZATION_CREATED,
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=org.id,
            details={"name": name, "slug": slug, "plan": plan},
        )
        await self._session.flush()
        return StagedOrganizationCreate(org, owner, default_channel, default_agent)

    async def finish_organization_create_after_commit(
        self,
        staged: StagedOrganizationCreate,
    ) -> None:
        org = staged.organization
        organization_id = org.id
        try:
            await self.user_indexer.index_for_organization(staged.owner, organization_id)
        except Exception:
            await self._session.rollback()
            logger.opt(exception=True).warning(
                "Organization created with stale owner search projection",
                organization_id=str(organization_id),
            )
            await self._refresh_staged_organization(staged)

        try:
            await ChatChannelOperations(
                self._session,
                search_indexer=self.search_indexer,
            ).finish_channel_create_after_commit(staged.default_channel)
        except Exception:
            await self._session.rollback()
            logger.opt(exception=True).warning(
                "Organization created with degraded default-channel fanout",
                organization_id=str(organization_id),
            )
            await self._refresh_staged_organization(staged)

        try:
            await finish_default_agent_after_commit(
                self._session,
                staged.default_agent,
                self.search_indexer,
            )
        except Exception:
            await self._session.rollback()
            logger.opt(exception=True).warning(
                "Organization created with stale default-agent search projection",
                organization_id=str(organization_id),
            )
            await self._refresh_staged_organization(staged)

        await self._provision_starter_content_after_commit(staged)

    async def _refresh_staged_organization(self, staged: StagedOrganizationCreate) -> None:
        await self._session.refresh(staged.organization)
        await self._session.refresh(staged.owner)
        await self._session.refresh(staged.default_channel.channel)
        await self._session.refresh(staged.default_agent.agent)

    async def _provision_starter_content_after_commit(
        self,
        staged: StagedOrganizationCreate,
    ) -> None:
        organization_id = staged.organization.id
        if not starter_content_enabled():
            return
        if not workspace_docs_available():
            logger.warning("Starter docs skipped: docs tree not present in this deployment")
            return
        try:
            await seed_workspace_docs(
                session=self._session,
                org=staged.organization,
                admin_user=staged.owner,
                search_indexer=self.search_indexer,
                storage=self._storage,
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            logger.opt(exception=True).warning(
                "Organization created without complete starter content",
                organization_id=str(organization_id),
            )

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
                resource_type=AuditResourceType.ORGANIZATION,
                resource_id=org_id,
                details={"changed_keys": changed_keys},
            )

        await self._session.commit()
        await self._session.refresh(org)
        return org

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
        """Row lookup, deactivated rows included - management flows (re-add,
        remove, role edits) need to see them. Permission gates must use the
        ``require_org_*`` helpers, which reject a deactivated membership.
        """
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
        membership = await get_active_membership(self._session, user_id, org_id)
        admin_roles = (OrganizationRole.OWNER, OrganizationRole.ADMIN)
        if not membership or membership.role not in admin_roles:
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
        membership = await get_active_membership(self._session, user_id, org_id)
        if not membership or membership.role != OrganizationRole.OWNER:
            raise PermissionDeniedError("Requires organization owner privileges")
        return membership

    async def require_org_member(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember:
        membership = await get_active_membership(self._session, user_id, org_id)
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

    async def _require_member_capacity(self, org: Organization) -> None:
        """``Organization.max_members`` is a hard cap on active members.
        ``None`` means uncapped; the platform surface owns the value.
        """
        cap = org.max_members
        if cap is None:
            return
        active = (
            await self._session.execute(
                select(func.count())
                .select_from(OrganizationMember)
                .where(OrganizationMember.organization_id == org.id)
                .where(OrganizationMember.is_active.is_(True))
            )
        ).scalar_one()
        if int(active) >= int(cap):
            raise ValidationError(
                "max_members",
                f"Organization has reached its member cap of {cap}",
            )

    async def stage_member(
        self,
        user_id: UUID,
        org_id: UUID,
        role: OrganizationRole = OrganizationRole.MEMBER,
        actor_user_id: UUID | None = None,
    ) -> StagedOrganizationMembership:
        org = (
            await self._session.execute(
                select(Organization).where(Organization.id == org_id).with_for_update()
            )
        ).scalar_one_or_none()
        if org is None:
            raise NotFoundError("Organization", str(org_id))

        existing = await self.get_membership(user_id, org_id)
        if existing is None or not existing.is_active:
            await self._require_member_capacity(org)

            if existing is None:
                membership = OrganizationMember(
                    user_id=user_id,
                    organization_id=org_id,
                    role=role,
                )
                self._session.add(membership)
            else:
                membership = existing
                membership.is_active = True
                membership.role = role
                membership.updated_at = datetime.now(UTC)

            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=actor_user_id,
                action=Action.ORGANIZATION_MEMBER_ADDED,
                resource_type=AuditResourceType.USER,
                resource_id=user_id,
                details={"role": role.value},
            )
            await self._session.flush()
        else:
            membership = existing

        await stage_personal_attachments_folder(self._session, user_id, org_id)
        default_channel_ids = await stage_default_channel_memberships(
            self._session,
            user_id,
            org_id,
        )
        return StagedOrganizationMembership(
            membership,
            org_id,
            org.slug,
            tuple(default_channel_ids),
        )

    async def finish_member_add_after_commit(
        self,
        staged: StagedOrganizationMembership,
    ) -> None:
        user_id = staged.membership.user_id
        org_id = staged.organization_id
        try:
            result = await self._session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                await self.user_indexer.index_for_organization(user, org_id)
        except Exception:
            logger.opt(exception=True).warning(
                f"Failed to index organization member {user_id} in {org_id}"
            )

        for channel_id in staged.default_channel_ids:
            try:
                await invalidate_cached_member_ids(channel_id)
            except Exception:
                logger.opt(exception=True).warning(
                    f"Failed to invalidate member cache for default channel {channel_id}"
                )

    async def add_member(
        self,
        user_id: UUID,
        org_id: UUID,
        role: OrganizationRole = OrganizationRole.MEMBER,
        actor_user_id: UUID | None = None,
    ) -> OrganizationMember:
        staged = await self.stage_member(user_id, org_id, role, actor_user_id)
        await self._session.commit()
        await self._session.refresh(staged.membership)
        await self.finish_member_add_after_commit(staged)
        return staged.membership

    async def update_member_role(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        new_role: OrganizationRole,
    ) -> tuple[OrganizationMember, User]:
        admin_membership = await self.require_org_admin(admin_user_id, org_id)

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
        if member.role == OrganizationRole.OWNER or new_role == OrganizationRole.OWNER:
            if admin_membership.role != OrganizationRole.OWNER:
                raise PermissionDeniedError("Only owners can modify owner roles")

        previous_role = member.role
        member.role = new_role
        member.updated_at = datetime.now(UTC)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=admin_user_id,
            action=Action.ORGANIZATION_MEMBER_ROLE_CHANGED,
            resource_type=AuditResourceType.USER,
            resource_id=target_user_id,
            details={
                "previous_role": previous_role.value,
                "new_role": new_role.value,
            },
        )

        await self._session.commit()
        await self._session.refresh(member)

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
        chat_cleanup = await cleanup_chat_membership_for_organization(
            self._session,
            organization_id=org_id,
            user_id=target_user_id,
        )
        await self._session.delete(membership)

        await write_audit_event(
            self._session,
            organization_id=org_id,
            actor_user_id=admin_user_id,
            action=Action.ORGANIZATION_MEMBER_REMOVED,
            resource_type=AuditResourceType.USER,
            resource_id=target_user_id,
            details={"previous_role": previous_role.value},
        )

        await self._session.commit()

        try:
            await self.user_indexer.remove_from_organization(target_user_id, org_id)
        except Exception:
            logger.opt(exception=True).warning(
                "Organization member removal committed with stale search projection",
                organization_id=str(org_id),
                user_id=str(target_user_id),
            )

        if chat_cleanup.channel_ids:
            private_channel_ids = set(chat_cleanup.private_channel_ids)
            for offset in range(0, len(chat_cleanup.channel_ids), 50):
                channel_batch = chat_cleanup.channel_ids[offset : offset + 50]
                await asyncio.gather(
                    *(invalidate_cached_member_ids(channel_id) for channel_id in channel_batch),
                    *(invalidate_cached_dm_peers(channel_id) for channel_id in channel_batch),
                    *(
                        enqueue_chat_search_acl_refresh(channel_id)
                        for channel_id in channel_batch
                        if channel_id in private_channel_ids
                    ),
                )
            for channel_id in chat_cleanup.channel_ids:
                await kick_user_from_active_call(
                    self._session,
                    channel_id,
                    target_user_id,
                )

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
            from uniffy.core.auth.permissions.defaults import ORG_PERMISSION_DEFAULTS

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

        try:
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=user_id,
                action=Action.ORGANIZATION_PERMISSION_DEFAULTS_CHANGED,
                resource_type=AuditResourceType.CONTENT_TYPE,
                resource_id=None,
                details={
                    "content_type": content_type.value,
                    "previous_access_mode": (
                        previous_access_mode.value if previous_access_mode else None
                    ),
                    "new_access_mode": defaults.default_access_mode.value,
                    "previous_baseline_role": (
                        previous_baseline_role.value if previous_baseline_role else None
                    ),
                    "new_baseline_role": (
                        defaults.default_baseline_role.value
                        if defaults.default_baseline_role
                        else None
                    ),
                },
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        await self._session.refresh(defaults)

        # Include the row revision so retained ARQ results cannot suppress a
        # later defaults mutation.
        try:
            reindex_run_id = str(int(defaults.updated_at.timestamp() * 1_000_000))
            await enqueue_job(
                REINDEX_ORG_CONTENT_FOR_DEFAULTS,
                str(org_id),
                content_type.value,
                None,
                reindex_run_id,
                _job_id=f"reindex_defaults:{org_id}:{content_type.value}:{reindex_run_id}",
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to enqueue org-content reindex after defaults change"
            )

        try:
            from uniffy.core.realtime.publisher import publish_defaults_changed

            await publish_defaults_changed(org_id, content_type)
        except Exception:
            logger.opt(exception=True).warning("Failed to publish realtime defaults_changed event")

        return defaults

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
            resource_type=AuditResourceType.USER,
            resource_id=target_user_id,
            details={"domain": domain.value},
        )

        await self._session.commit()
        await self._session.refresh(da)

        from uniffy.core.events.realtime import NotificationPayloadType, publish_notification

        await publish_notification(
            target_user_id,
            {"_type": NotificationPayloadType.PERMISSIONS_CHANGED},
        )

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
            resource_type=AuditResourceType.USER,
            resource_id=target_user_id,
            details={"domain": domain.value, "previous_state": previous_state},
        )

        await self._session.commit()

        from uniffy.core.events.realtime import NotificationPayloadType, publish_notification

        await publish_notification(
            target_user_id,
            {"_type": NotificationPayloadType.PERMISSIONS_CHANGED},
        )

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
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=organization_id,
            details={
                "previous_version": new_version - 1,
                "new_version": new_version,
            },
        )
        await self._session.commit()
        return new_version - 1, new_version, rotated_at
