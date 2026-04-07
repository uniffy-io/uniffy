"""Organization management operations.

This module handles all business logic for organizations including
CRUD, membership management, and permission defaults.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models import Group, Organization, OrganizationPermissionDefaults, User
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.shared import ContentType, DomainType, VisibilityScope


class OrganizationOperations:
    """Organization management operations."""

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize organization operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self._session = session

        from uniffy.domains.users.search import UserSearchIndexer

        self._user_indexer = UserSearchIndexer(session)

    # ─────────────────────────────────────────────────────────────
    # Organization CRUD
    # ─────────────────────────────────────────────────────────────

    async def get_by_id(self, org_id: UUID) -> Organization:
        """
        Get organization by ID.

        Parameters
        ----------
        org_id : UUID
            Organization ID.

        Returns
        -------
        Organization
            Organization instance.

        Raises
        ------
        NotFoundError
            If organization not found.

        """
        result = await self._session.execute(select(Organization).where(Organization.id == org_id))
        org = result.scalar_one_or_none()
        if not org:
            raise NotFoundError("Organization", str(org_id))
        return org

    async def get_by_slug(self, slug: str) -> Organization | None:
        """
        Get organization by slug.

        Parameters
        ----------
        slug : str
            Organization slug.

        Returns
        -------
        Organization | None
            Organization if found, None otherwise.

        """
        result = await self._session.execute(select(Organization).where(Organization.slug == slug))
        return result.scalar_one_or_none()

    async def create(
        self,
        name: str,
        slug: str,
        owner_user_id: UUID,
        domain: str | None = None,
        plan: str = "free",
    ) -> Organization:
        """
        Create a new organization.

        Parameters
        ----------
        name : str
            Organization name.
        slug : str
            URL-friendly slug.
        owner_user_id : UUID
            User ID of the owner.
        domain : str | None
            Email domain for SSO/auto-join.
        plan : str
            Subscription plan.

        Returns
        -------
        Organization
            Created organization.

        """
        org = Organization(
            name=name,
            slug=slug,
            domain=domain,
            plan=plan,
        )
        self._session.add(org)
        await self._session.flush()

        # Add owner as member with OWNER role
        membership = OrganizationMember(
            user_id=owner_user_id,
            organization_id=org.id,
            role=OrganizationRole.OWNER,
        )
        self._session.add(membership)

        await self._session.commit()
        await self._session.refresh(org)

        # Index owner user for search in this organization
        result = await self._session.execute(select(User).where(User.id == owner_user_id))
        owner = result.scalar_one_or_none()
        if owner:
            await self._user_indexer.index_for_organization(owner, org.id)
            await self._session.commit()

        # Create Attachments folder for the owner
        from uniffy.domains.attachments.operations import AttachmentOperations

        attachment_ops = AttachmentOperations(self._session)
        await attachment_ops.get_or_create_attachments_folder(owner_user_id, org.id)
        await self._session.commit()

        # Seed default file filter presets
        from uniffy.domains.files.filters.presets import create_default_presets

        await create_default_presets(self._session, org.id, owner_user_id)
        await self._session.commit()

        # Create default #general chat channel
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

        # Populate default permission defaults for all content types
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

        return org

    async def update(
        self,
        org_id: UUID,
        name: str | None = None,
        slug: str | None = None,
        domain: str | None = None,
        plan: str | None = None,
        is_active: bool | None = None,
    ) -> Organization:
        """
        Update organization details.

        Parameters
        ----------
        org_id : UUID
            Organization ID.
        name : str | None
            New name.
        slug : str | None
            New slug.
        domain : str | None
            New domain.
        plan : str | None
            New plan.
        is_active : bool | None
            Active status.

        Returns
        -------
        Organization
            Updated organization.

        """
        org = await self.get_by_id(org_id)

        if name is not None:
            org.name = name
        if slug is not None:
            org.slug = slug
        if domain is not None:
            org.domain = domain
        if plan is not None:
            org.plan = plan
        if is_active is not None:
            org.is_active = is_active

        await self._session.commit()
        await self._session.refresh(org)
        return org

    async def delete(self, org_id: UUID) -> bool:
        """
        Delete an organization and all related data.

        Parameters
        ----------
        org_id : UUID
            Organization ID.

        Returns
        -------
        bool
            True if deleted.

        """
        org = await self.get_by_id(org_id)

        # Delete group members first
        groups_result = await self._session.execute(
            select(Group.id).where(Group.organization_id == org_id)
        )
        group_ids = [row[0] for row in groups_result.all()]
        if group_ids:
            await self._session.execute(
                sql_delete(GroupMember).where(GroupMember.group_id.in_(group_ids))
            )

        # Delete groups
        await self._session.execute(sql_delete(Group).where(Group.organization_id == org_id))

        # Delete domain admin assignments
        await self._session.execute(
            sql_delete(DomainAdmin).where(DomainAdmin.organization_id == org_id)
        )

        # Delete permission defaults
        await self._session.execute(
            sql_delete(OrganizationPermissionDefaults).where(
                OrganizationPermissionDefaults.organization_id == org_id
            )
        )

        # Delete memberships
        await self._session.execute(
            sql_delete(OrganizationMember).where(OrganizationMember.organization_id == org_id)
        )

        # Delete organization
        await self._session.delete(org)
        await self._session.commit()

        return True

    async def list_all(
        self,
        page: int = 1,
        page_size: int = 20,
        query_str: str | None = None,
    ) -> tuple[list[tuple[Organization, int, int]], int]:
        """
        List all organizations with member and group counts (system admin only).

        Parameters
        ----------
        page : int
            Page number (1-indexed).
        page_size : int
            Items per page.
        query_str : str | None
            Optional search query.

        Returns
        -------
        tuple[list[tuple[Organization, int, int]], int]
            List of (organization, member_count, group_count) tuples and total count.

        """
        # Build base query
        query = select(Organization)

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(Organization.name.ilike(pattern) | Organization.slug.ilike(pattern))

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Apply pagination
        query = query.order_by(Organization.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        orgs = list(result.scalars().all())

        # Get member and group counts for each org
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
        """
        Get all organizations a user belongs to.

        Parameters
        ----------
        user_id : UUID
            User ID.

        Returns
        -------
        list[tuple[Organization, OrganizationMember]]
            List of (organization, membership) tuples.

        """
        result = await self._session.execute(
            select(Organization, OrganizationMember)
            .join(OrganizationMember, Organization.id == OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == user_id)
            .where(OrganizationMember.is_active.is_(True))
            .order_by(Organization.name)
        )
        return [(row[0], row[1]) for row in result.all()]

    # ─────────────────────────────────────────────────────────────
    # Organization Overview
    # ─────────────────────────────────────────────────────────────

    async def get_overview(self, org_id: UUID) -> dict:
        """
        Get overview of the organization.

        Parameters
        ----------
        org_id : UUID
            Organization ID.

        Returns
        -------
        dict
            Overview with member count, group count, etc.

        """
        org = await self.get_by_id(org_id)

        # Get member count
        member_count_result = await self._session.execute(
            select(func.count()).select_from(
                select(OrganizationMember)
                .where(OrganizationMember.organization_id == org_id)
                .where(OrganizationMember.is_active.is_(True))
                .subquery()
            )
        )
        member_count = member_count_result.scalar() or 0

        # Get group count
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

    # ─────────────────────────────────────────────────────────────
    # Membership Management
    # ─────────────────────────────────────────────────────────────

    async def get_membership(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember | None:
        """
        Get user's membership in an organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        org_id : UUID
            Organization ID.

        Returns
        -------
        OrganizationMember | None
            Membership if exists, None otherwise.

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
        """
        Verify user is admin/owner of organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        org_id : UUID
            Organization ID.

        Returns
        -------
        OrganizationMember
            User's membership.

        Raises
        ------
        PermissionDeniedError
            If user is not admin/owner.

        """
        membership = await self.get_membership(user_id, org_id)
        if not membership or membership.role not in (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        ):
            raise PermissionDeniedError("Requires organization admin privileges")
        return membership

    async def require_org_member(
        self,
        user_id: UUID,
        org_id: UUID,
    ) -> OrganizationMember:
        """
        Verify user is a member of organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        org_id : UUID
            Organization ID.

        Returns
        -------
        OrganizationMember
            User's membership.

        Raises
        ------
        PermissionDeniedError
            If user is not a member.

        """
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
        """
        List organization members.

        Parameters
        ----------
        org_id : UUID
            Organization ID.
        page : int
            Page number.
        page_size : int
            Page size.
        role_filter : OrganizationRole | None
            Filter by role.
        search : str | None
            Search by name or email.
        include_inactive : bool
            Include inactive members.

        Returns
        -------
        tuple[list[tuple[OrganizationMember, User]], int]
            (members with users, total count).

        """
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

        # Count
        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Fetch with pagination
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
    ) -> OrganizationMember:
        """
        Add user to organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        org_id : UUID
            Organization ID.
        role : OrganizationRole
            Role in organization.

        Returns
        -------
        OrganizationMember
            Created membership.

        """
        # Check if already member
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

        # Index user for search in this organization
        result = await self._session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            await self._user_indexer.index_for_organization(user, org_id)
            await self._session.commit()

        # Create Attachments folder for the new member
        from uniffy.domains.attachments.operations import AttachmentOperations

        attachment_ops = AttachmentOperations(self._session)
        await attachment_ops.get_or_create_attachments_folder(user_id, org_id)
        await self._session.commit()

        # Auto-join default chat channels (e.g., #general)
        from uniffy.domains.chat.channels.operations import ChatChannelOperations

        chat_ops = ChatChannelOperations(self._session)
        await chat_ops.join_default_channels(user_id, org_id)
        await self._session.commit()

        return membership

    async def update_member_role(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        new_role: OrganizationRole,
    ) -> tuple[OrganizationMember, User]:
        """
        Update a member's role.

        Parameters
        ----------
        admin_user_id : UUID
            Admin user making the change.
        org_id : UUID
            Organization ID.
        target_user_id : UUID
            User whose role to change.
        new_role : OrganizationRole
            New role to assign.

        Returns
        -------
        tuple[OrganizationMember, User]
            Updated member and user.

        """
        await self.require_org_admin(admin_user_id, org_id)

        # Get the member
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

        # Only OWNER can change roles to/from OWNER
        admin_membership = await self.get_membership(admin_user_id, org_id)

        if member.role == OrganizationRole.OWNER or new_role == OrganizationRole.OWNER:
            if not admin_membership or admin_membership.role != OrganizationRole.OWNER:
                raise PermissionDeniedError("Only owners can modify owner roles")

        member.role = new_role
        member.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(member)

        return (member, user)

    async def remove_member(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
    ) -> bool:
        """
        Remove a member from the organization.

        Parameters
        ----------
        admin_user_id : UUID
            Admin user removing the member.
        org_id : UUID
            Organization ID.
        target_user_id : UUID
            User to remove.

        Returns
        -------
        bool
            True if removed.

        """
        await self.require_org_admin(admin_user_id, org_id)

        membership = await self.get_membership(target_user_id, org_id)
        if not membership:
            return False

        # Cannot remove OWNER
        if membership.role == OrganizationRole.OWNER:
            raise PermissionDeniedError("Cannot remove organization owner")

        # Remove domain admin assignments
        await self._session.execute(
            sql_delete(DomainAdmin).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
            )
        )

        await self._session.delete(membership)
        await self._session.commit()

        # Remove user from search index for this organization
        await self._user_indexer.remove_from_organization(target_user_id, org_id)
        await self._session.commit()

        return True

    # ─────────────────────────────────────────────────────────────
    # Permission Defaults
    # ─────────────────────────────────────────────────────────────

    async def get_permission_defaults(
        self,
        org_id: UUID,
    ) -> list[OrganizationPermissionDefaults]:
        """
        Get all permission defaults for an organization.

        Parameters
        ----------
        org_id : UUID
            Organization ID.

        Returns
        -------
        list[OrganizationPermissionDefaults]
            List of defaults for each content type.

        """
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
        default_visibility: VisibilityScope | None = None,
        members_can_view: bool | None = None,
        members_can_edit: bool | None = None,
        members_can_delete: bool | None = None,
        members_can_share: bool | None = None,
    ) -> OrganizationPermissionDefaults:
        """
        Update permission defaults for a content type.

        Parameters
        ----------
        user_id : UUID
            User making the update.
        org_id : UUID
            Organization ID.
        content_type : ContentType
            Content type to update.
        default_visibility : VisibilityScope | None
            New default visibility.
        members_can_view : bool | None
            Can members view.
        members_can_edit : bool | None
            Can members edit.
        members_can_delete : bool | None
            Can members delete.
        members_can_share : bool | None
            Can members share.

        Returns
        -------
        OrganizationPermissionDefaults
            The updated defaults.

        """
        await self.require_org_admin(user_id, org_id)

        # Get existing or create new
        result = await self._session.execute(
            select(OrganizationPermissionDefaults)
            .where(OrganizationPermissionDefaults.organization_id == org_id)
            .where(OrganizationPermissionDefaults.content_type == content_type)
        )
        defaults = result.scalar_one_or_none()

        if defaults:
            # Update existing
            if default_visibility is not None:
                defaults.default_visibility = default_visibility
            if members_can_view is not None:
                defaults.members_can_view = members_can_view
            if members_can_edit is not None:
                defaults.members_can_edit = members_can_edit
            if members_can_delete is not None:
                defaults.members_can_delete = members_can_delete
            if members_can_share is not None:
                defaults.members_can_share = members_can_share
            defaults.updated_by_user_id = user_id
            defaults.updated_at = datetime.now(UTC)
        else:
            # Create new - start from built-in defaults then apply overrides
            from uniffy.domains.organizations.defaults import ORG_PERMISSION_DEFAULTS

            base = ORG_PERMISSION_DEFAULTS.get(content_type, {})
            dv = default_visibility or base.get(
                "default_visibility", VisibilityScope.PRIVATE
            )
            cv = members_can_view if members_can_view is not None else base.get(
                "members_can_view", True
            )
            ce = members_can_edit if members_can_edit is not None else base.get(
                "members_can_edit", False
            )
            cd = members_can_delete if members_can_delete is not None else base.get(
                "members_can_delete", False
            )
            cs = members_can_share if members_can_share is not None else base.get(
                "members_can_share", False
            )
            defaults = OrganizationPermissionDefaults(
                organization_id=org_id,
                content_type=content_type,
                default_visibility=dv,
                members_can_view=cv,
                members_can_edit=ce,
                members_can_delete=cd,
                members_can_share=cs,
                updated_by_user_id=user_id,
            )
            self._session.add(defaults)

        await self._session.commit()
        await self._session.refresh(defaults)
        return defaults

    # ─────────────────────────────────────────────────────────────
    # Domain Admin Management
    # ─────────────────────────────────────────────────────────────

    async def grant_domain_admin(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        domain: DomainType,
    ) -> tuple[DomainAdmin, User]:
        """
        Grant domain admin to a user. Requires org admin.

        Idempotent: returns existing assignment if already granted.

        Parameters
        ----------
        admin_user_id : UUID
            Org admin performing the grant.
        org_id : UUID
            Organization ID.
        target_user_id : UUID
            User to grant domain admin to.
        domain : DomainType
            Domain to grant admin for.

        Returns
        -------
        tuple[DomainAdmin, User]
            Domain admin assignment and user.

        """
        await self.require_org_admin(admin_user_id, org_id)
        await self.require_org_member(target_user_id, org_id)

        # Check if already exists (idempotent)
        result = await self._session.execute(
            select(DomainAdmin).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
                DomainAdmin.domain == domain,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            user_result = await self._session.execute(
                select(User).where(User.id == target_user_id)
            )
            user = user_result.scalar_one()
            return existing, user

        da = DomainAdmin(
            user_id=target_user_id,
            organization_id=org_id,
            domain=domain,
            granted_by=admin_user_id,
        )
        self._session.add(da)
        await self._session.commit()
        await self._session.refresh(da)

        # Notify target user to refresh permissions
        from uniffy.core.valkey.pubsub import publish_notification

        await publish_notification(
            target_user_id, {"_type": "permissions_changed"}
        )

        user_result = await self._session.execute(
            select(User).where(User.id == target_user_id)
        )
        user = user_result.scalar_one()
        return da, user

    async def revoke_domain_admin(
        self,
        admin_user_id: UUID,
        org_id: UUID,
        target_user_id: UUID,
        domain: DomainType,
    ) -> bool:
        """
        Revoke domain admin from a user. Requires org admin.

        Parameters
        ----------
        admin_user_id : UUID
            Org admin performing the revocation.
        org_id : UUID
            Organization ID.
        target_user_id : UUID
            User to revoke domain admin from.
        domain : DomainType
            Domain to revoke admin for.

        Returns
        -------
        bool
            True if revoked.

        Raises
        ------
        NotFoundError
            If user does not have domain admin for this domain.

        """
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

        await self._session.delete(da)
        await self._session.commit()

        # Notify target user to refresh permissions
        from uniffy.core.valkey.pubsub import publish_notification

        await publish_notification(
            target_user_id, {"_type": "permissions_changed"}
        )

        return True

    async def list_domain_admins(
        self,
        org_id: UUID,
        domain_filter: DomainType | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[tuple[DomainAdmin, User]], int]:
        """
        List domain admins for an organization.

        Parameters
        ----------
        org_id : UUID
            Organization ID.
        domain_filter : DomainType | None
            Optional filter by domain.
        page : int
            Page number.
        page_size : int
            Page size.

        Returns
        -------
        tuple[list[tuple[DomainAdmin, User]], int]
            (domain admins with users, total count).

        """
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
        """
        Get all domains where a user is domain admin.

        Parameters
        ----------
        org_id : UUID
            Organization ID.
        target_user_id : UUID
            User to check.

        Returns
        -------
        list[DomainType]
            List of domains where user is admin.

        """
        result = await self._session.execute(
            select(DomainAdmin.domain).where(
                DomainAdmin.user_id == target_user_id,
                DomainAdmin.organization_id == org_id,
            )
        )
        return [row[0] for row in result.all()]
