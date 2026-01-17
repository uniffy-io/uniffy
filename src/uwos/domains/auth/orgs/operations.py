"""Organization management operations."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.errors import NotFoundError, PermissionDeniedError
from uwos.core.models.login.organization import Organization
from uwos.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uwos.core.models.login.user import User
from uwos.domains.auth.users.search import UserSearchIndexer


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
        self._user_indexer = UserSearchIndexer(session)

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

        return org

    async def update(
        self,
        org_id: UUID,
        name: str | None = None,
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
        if domain is not None:
            org.domain = domain
        if plan is not None:
            org.plan = plan
        if is_active is not None:
            org.is_active = is_active

        await self._session.commit()
        await self._session.refresh(org)
        return org

    async def list_all(
        self,
        page: int = 1,
        page_size: int = 20,
        query_str: str | None = None,
    ) -> tuple[list[tuple[Organization, int]], int]:
        """
        List all organizations with member counts (system admin only).

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
        tuple[list[tuple[Organization, int]], int]
            List of (organization, member_count) tuples and total count.

        """
        # Build base query with member count
        member_count = (
            select(func.count(OrganizationMember.id))
            .where(OrganizationMember.organization_id == Organization.id)
            .correlate(Organization)
            .scalar_subquery()
        )

        query = select(Organization, member_count)

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(Organization.name.ilike(pattern) | Organization.slug.ilike(pattern))

        # Get total count
        count_query = select(func.count()).select_from(
            select(Organization.id)
            .where(
                Organization.name.ilike(f"%{query_str}%") | Organization.slug.ilike(f"%{query_str}%")
            )
            .subquery()
            if query_str
            else select(Organization.id).subquery()
        )
        total = (await self._session.execute(count_query)).scalar() or 0

        # Apply pagination
        query = query.order_by(Organization.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        orgs_with_counts = [(row[0], row[1] or 0) for row in result.all()]

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
            .where(OrganizationMember.is_active == True)  # noqa: E712
            .order_by(Organization.name)
        )
        return [(row[0], row[1]) for row in result.all()]

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

        return membership

    async def remove_member(self, user_id: UUID, org_id: UUID) -> None:
        """
        Remove user from organization.

        Parameters
        ----------
        user_id : UUID
            User ID.
        org_id : UUID
            Organization ID.

        """
        result = await self._session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership:
            await self._session.delete(membership)
            await self._session.commit()

            # Remove user from search index for this organization
            await self._user_indexer.remove_from_organization(user_id, org_id)
            await self._session.commit()

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

    async def list_members(
        self,
        org_id: UUID,
        page: int = 1,
        page_size: int = 20,
        query_str: str | None = None,
    ) -> tuple[list, int]:
        """
        List organization members.

        Parameters
        ----------
        org_id : UUID
            Organization ID.
        page : int
            Page number.
        page_size : int
            Items per page.
        query_str : str | None
            Optional search query.

        Returns
        -------
        tuple[list, int]
            List of users and total count.

        """
        from uwos.core.models.login.user import User

        query = (
            select(User)
            .join(OrganizationMember, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == org_id)
            .where(OrganizationMember.is_active == True)  # noqa: E712
        )

        if query_str:
            pattern = f"%{query_str}%"
            query = query.where(
                User.email.ilike(pattern)
                | User.username.ilike(pattern)
                | User.full_name.ilike(pattern)
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self._session.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(User.username)
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        users = list(result.scalars().all())

        return users, total
